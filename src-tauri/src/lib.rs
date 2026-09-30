mod audio;
mod hub;
mod server;
mod store;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};

use audio::{AudioHandle, DeviceInfo, StartRequest};
use hub::{AudioStatus, Hub};
use store::Store;

struct App {
  hub: Arc<Hub>,
  store: Arc<Store>,
  audio: AudioHandle,
  /// Set if the OBS server could not start, so the editor can say why.
  server_error: Arc<Mutex<Option<String>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
  url: String,
  error: Option<String>,
}

#[tauri::command]
fn server_info(app: State<'_, App>) -> ServerInfo {
  ServerInfo {
    url: format!("http://localhost:{}/?mode=live", server::PORT),
    error: app.server_error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
  }
}

#[tauri::command]
fn audio_devices() -> Vec<DeviceInfo> {
  audio::list_devices()
}

#[tauri::command]
async fn audio_start(
  app: State<'_, App>,
  device_id: Option<String>,
  synthetic: bool,
  fft_size: usize,
  smoothing: f32,
) -> Result<AudioStatus, ()> {
  Ok(
    app
      .audio
      .start(StartRequest {
        device_id,
        synthetic,
        fft_size,
        smoothing,
      })
      .await,
  )
}

#[tauri::command]
fn audio_configure(app: State<'_, App>, fft_size: usize, smoothing: f32) {
  app.audio.configure(fft_size, smoothing);
}

#[tauri::command]
fn audio_stop(app: State<'_, App>) {
  app.audio.stop();
}

#[tauri::command]
fn get_profile(app: State<'_, App>) -> Result<Option<serde_json::Value>, String> {
  let Some(bytes) = app.store.read_profile().map_err(|e| e.to_string())? else {
    return Ok(None);
  };
  // A corrupt file reads as "no profile" rather than an error: the page falls
  // back to defaults instead of refusing to open.
  Ok(serde_json::from_slice(&bytes).ok())
}

#[tauri::command]
fn set_profile(app: State<'_, App>, profile: serde_json::Value) -> Result<(), String> {
  let json = serde_json::to_vec_pretty(&profile).map_err(|e| e.to_string())?;
  app.store.write_profile(&json).map_err(|e| e.to_string())?;
  app.hub.profile_revision.send_modify(|revision| *revision += 1);
  Ok(())
}

/// Takes the image as a raw body so a large PNG is not JSON-encoded as an
/// array of numbers on the way in.
#[tauri::command]
fn put_image(app: State<'_, App>, request: Request<'_>) -> Result<String, String> {
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected raw image bytes".into());
  };
  let mime = request
    .headers()
    .get("x-mime")
    .and_then(|value| value.to_str().ok())
    .unwrap_or_default();
  app.store.put_image(bytes, mime).map_err(|e| e.to_string())
}

/// A missing image is an error rather than an empty body, so the page can tell
/// "gone" apart from a zero-byte file.
#[tauri::command]
fn get_image(app: State<'_, App>, id: String) -> Result<Response, String> {
  match app.store.get_image(&id).map_err(|e| e.to_string())? {
    Some((bytes, _)) => Ok(Response::new(bytes)),
    None => Err("not found".into()),
  }
}

#[tauri::command]
fn delete_image(app: State<'_, App>, id: String) -> Result<(), String> {
  app.store.delete_image(&id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let hub = Arc::new(Hub::new());
      let store = Arc::new(Store::new(app.path().app_data_dir()?)?);
      let audio = AudioHandle::spawn(Arc::clone(&hub));
      let server_error = Arc::new(Mutex::new(None));

      let handle = app.handle().clone();
      let (server_hub, server_store) = (Arc::clone(&hub), Arc::clone(&store));
      let error_slot = Arc::clone(&server_error);
      tauri::async_runtime::spawn(async move {
        if let Err(err) = server::serve(handle, server_hub, server_store).await {
          log::error!("OBS server failed: {err}");
          *error_slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(format!(
            "Could not serve OBS on port {}: {err}. Is another copy of Yapora running?",
            server::PORT
          ));
        }
      });

      app.manage(App {
        hub,
        store,
        audio,
        server_error,
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      server_info,
      audio_devices,
      audio_start,
      audio_configure,
      audio_stop,
      get_profile,
      set_profile,
      put_image,
      get_image,
      delete_image,
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

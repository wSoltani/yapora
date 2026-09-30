mod audio;
mod hub;
mod server;
mod store;

use std::sync::{Arc, Mutex};

use tauri::async_runtime::JoinHandle;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request, Response};
use tauri::{Manager, State};

use audio::{AudioHandle, DeviceInfo, StartRequest};
use hub::{AudioStatus, Hub};
use server::{ObsServer, ServerInfo};
use store::{Settings, Store};

struct App {
  hub: Arc<Hub>,
  store: Arc<Store>,
  audio: AudioHandle,
  obs: Arc<ObsServer>,
  /// The editor window's audio feed; replaced when the page reloads.
  feed: Mutex<Option<JoinHandle<()>>>,
}

#[tauri::command]
async fn server_info(app: State<'_, App>) -> Result<ServerInfo, ()> {
  Ok(app.obs.info().await)
}

#[tauri::command]
fn get_settings(app: State<'_, App>) -> Settings {
  app.store.read_settings()
}

/// Switches OBS output on or off, remembers the choice, and reports the
/// resulting server state.
#[tauri::command]
async fn set_obs_enabled(app: State<'_, App>, enabled: bool) -> Result<ServerInfo, String> {
  let mut settings = app.store.read_settings();
  settings.obs_enabled = enabled;
  app.store.write_settings(&settings).map_err(|e| e.to_string())?;
  if enabled {
    app.obs.start().await;
  } else {
    app.obs.stop().await;
  }
  Ok(app.obs.info().await)
}

/// Streams analysis frames and mic status straight to the editor window over
/// IPC, so the editor works whether or not OBS output is on.
#[tauri::command]
fn audio_subscribe(
  app: State<'_, App>,
  frames: Channel<InvokeResponseBody>,
  status: Channel<AudioStatus>,
) {
  let mut frame_rx = app.hub.frames.subscribe();
  let mut status_rx = app.hub.status.subscribe();
  let task = tauri::async_runtime::spawn(async move {
    let _ = status.send(status_rx.borrow_and_update().clone());
    loop {
      let sent = tokio::select! {
        changed = frame_rx.changed() => {
          if changed.is_err() { return; }
          let bytes = frame_rx.borrow_and_update().to_vec();
          frames.send(InvokeResponseBody::Raw(bytes))
        }
        changed = status_rx.changed() => {
          if changed.is_err() { return; }
          status.send(status_rx.borrow_and_update().clone())
        }
      };
      if sent.is_err() {
        return;
      }
    }
  });
  // One editor window: a new subscription means the page reloaded, and the
  // old feed is talking to a page that no longer exists.
  let previous = app.feed.lock().unwrap_or_else(|e| e.into_inner()).replace(task);
  if let Some(previous) = previous {
    previous.abort();
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
      let obs = Arc::new(ObsServer::new(
        app.handle().clone(),
        Arc::clone(&hub),
        Arc::clone(&store),
      ));

      if store.read_settings().obs_enabled {
        let obs = Arc::clone(&obs);
        tauri::async_runtime::spawn(async move { obs.start().await });
      }

      app.manage(App {
        hub,
        store,
        audio,
        obs,
        feed: Mutex::new(None),
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      server_info,
      get_settings,
      set_obs_enabled,
      audio_subscribe,
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

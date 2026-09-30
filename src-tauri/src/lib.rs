mod audio;
mod hub;
mod server;
mod store;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request, Response};
use tauri::{Manager, State};

use audio::file::{self, TrackInfo};
use audio::{AudioHandle, DeviceInfo, SourceKind, StartRequest};
use hub::{AudioStatus, Hub};
use server::{ObsServer, ServerInfo};
use store::{ProfileSummary, Settings, Store, valid_profile_id};

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
  app
    .store
    .update_settings(|settings| settings.obs_enabled = enabled)
    .map_err(|e| e.to_string())?;
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
  source: SourceKind,
  fft_size: usize,
  smoothing: f32,
) -> Result<AudioStatus, ()> {
  Ok(
    app
      .audio
      .start(StartRequest {
        device_id,
        source,
        fft_size,
        smoothing,
      })
      .await,
  )
}

/// Decodes an audio file and makes it the file source's track, paused at the
/// start. Decoding runs off the async runtime; it can take a moment.
#[tauri::command]
async fn file_load(app: State<'_, App>, path: String) -> Result<TrackInfo, String> {
  let track = tauri::async_runtime::spawn_blocking(move || file::decode(path.as_ref()))
    .await
    .map_err(|e| e.to_string())??;
  let info = TrackInfo {
    name: track.name.clone(),
    duration: track.duration(),
    peaks: track.peaks(),
  };
  {
    let mut player = file::lock(&app.audio.player);
    player.track = Some(Arc::new(track));
    player.info = Some(info.clone());
    player.position = 0.0;
    player.playing = false;
    player.moved = true;
  }
  app.audio.track_loaded();
  Ok(info)
}

/// The loaded track, if any — lets a reloaded editor pick up where it was.
#[tauri::command]
fn file_info(app: State<'_, App>) -> Option<TrackInfo> {
  file::lock(&app.audio.player).info.clone()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Transport {
  position: f64,
  playing: bool,
}

fn transport(app: &App) -> Transport {
  let player = file::lock(&app.audio.player);
  Transport {
    position: player.seconds(),
    playing: player.playing,
  }
}

#[tauri::command]
fn file_transport(app: State<'_, App>) -> Transport {
  transport(&app)
}

#[tauri::command]
async fn file_play(app: State<'_, App>) -> Result<Transport, String> {
  app.audio.play().await?;
  Ok(transport(&app))
}

#[tauri::command]
fn file_pause(app: State<'_, App>) -> Transport {
  file::lock(&app.audio.player).playing = false;
  transport(&app)
}

#[tauri::command]
fn file_seek(app: State<'_, App>, seconds: f64) -> Transport {
  file::lock(&app.audio.player).seek(seconds);
  transport(&app)
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
fn set_mic_device(app: State<'_, App>, device_id: Option<String>) -> Result<(), String> {
  app
    .store
    .update_settings(|settings| settings.mic_device = device_id)
    .map(drop)
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileList {
  active_id: Option<String>,
  profiles: Vec<ProfileSummary>,
}

fn profile_list(store: &Store) -> Result<ProfileList, String> {
  Ok(ProfileList {
    active_id: store.active_profile_id(),
    profiles: store.list_profiles().map_err(|e| e.to_string())?,
  })
}

/// Tells OBS to refetch: the active profile changed, or its contents did.
fn announce_profile(app: &App) {
  app.hub.profile_revision.send_modify(|revision| *revision += 1);
}

#[tauri::command]
fn list_profiles(app: State<'_, App>) -> Result<ProfileList, String> {
  profile_list(&app.store)
}

/// The active profile, or `None` when there are none yet and the page should
/// start from defaults.
#[tauri::command]
fn get_profile(app: State<'_, App>) -> Result<Option<serde_json::Value>, String> {
  let Some(id) = app.store.active_profile_id() else {
    return Ok(None);
  };
  let Some(bytes) = app.store.read_profile(&id).map_err(|e| e.to_string())? else {
    return Ok(None);
  };
  // A corrupt file reads as "no profile" rather than an error: the page falls
  // back to defaults instead of refusing to open.
  Ok(serde_json::from_slice(&bytes).ok())
}

/// Saves a profile under its own `id`. Saving one that is not active is
/// normal: a debounced save can land just after switching away from it.
#[tauri::command]
fn set_profile(app: State<'_, App>, profile: serde_json::Value) -> Result<(), String> {
  let id = profile["id"]
    .as_str()
    .filter(|id| valid_profile_id(id))
    .ok_or("profile has no valid id")?
    .to_string();
  app.store.write_profile(&id, &profile).map_err(|e| e.to_string())?;
  if app.store.active_profile_id().as_deref() == Some(&id) {
    announce_profile(&app);
  }
  Ok(())
}

#[tauri::command]
fn set_active_profile(app: State<'_, App>, id: String) -> Result<(), String> {
  if app.store.read_profile(&id).map_err(|e| e.to_string())?.is_none() {
    return Err("That profile no longer exists.".into());
  }
  app
    .store
    .update_settings(|settings| settings.active_profile = Some(id))
    .map_err(|e| e.to_string())?;
  announce_profile(&app);
  Ok(())
}

/// Deletes a profile and any image only it used. If it was active, another
/// becomes active; the returned list says which.
#[tauri::command]
fn delete_profile(app: State<'_, App>, id: String) -> Result<ProfileList, String> {
  let was_active = app.store.active_profile_id().as_deref() == Some(&id);
  app.store.delete_profile(&id).map_err(|e| e.to_string())?;
  if let Err(err) = app.store.collect_images() {
    log::warn!("image cleanup failed: {err}");
  }
  if was_active {
    let next = app.store.active_profile_id();
    app
      .store
      .update_settings(|settings| settings.active_profile = next)
      .map_err(|e| e.to_string())?;
    announce_profile(&app);
  }
  profile_list(&app.store)
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


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
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
      // Images replaced since the last run are only swept here and on delete;
      // see Store::collect_images for why they cannot go immediately.
      if let Err(err) = store.collect_images() {
        log::warn!("image cleanup failed: {err}");
      }
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
      file_load,
      file_info,
      file_transport,
      file_play,
      file_pause,
      file_seek,
      set_mic_device,
      list_profiles,
      get_profile,
      set_profile,
      set_active_profile,
      delete_profile,
      put_image,
      get_image,
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

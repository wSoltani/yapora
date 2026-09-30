//! The local server OBS points its Browser Source at.
//!
//! It serves the same frontend bundle the app window runs, a read-only view of
//! the stored profile and images, and a WebSocket that streams analysis frames,
//! mic status and profile changes. Nothing here can modify anything — edits go
//! through Tauri commands, which only the app's own window can call.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::Router;
use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;
use tokio::sync::{Mutex, watch};
use tokio::task::JoinHandle;

use crate::hub::Hub;
use crate::store::Store;

/// Fixed so a saved Browser Source URL keeps working across launches.
pub const PORT: u16 = 4173;

#[derive(Clone)]
struct Ctx {
  app: AppHandle,
  hub: Arc<Hub>,
  store: Arc<Store>,
  /// Flips to true on stop, so open streams end and the port is released.
  shutdown: watch::Receiver<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
  pub url: String,
  pub running: bool,
  pub error: Option<String>,
}

struct Running {
  shutdown: watch::Sender<bool>,
  task: JoinHandle<()>,
}

/// Starts and stops the OBS server on demand; it only holds the port while
/// OBS output is switched on.
pub struct ObsServer {
  app: AppHandle,
  hub: Arc<Hub>,
  store: Arc<Store>,
  running: Mutex<Option<Running>>,
  error: Mutex<Option<String>>,
}

impl ObsServer {
  pub fn new(app: AppHandle, hub: Arc<Hub>, store: Arc<Store>) -> Self {
    Self {
      app,
      hub,
      store,
      running: Mutex::new(None),
      error: Mutex::new(None),
    }
  }

  pub async fn info(&self) -> ServerInfo {
    ServerInfo {
      url: format!("http://localhost:{PORT}/?mode=live"),
      running: self.running.lock().await.is_some(),
      error: self.error.lock().await.clone(),
    }
  }

  /// Binds the port and serves. A no-op if already running.
  pub async fn start(&self) {
    let mut running = self.running.lock().await;
    if running.is_some() {
      return;
    }

    // Loopback only: the stream is for OBS on this machine, not the network.
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, PORT));
    let listener = match tokio::net::TcpListener::bind(addr).await {
      Ok(listener) => listener,
      Err(err) => {
        log::error!("OBS server failed: {err}");
        *self.error.lock().await = Some(format!(
          "Could not serve OBS on port {PORT}: {err}. Is another copy of Yapora running?"
        ));
        return;
      }
    };
    *self.error.lock().await = None;

    let (shutdown, shutdown_rx) = watch::channel(false);
    let router = Router::new()
      .route("/api/profile", get(profile))
      .route("/api/image/{id}", get(image))
      .route("/ws", get(ws))
      .fallback(get(asset))
      .with_state(Ctx {
        app: self.app.clone(),
        hub: Arc::clone(&self.hub),
        store: Arc::clone(&self.store),
        shutdown: shutdown_rx.clone(),
      });

    let mut signal = shutdown_rx;
    let task = tokio::spawn(async move {
      let result = axum::serve(listener, router)
        .with_graceful_shutdown(async move {
          let _ = signal.wait_for(|stop| *stop).await;
        })
        .await;
      if let Err(err) = result {
        log::error!("OBS server stopped: {err}");
      }
    });

    *running = Some(Running { shutdown, task });
  }

  /// Stops serving and waits for the port to be released, so switching OBS
  /// output straight back on can bind it again.
  pub async fn stop(&self) {
    let Some(Running { shutdown, task }) = self.running.lock().await.take() else {
      return;
    };
    let _ = shutdown.send(true);
    if tokio::time::timeout(Duration::from_secs(3), task).await.is_err() {
      log::warn!("OBS server did not stop in time");
    }
  }
}

/// The active profile — OBS always renders whichever one the editor shows.
async fn profile(State(ctx): State<Ctx>) -> Response {
  let Some(id) = ctx.store.active_profile_id() else {
    return StatusCode::NOT_FOUND.into_response();
  };
  match ctx.store.read_profile(&id) {
    Ok(Some(json)) => ([(header::CONTENT_TYPE, "application/json")], json).into_response(),
    Ok(None) => StatusCode::NOT_FOUND.into_response(),
    Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
  }
}

async fn image(State(ctx): State<Ctx>, Path(id): Path<String>) -> Response {
  match ctx.store.get_image(&id) {
    Ok(Some((bytes, mime))) => ([(header::CONTENT_TYPE, mime)], bytes).into_response(),
    Ok(None) => StatusCode::NOT_FOUND.into_response(),
    Err(_) => StatusCode::BAD_REQUEST.into_response(),
  }
}

/// Serves the frontend. In `tauri dev` the bundle is not embedded, so requests
/// are sent on to the Vite dev server instead — which proxies `/api` and `/ws`
/// back here, keeping the page same-origin with this API either way.
async fn asset(State(ctx): State<Ctx>, uri: Uri) -> Response {
  if tauri::is_dev()
    && let Some(dev_url) = &ctx.app.config().build.dev_url
  {
    let target = format!(
      "{}{}",
      dev_url.as_str().trim_end_matches('/'),
      uri.path_and_query().map_or("/", |p| p.as_str())
    );
    return Redirect::temporary(&target).into_response();
  }

  let path = match uri.path() {
    "/" => "index.html".to_string(),
    path => path.trim_start_matches('/').to_string(),
  };
  match ctx.app.asset_resolver().get(path) {
    Some(asset) => ([(header::CONTENT_TYPE, asset.mime_type)], asset.bytes).into_response(),
    None => StatusCode::NOT_FOUND.into_response(),
  }
}

/// Pages allowed to open the stream: OBS on this server and the Vite dev
/// server. (The app window gets its feed over IPC instead.) Any other website the user visits is refused, since
/// the frames are derived from their microphone.
fn origin_allowed(headers: &HeaderMap) -> bool {
  let Some(origin) = headers.get(header::ORIGIN) else {
    // Not a browser; a local process could read the mic directly anyway.
    return true;
  };
  let Ok(origin) = origin.to_str() else {
    return false;
  };
  let own = [
    format!("http://localhost:{PORT}"),
    format!("http://127.0.0.1:{PORT}"),
  ];
  let dev = ["http://localhost:5173", "http://127.0.0.1:5173"];
  own.iter().any(|o| o == origin) || (tauri::is_dev() && dev.contains(&origin))
}

async fn ws(State(ctx): State<Ctx>, headers: HeaderMap, upgrade: WebSocketUpgrade) -> Response {
  if !origin_allowed(&headers) {
    return StatusCode::FORBIDDEN.into_response();
  }
  upgrade.on_upgrade(move |socket| stream(socket, ctx.hub, ctx.shutdown))
}

async fn stream(mut socket: WebSocket, hub: Arc<Hub>, mut shutdown: watch::Receiver<bool>) {
  let mut frames = hub.frames.subscribe();
  let mut status = hub.status.subscribe();
  let mut revision = hub.profile_revision.subscribe();

  // Current state first, so a page that connects mid-stream is not stuck
  // waiting for the next change to learn what is going on.
  let hello = [
    status_message(&status.borrow_and_update()),
    profile_message(*revision.borrow_and_update()),
  ];
  for message in hello {
    if socket.send(message).await.is_err() {
      return;
    }
  }

  loop {
    let message = tokio::select! {
      changed = frames.changed() => {
        if changed.is_err() { return; }
        Message::Binary(frames.borrow_and_update().clone())
      }
      changed = status.changed() => {
        if changed.is_err() { return; }
        status_message(&status.borrow_and_update())
      }
      changed = revision.changed() => {
        if changed.is_err() { return; }
        profile_message(*revision.borrow_and_update())
      }
      // Closing is sent after the select: the guard wait_for returns is not
      // Send, so it must be gone before the next await.
      stopped = shutdown.wait_for(|stop| *stop) => {
        drop(stopped);
        Message::Close(None)
      }
      incoming = socket.recv() => match incoming {
        // The page never sends anything meaningful; this arm exists to notice
        // it closing.
        Some(Ok(_)) => continue,
        _ => return,
      },
    };
    let closing = matches!(message, Message::Close(_));
    if socket.send(message).await.is_err() || closing {
      return;
    }
  }
}

fn status_message(status: &crate::hub::AudioStatus) -> Message {
  let mut value = serde_json::to_value(status).unwrap_or_default();
  value["type"] = json!("status");
  Message::Text(value.to_string().into())
}

fn profile_message(revision: u64) -> Message {
  Message::Text(json!({ "type": "profile", "revision": revision }).to_string().into())
}

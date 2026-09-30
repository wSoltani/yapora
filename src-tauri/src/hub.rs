//! Fan-out from the audio thread and the store to every connected page.
//!
//! Everything here is a `watch` channel: a page that falls behind should skip
//! straight to the newest spectrum, never replay a backlog of stale ones.

use axum::body::Bytes;
use serde::Serialize;
use tokio::sync::watch;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
  /// `idle`, `running`, `denied` or `error` — a subset of the page's MicStatus.
  pub status: &'static str,
  pub error: Option<String>,
  /// The saved device was absent and the system default was used instead.
  pub device_missing: bool,
}

impl AudioStatus {
  pub fn idle() -> Self {
    Self {
      status: "idle",
      ..Self::default()
    }
  }
}

pub struct Hub {
  /// Latest analysis frame; see `audio::encode_frame` for the layout.
  pub frames: watch::Sender<Bytes>,
  pub status: watch::Sender<AudioStatus>,
  /// Bumped on every profile save so read-only pages know to refetch.
  pub profile_revision: watch::Sender<u64>,
}

impl Hub {
  pub fn new() -> Self {
    Self {
      frames: watch::Sender::new(Bytes::new()),
      status: watch::Sender::new(AudioStatus::idle()),
      profile_revision: watch::Sender::new(0),
    }
  }

  pub fn set_status(&self, status: AudioStatus) {
    self.status.send_if_modified(|current| {
      if *current == status {
        return false;
      }
      *current = status;
      true
    });
  }
}

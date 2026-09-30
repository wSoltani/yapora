//! Profile and avatar images on disk, in the app data directory.
//!
//! The editor writes through Tauri commands; the OBS page only ever reads, over
//! HTTP. Both go through this one place, so there is exactly one copy of the
//! look and OBS can never drift from what the editor shows.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const PROFILE_FILE: &str = "profile.json";
const SETTINGS_FILE: &str = "settings.json";
const IMAGE_DIR: &str = "images";

/// Extensions an image id may carry, with the MIME type each is served as.
/// The id carries its own type so neither side needs a sidecar file.
const IMAGE_TYPES: &[(&str, &str)] = &[
  ("png", "image/png"),
  ("jpg", "image/jpeg"),
  ("gif", "image/gif"),
  ("webp", "image/webp"),
  ("avif", "image/avif"),
  ("bmp", "image/bmp"),
  ("svg", "image/svg+xml"),
  ("bin", "application/octet-stream"),
];

/// App-wide settings: things about this machine and app rather than about a
/// look, so they stay put when the profile changes.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
  /// Serve the live page and stream to OBS on the local port.
  pub obs_enabled: bool,
}

impl Default for Settings {
  fn default() -> Self {
    Self { obs_enabled: true }
  }
}

pub struct Store {
  root: PathBuf,
  counter: AtomicU64,
}

impl Store {
  pub fn new(root: PathBuf) -> io::Result<Self> {
    fs::create_dir_all(root.join(IMAGE_DIR))?;
    Ok(Self {
      root,
      counter: AtomicU64::new(0),
    })
  }

  pub fn read_profile(&self) -> io::Result<Option<Vec<u8>>> {
    read_optional(&self.root.join(PROFILE_FILE))
  }

  pub fn write_profile(&self, json: &[u8]) -> io::Result<()> {
    write_atomic(&self.root.join(PROFILE_FILE), json)
  }

  /// Missing or unreadable settings fall back to defaults; a bad file should
  /// never keep the app from starting.
  pub fn read_settings(&self) -> Settings {
    read_optional(&self.root.join(SETTINGS_FILE))
      .ok()
      .flatten()
      .and_then(|bytes| serde_json::from_slice(&bytes).ok())
      .unwrap_or_default()
  }

  pub fn write_settings(&self, settings: &Settings) -> io::Result<()> {
    let json = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
    write_atomic(&self.root.join(SETTINGS_FILE), &json)
  }

  /// Stores an image and returns its id, e.g. `m1abc2-3.png`.
  pub fn put_image(&self, bytes: &[u8], mime: &str) -> io::Result<String> {
    let ext = IMAGE_TYPES
      .iter()
      .find(|(_, m)| *m == mime)
      .map_or("bin", |(ext, _)| ext);
    let millis = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map_or(0, |d| d.as_millis());
    let n = self.counter.fetch_add(1, Ordering::Relaxed);
    let id = format!("{millis:x}-{n:x}.{ext}");
    write_atomic(&self.image_path(&id)?, bytes)?;
    Ok(id)
  }

  /// Returns the image bytes and MIME type, or `None` if it does not exist.
  pub fn get_image(&self, id: &str) -> io::Result<Option<(Vec<u8>, &'static str)>> {
    let path = self.image_path(id)?;
    Ok(read_optional(&path)?.map(|bytes| (bytes, mime_for(id))))
  }

  pub fn delete_image(&self, id: &str) -> io::Result<()> {
    match fs::remove_file(self.image_path(id)?) {
      Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
      other => other,
    }
  }

  /// Ids come from the page and end up in a filesystem path, so anything that
  /// is not exactly the shape `put_image` produces is refused outright.
  fn image_path(&self, id: &str) -> io::Result<PathBuf> {
    let valid = id.len() <= 64
      && id.split_once('.').is_some_and(|(stem, ext)| {
        !stem.is_empty()
          && stem.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
          && IMAGE_TYPES.iter().any(|(e, _)| *e == ext)
      });
    if !valid {
      return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid image id"));
    }
    Ok(self.root.join(IMAGE_DIR).join(id))
  }
}

fn mime_for(id: &str) -> &'static str {
  let ext = id.rsplit('.').next().unwrap_or_default();
  IMAGE_TYPES
    .iter()
    .find(|(e, _)| *e == ext)
    .map_or("application/octet-stream", |(_, m)| m)
}

fn read_optional(path: &Path) -> io::Result<Option<Vec<u8>>> {
  match fs::read(path) {
    Ok(bytes) => Ok(Some(bytes)),
    Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
    Err(err) => Err(err),
  }
}

/// Write-then-rename, so a crash mid-save leaves the previous profile intact
/// rather than a truncated file that fails to parse on the next launch.
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
  let tmp = path.with_extension("tmp");
  fs::write(&tmp, bytes)?;
  fs::rename(&tmp, path)
}

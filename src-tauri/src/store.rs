//! Profiles, avatar images and app settings on disk, in the app data directory.
//!
//! The editor writes through Tauri commands; the OBS page only ever reads, over
//! HTTP. Both go through this one place, so there is exactly one copy of each
//! look and OBS can never drift from what the editor shows.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Where the single profile lived before there were several.
const LEGACY_PROFILE_FILE: &str = "profile.json";
const PROFILE_DIR: &str = "profiles";
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
  /// The profile the editor shows and OBS renders.
  pub active_profile: Option<String>,
  /// The microphone names hardware on this machine, so it belongs to the
  /// app rather than to any one look. `None` is the system default.
  pub mic_device: Option<String>,
}

impl Default for Settings {
  fn default() -> Self {
    Self {
      obs_enabled: true,
      active_profile: None,
      mic_device: None,
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
  pub id: String,
  pub name: String,
}

pub struct Store {
  root: PathBuf,
  counter: AtomicU64,
  /// Serialises read-modify-write of the settings file.
  settings_lock: Mutex<()>,
}

impl Store {
  pub fn new(root: PathBuf) -> io::Result<Self> {
    fs::create_dir_all(root.join(IMAGE_DIR))?;
    fs::create_dir_all(root.join(PROFILE_DIR))?;
    let store = Self {
      root,
      counter: AtomicU64::new(0),
      settings_lock: Mutex::new(()),
    };
    store.migrate_legacy_profile()?;
    Ok(store)
  }

  /// Moves the old single `profile.json` into the profiles folder and makes
  /// it active, lifting its microphone choice into the app settings.
  fn migrate_legacy_profile(&self) -> io::Result<()> {
    let legacy = self.root.join(LEGACY_PROFILE_FILE);
    let Some(bytes) = read_optional(&legacy)? else {
      return Ok(());
    };

    if let Ok(mut profile) = serde_json::from_slice::<Value>(&bytes) {
      let id = profile["id"]
        .as_str()
        .filter(|id| valid_profile_id(id))
        .unwrap_or("default")
        .to_string();
      profile["id"] = Value::String(id.clone());
      let device = profile["audio"]["deviceId"].as_str().map(str::to_string);

      self.write_profile(&id, &profile)?;
      self.update_settings(|settings| {
        settings.active_profile.get_or_insert(id);
        if settings.mic_device.is_none() {
          settings.mic_device = device;
        }
      })?;
    }

    fs::remove_file(legacy)
  }

  // --- settings -------------------------------------------------------------

  /// Missing or unreadable settings fall back to defaults; a bad file should
  /// never keep the app from starting.
  pub fn read_settings(&self) -> Settings {
    read_optional(&self.root.join(SETTINGS_FILE))
      .ok()
      .flatten()
      .and_then(|bytes| serde_json::from_slice(&bytes).ok())
      .unwrap_or_default()
  }

  pub fn update_settings(&self, change: impl FnOnce(&mut Settings)) -> io::Result<Settings> {
    let _guard = self.settings_lock.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = self.read_settings();
    change(&mut settings);
    let json = serde_json::to_vec_pretty(&settings).map_err(io::Error::other)?;
    write_atomic(&self.root.join(SETTINGS_FILE), &json)?;
    Ok(settings)
  }

  // --- profiles -------------------------------------------------------------

  /// The active profile's id, falling back to any profile that exists if the
  /// saved one was deleted. `None` only when there are no profiles at all.
  pub fn active_profile_id(&self) -> Option<String> {
    let saved = self.read_settings().active_profile;
    if let Some(id) = saved.filter(|id| self.profile_path(id).is_ok_and(|p| p.exists())) {
      return Some(id);
    }
    self.list_profiles().ok()?.into_iter().next().map(|p| p.id)
  }

  pub fn list_profiles(&self) -> io::Result<Vec<ProfileSummary>> {
    let mut profiles = Vec::new();
    for entry in fs::read_dir(self.root.join(PROFILE_DIR))? {
      let path = entry?.path();
      let Some(id) = path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_suffix(".json"))
        .filter(|id| valid_profile_id(id))
      else {
        continue;
      };
      let name = read_json(&path)
        .and_then(|profile| profile["name"].as_str().map(str::to_string))
        .unwrap_or_else(|| id.to_string());
      profiles.push(ProfileSummary {
        id: id.to_string(),
        name,
      });
    }
    profiles.sort_by_key(|p| p.name.to_lowercase());
    Ok(profiles)
  }

  pub fn read_profile(&self, id: &str) -> io::Result<Option<Vec<u8>>> {
    read_optional(&self.profile_path(id)?)
  }

  pub fn write_profile(&self, id: &str, profile: &Value) -> io::Result<()> {
    let json = serde_json::to_vec_pretty(profile).map_err(io::Error::other)?;
    write_atomic(&self.profile_path(id)?, &json)
  }

  pub fn delete_profile(&self, id: &str) -> io::Result<()> {
    match fs::remove_file(self.profile_path(id)?) {
      Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
      other => other,
    }
  }

  fn profile_path(&self, id: &str) -> io::Result<PathBuf> {
    if !valid_profile_id(id) {
      return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid profile id"));
    }
    Ok(self.root.join(PROFILE_DIR).join(format!("{id}.json")))
  }

  // --- images ---------------------------------------------------------------

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

  /// Deletes images no profile refers to.
  ///
  /// A duplicated profile shares its original's image, so replacing the image
  /// in one cannot delete the old file on the spot — the other may still show
  /// it. Sweeping by reference instead is always safe. Profiles that fail to
  /// parse abort the sweep rather than orphaning everything they point at.
  pub fn collect_images(&self) -> io::Result<()> {
    let mut referenced = HashSet::new();
    for profile in self.list_profiles()? {
      let path = self.profile_path(&profile.id)?;
      let Some(json) = read_json(&path) else {
        return Ok(());
      };
      if let Some(key) = json["avatar"]["imageKey"].as_str() {
        referenced.insert(key.to_string());
      }
    }

    for entry in fs::read_dir(self.root.join(IMAGE_DIR))? {
      let path = entry?.path();
      let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        continue;
      };
      // Only files this store created, and never a write still in progress.
      if self.image_path(name).is_ok() && !referenced.contains(name) {
        let _ = fs::remove_file(&path);
      }
    }
    Ok(())
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

/// Profile ids are generated by the page and become file names.
pub fn valid_profile_id(id: &str) -> bool {
  !id.is_empty()
    && id.len() <= 64
    && id
      .bytes()
      .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn mime_for(id: &str) -> &'static str {
  let ext = id.rsplit('.').next().unwrap_or_default();
  IMAGE_TYPES
    .iter()
    .find(|(e, _)| *e == ext)
    .map_or("application/octet-stream", |(_, m)| m)
}

fn read_json(path: &Path) -> Option<Value> {
  serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn read_optional(path: &Path) -> io::Result<Option<Vec<u8>>> {
  match fs::read(path) {
    Ok(bytes) => Ok(Some(bytes)),
    Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
    Err(err) => Err(err),
  }
}

/// Write-then-rename, so a crash mid-save leaves the previous file intact
/// rather than a truncated one that fails to parse on the next launch.
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
  let tmp = path.with_extension("tmp");
  fs::write(&tmp, bytes)?;
  fs::rename(&tmp, path)
}

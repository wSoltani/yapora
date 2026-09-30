//! Video export, Rust side: the offline analysis the page renders from, the
//! audio it muxes in, and the file it writes to.
//!
//! The page drives the loop — it owns the renderer and the WebCodecs encoder —
//! and pulls data from here in batches. The output goes straight to disk as
//! the muxer produces it, so a long export never has to fit in memory.

use std::fs::{self, File};
use std::io::{self, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;

use crate::audio::file::Track;
use crate::audio::offline::OfflineAnalysis;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInfo {
  pub channels: usize,
  pub sample_rate: u32,
  pub frames: usize,
  pub duration: f64,
}

pub struct ExportSession {
  track: Arc<Track>,
  analysis: OfflineAnalysis,
  file: File,
  path: PathBuf,
}

impl ExportSession {
  pub fn create(
    track: Arc<Track>,
    path: PathBuf,
    fft_size: usize,
    smoothing: f32,
  ) -> io::Result<Self> {
    let file = File::create(&path)?;
    Ok(Self {
      analysis: OfflineAnalysis::new(Arc::clone(&track), fft_size, smoothing),
      track,
      file,
      path,
    })
  }

  pub fn info(&self) -> ExportInfo {
    ExportInfo {
      channels: self.track.channels,
      sample_rate: self.track.rate,
      frames: self.track.frames,
      duration: self.track.duration(),
    }
  }

  /// Analysis frames for video frames `start..start + count` at `fps`,
  /// concatenated. Every frame has the same length for a given FFT size.
  pub fn analysis(&mut self, fps: f64, start: u32, count: u32) -> Vec<u8> {
    let mut out = Vec::new();
    for index in start..start + count {
      out.extend_from_slice(&self.analysis.frame_at(index as f64 / fps));
    }
    out
  }

  /// Interleaved f32 samples for source frames `start..start + count`, as
  /// little-endian bytes; shorter at the end of the track.
  pub fn pcm(&self, start: usize, count: usize) -> Vec<u8> {
    let channels = self.track.channels;
    let from = start.min(self.track.frames) * channels;
    let to = (start + count).min(self.track.frames) * channels;
    self.track.samples[from..to]
      .iter()
      .flat_map(|s| s.to_le_bytes())
      .collect()
  }

  /// The muxer writes mostly in order but seeks back to patch headers.
  pub fn write(&mut self, position: u64, bytes: &[u8]) -> io::Result<()> {
    self.file.seek(SeekFrom::Start(position))?;
    self.file.write_all(bytes)
  }

  pub fn finish(mut self) -> io::Result<()> {
    self.file.flush()?;
    self.file.sync_all()
  }

  /// Cancelled or failed: a half-written video is worse than none.
  pub fn abort(self) {
    let Self { file, path, .. } = self;
    drop(file);
    let _ = fs::remove_file(path);
  }
}

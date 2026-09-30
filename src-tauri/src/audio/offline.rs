//! The live analysis, replayed faster than real time for video export.
//!
//! Live, the worker analyses whatever was played since the previous tick, 60
//! times a second. Export walks the same tick grid over the file, so the
//! smoothing — which advances once per tick — and therefore the whole look
//! match what the preview showed, at any output frame rate.

use std::sync::Arc;

use axum::body::Bytes;

use super::analyser::Analyser;
use super::file::Track;
use super::{TICKS_PER_SECOND, encode_frame};

pub struct OfflineAnalysis {
  track: Arc<Track>,
  analyser: Analyser,
  /// Ticks analysed so far; tick k covers samples up to k / 60 s.
  ticks: u64,
  /// Next source frame to feed the analyser.
  cursor: usize,
  samples: Vec<f32>,
  spectrum: Vec<f32>,
  latest: Bytes,
}

impl OfflineAnalysis {
  pub fn new(track: Arc<Track>, fft_size: usize, smoothing: f32) -> Self {
    let mut analyser = Analyser::new(fft_size, smoothing);
    let mut spectrum = Vec::new();
    // Before the first tick the preview shows silence; so does frame zero.
    analyser.spectrum_db(&mut spectrum);
    let latest = encode_frame(analyser.rms_db(), track.rate as f32, &spectrum);
    Self {
      track,
      analyser,
      ticks: 0,
      cursor: 0,
      samples: Vec::new(),
      spectrum,
      latest,
    }
  }

  /// The analysis frame the preview would be showing at `seconds`: the most
  /// recent tick at or before it. Calls must move forward in time.
  pub fn frame_at(&mut self, seconds: f64) -> Bytes {
    let target = (seconds * TICKS_PER_SECOND as f64 + 1e-9).floor() as u64;
    while self.ticks < target {
      self.ticks += 1;
      let end = ((self.ticks as f64 / TICKS_PER_SECOND as f64) * self.track.rate as f64) as usize;
      let end = end.min(self.track.frames);
      self.samples.clear();
      self.samples.extend((self.cursor..end).map(|f| self.track.mono(f)));
      self.cursor = end;
      self.analyser.push(&self.samples);
      self.analyser.spectrum_db(&mut self.spectrum);
      self.latest = encode_frame(
        self.analyser.rms_db(),
        self.track.rate as f32,
        &self.spectrum,
      );
    }
    self.latest.clone()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn track(frames: usize) -> Arc<Track> {
    Arc::new(Track {
      name: "t".into(),
      samples: (0..frames).map(|i| ((i as f32) * 0.05).sin()).collect(),
      channels: 1,
      rate: 48_000,
      frames,
    })
  }

  #[test]
  fn frames_follow_the_live_tick_grid() {
    let mut offline = OfflineAnalysis::new(track(48_000), 2048, 0.6);
    let silent = offline.frame_at(0.0);
    // Between ticks the frame does not change, as in the live preview.
    let first = offline.frame_at(1.0 / 60.0);
    assert_ne!(silent, first);
    assert_eq!(first, offline.frame_at(1.5 / 60.0));
    // 30 fps samples every other tick.
    let later = offline.frame_at(2.0 / 60.0);
    assert_ne!(first, later);
    assert_eq!(offline.ticks, 2);
    assert_eq!(offline.cursor, 1_600);
  }

  #[test]
  fn frames_past_the_end_are_silence_not_a_panic() {
    let mut offline = OfflineAnalysis::new(track(4_800), 512, 0.0);
    let frame = offline.frame_at(5.0);
    assert_eq!(offline.cursor, 4_800);
    // [rmsDb, sampleRate, ...spectrum] as little-endian f32.
    assert_eq!(frame.len(), (2 + 256) * 4);
  }
}

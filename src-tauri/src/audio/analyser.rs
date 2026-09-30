//! A reimplementation of the Web Audio `AnalyserNode` frequency analysis.
//!
//! The page used to read the spectrum straight from an AnalyserNode, and every
//! tuning default — gate, ceiling, smoothing, tilt — was chosen against its
//! output. Matching the spec exactly (Blackman window, 1/N magnitude, smoothing
//! on linear magnitudes, then dB) means a profile tuned in the browser behaves
//! the same when the audio comes from here instead.
//! https://webaudio.github.io/web-audio-api/#fft-windowing-and-smoothing-over-time

use std::f32::consts::PI;
use std::sync::Arc;

use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};

/// Largest FFT size the profile schema allows; the history is sized for it.
pub const MAX_FFT_SIZE: usize = 4096;

/// dB reported for exact silence. The page maps its window well above this, so
/// it only has to be finite and low.
const SILENCE_DB: f32 = -200.0;

pub struct Analyser {
  fft_size: usize,
  smoothing: f32,
  planner: FftPlanner<f32>,
  fft: Arc<dyn Fft<f32>>,
  window: Vec<f32>,
  buffer: Vec<Complex32>,
  scratch: Vec<Complex32>,
  smoothed: Vec<f32>,
  /// Most recent `MAX_FFT_SIZE` samples, oldest first after `write` wraps.
  history: Vec<f32>,
  write: usize,
}

impl Analyser {
  pub fn new(fft_size: usize, smoothing: f32) -> Self {
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_size);
    let mut analyser = Self {
      fft_size,
      smoothing,
      planner,
      fft,
      window: Vec::new(),
      buffer: Vec::new(),
      scratch: Vec::new(),
      smoothed: Vec::new(),
      history: vec![0.0; MAX_FFT_SIZE],
      write: 0,
    };
    analyser.configure(fft_size, smoothing);
    analyser
  }

  pub fn configure(&mut self, fft_size: usize, smoothing: f32) {
    let fft_size = fft_size.clamp(32, MAX_FFT_SIZE).next_power_of_two();
    self.smoothing = smoothing.clamp(0.0, 1.0);
    if fft_size == self.fft_size && !self.window.is_empty() {
      return;
    }

    self.fft_size = fft_size;
    self.fft = self.planner.plan_fft_forward(fft_size);
    let n = fft_size as f32;
    self.window = (0..fft_size)
      .map(|i| {
        let x = i as f32 / n;
        0.42 - 0.5 * (2.0 * PI * x).cos() + 0.08 * (4.0 * PI * x).cos()
      })
      .collect();
    self.buffer = vec![Complex32::default(); fft_size];
    self.scratch = vec![Complex32::default(); self.fft.get_inplace_scratch_len()];
    // Like the AnalyserNode, a size change starts the smoothing over.
    self.smoothed = vec![0.0; fft_size / 2];
  }

  pub fn push(&mut self, samples: &[f32]) {
    for &sample in samples {
      self.history[self.write] = sample;
      self.write = (self.write + 1) % MAX_FFT_SIZE;
    }
  }

  pub fn reset(&mut self) {
    self.history.fill(0.0);
    self.smoothed.fill(0.0);
  }

  /// The `i`th of the most recent `fft_size` samples, oldest first.
  fn recent(&self, i: usize) -> f32 {
    let start = self.write + MAX_FFT_SIZE - self.fft_size;
    self.history[(start + i) % MAX_FFT_SIZE]
  }

  /// RMS of the most recent `fft_size` samples in dBFS — what the page got
  /// from `getFloatTimeDomainData`.
  pub fn rms_db(&self) -> f32 {
    let sum: f32 = (0..self.fft_size).map(|i| self.recent(i).powi(2)).sum();
    let rms = (sum / self.fft_size as f32).sqrt();
    20.0 * rms.max(1e-7).log10()
  }

  /// Advances the smoothing by one step and writes `fft_size / 2` dB values —
  /// what the page got from `getFloatFrequencyData`.
  pub fn spectrum_db(&mut self, out: &mut Vec<f32>) {
    for i in 0..self.fft_size {
      self.buffer[i] = Complex32::new(self.recent(i) * self.window[i], 0.0);
    }
    self.fft.process_with_scratch(&mut self.buffer, &mut self.scratch);

    let scale = 1.0 / self.fft_size as f32;
    let tau = self.smoothing;
    out.clear();
    for (k, smoothed) in self.smoothed.iter_mut().enumerate() {
      let magnitude = self.buffer[k].norm() * scale;
      let next = tau * *smoothed + (1.0 - tau) * magnitude;
      *smoothed = if next.is_finite() { next } else { 0.0 };
      out.push(if *smoothed > 0.0 {
        20.0 * smoothed.log10()
      } else {
        SILENCE_DB
      });
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sine(freq: f32, amplitude: f32, sample_rate: f32, count: usize) -> Vec<f32> {
    (0..count)
      .map(|i| amplitude * (2.0 * PI * freq * i as f32 / sample_rate).sin())
      .collect()
  }

  #[test]
  fn full_scale_sine_matches_analyser_node() {
    let mut analyser = Analyser::new(2048, 0.0);
    // Centred on bin 43 so the peak falls on one bin.
    let freq = 43.0 * 48_000.0 / 2048.0;
    analyser.push(&sine(freq, 1.0, 48_000.0, 4096));

    let mut spectrum = Vec::new();
    analyser.spectrum_db(&mut spectrum);
    assert_eq!(spectrum.len(), 1024);

    let (peak_bin, &peak_db) = spectrum
      .iter()
      .enumerate()
      .max_by(|a, b| a.1.total_cmp(b.1))
      .unwrap();
    assert_eq!(peak_bin, 43);
    // Blackman's coherent gain is 0.42 and a real sine splits its energy
    // across ±f, so the AnalyserNode reports 20·log10(0.21) ≈ -13.6 dB.
    assert!((peak_db - -13.56).abs() < 0.1, "peak {peak_db} dB");
    // A sine's RMS is amplitude/√2, i.e. -3 dBFS.
    assert!((analyser.rms_db() - -3.01).abs() < 0.05);
  }

  #[test]
  fn smoothing_averages_across_calls() {
    let mut analyser = Analyser::new(512, 0.5);
    let freq = 16.0 * 48_000.0 / 512.0;
    analyser.push(&sine(freq, 1.0, 48_000.0, 512));
    let mut spectrum = Vec::new();
    analyser.spectrum_db(&mut spectrum);
    // Half of the new magnitude on the first call: 6 dB below steady state.
    assert!((spectrum[16] - (-13.56 - 6.02)).abs() < 0.1, "{}", spectrum[16]);
  }

  #[test]
  fn silence_is_finite_and_low() {
    let mut analyser = Analyser::new(1024, 0.6);
    let mut spectrum = Vec::new();
    analyser.spectrum_db(&mut spectrum);
    assert!(spectrum.iter().all(|&db| db == SILENCE_DB));
    assert!(analyser.rms_db() <= -139.0);
  }

  #[test]
  fn synthetic_signal_speaks_at_a_sensible_level() {
    let mut generator = super::super::synthetic::Synthetic::new(48_000.0);
    let mut samples = Vec::new();
    // Six seconds covers a full syllable cycle and most of a phrase.
    generator.fill(&mut samples, 48_000 * 6);
    assert!(samples.iter().all(|s| s.is_finite() && s.abs() < 2.0));

    let loudest = samples
      .chunks(2048)
      .map(|chunk| {
        let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();
        20.0 * rms.max(1e-7).log10()
      })
      .fold(f32::MIN, f32::max);
    let quietest = samples
      .chunks(2048)
      .map(|chunk| chunk.iter().map(|s| s * s).sum::<f32>())
      .fold(f32::MAX, f32::min);
    // Loud enough to clear the default gate (-55 dB) on syllables, and with
    // gaps quiet enough to close it again.
    assert!(loudest > -30.0, "loudest {loudest} dB");
    assert!(quietest < 1e-3);
  }
}

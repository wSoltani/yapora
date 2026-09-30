//! The speech-shaped test signal, ported from the old Web Audio graph so the
//! OBS page sees it too — tuning against it is only useful if the stream
//! reacts the same way the editor does.
//!
//! A ~120Hz sawtooth through a sweeping bandpass stands in for vowels,
//! highpassed noise for consonants, and two slow sine envelopes chop it into
//! syllables and phrases so the gate opens and closes like real speech.

use std::f32::consts::TAU;

pub struct Synthetic {
  sample_rate: f32,
  /// Seconds since start; drives the LFOs and envelopes.
  t: f64,
  saw_phase: f32,
  formant: Biquad,
  noise_filter: Biquad,
  rng: u32,
}

impl Synthetic {
  pub fn new(sample_rate: f32) -> Self {
    let mut noise_filter = Biquad::default();
    // Web Audio's highpass Q is a resonance in dB; its default of 1 is ~1.12.
    noise_filter.highpass(2000.0, 10f32.powf(1.0 / 20.0), sample_rate);
    Self {
      sample_rate,
      t: 0.0,
      saw_phase: 0.0,
      formant: Biquad::default(),
      noise_filter,
      rng: 0x9E37_79B9,
    }
  }

  pub fn sample_rate(&self) -> f32 {
    self.sample_rate
  }

  pub fn fill(&mut self, out: &mut Vec<f32>, count: usize) {
    let dt = 1.0 / self.sample_rate as f64;
    for i in 0..count {
      let t = self.t as f32;

      // Retuning the sweeping filter every 32 samples is inaudible and keeps
      // the trig out of the per-sample path.
      if i % 32 == 0 {
        let centre = 700.0 + 600.0 * (TAU * 0.7 * t).sin();
        self.formant.bandpass(centre.max(40.0), 2.0, self.sample_rate);
      }

      let saw = 2.0 * self.saw_phase - 1.0;
      self.saw_phase = (self.saw_phase + 120.0 / self.sample_rate).fract();
      let voiced = self.formant.process(saw);

      let white = self.next_noise();
      let noise = self.noise_filter.process(white) * 0.18;

      let syllable = 0.5 + 0.5 * (TAU * 3.2 * t).sin();
      let phrase = 0.45 + 0.55 * (TAU * 0.18 * t).sin();

      out.push((voiced + noise) * syllable * phrase);
      self.t += dt;
    }
  }

  /// xorshift32 white noise in -1..1; quality is irrelevant here.
  fn next_noise(&mut self) -> f32 {
    let mut x = self.rng;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    self.rng = x;
    (x as f32 / u32::MAX as f32) * 2.0 - 1.0
  }
}

/// RBJ cookbook biquad, matching the Web Audio BiquadFilterNode formulas.
#[derive(Default)]
struct Biquad {
  b0: f32,
  b1: f32,
  b2: f32,
  a1: f32,
  a2: f32,
  x1: f32,
  x2: f32,
  y1: f32,
  y2: f32,
}

impl Biquad {
  fn set(&mut self, b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) {
    self.b0 = b0 / a0;
    self.b1 = b1 / a0;
    self.b2 = b2 / a0;
    self.a1 = a1 / a0;
    self.a2 = a2 / a0;
  }

  /// Constant 0dB peak gain bandpass, as Web Audio's `bandpass` type.
  fn bandpass(&mut self, freq: f32, q: f32, sample_rate: f32) {
    let w0 = TAU * freq / sample_rate;
    let alpha = w0.sin() / (2.0 * q);
    let cos = w0.cos();
    self.set(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha);
  }

  fn highpass(&mut self, freq: f32, q: f32, sample_rate: f32) {
    let w0 = TAU * freq / sample_rate;
    let alpha = w0.sin() / (2.0 * q);
    let cos = w0.cos();
    self.set(
      (1.0 + cos) / 2.0,
      -(1.0 + cos),
      (1.0 + cos) / 2.0,
      1.0 + alpha,
      -2.0 * cos,
      1.0 - alpha,
    );
  }

  fn process(&mut self, x: f32) -> f32 {
    let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
      - self.a1 * self.y1
      - self.a2 * self.y2;
    self.x2 = self.x1;
    self.x1 = x;
    self.y2 = self.y1;
    self.y1 = y;
    y
  }
}

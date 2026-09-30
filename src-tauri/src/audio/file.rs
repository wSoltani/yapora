//! Audio files as a source: decoded whole into memory, played through the
//! default output device, and fed to the same analyser the microphone uses —
//! so the preview reacts exactly as it will on stream or in an export.

use std::fs::File;
use std::path::Path;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, FromSample, SampleFormat, SizedSample};
use serde::Serialize;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as DecodeError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// Buckets in the waveform overview drawn under the scrubber.
const PEAK_BUCKETS: usize = 1200;

/// A decoded file, interleaved at its own sample rate.
pub struct Track {
  pub name: String,
  pub samples: Vec<f32>,
  pub channels: usize,
  pub rate: u32,
  pub frames: usize,
}

impl Track {
  pub fn duration(&self) -> f64 {
    self.frames as f64 / self.rate as f64
  }

  /// Mono sample at a whole frame index, for analysis.
  pub fn mono(&self, frame: usize) -> f32 {
    let start = frame * self.channels;
    let sum: f32 = self.samples[start..start + self.channels].iter().sum();
    sum / self.channels as f32
  }

  /// Peak level per bucket across the whole file, 0..1.
  pub fn peaks(&self) -> Vec<f32> {
    let buckets = PEAK_BUCKETS.min(self.frames.max(1));
    let per = self.frames.div_ceil(buckets).max(1);
    (0..buckets)
      .map(|b| {
        let end = ((b + 1) * per).min(self.frames);
        (b * per..end)
          .map(|f| self.mono(f).abs())
          .fold(0.0, f32::max)
          .min(1.0)
      })
      .collect()
  }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
  pub name: String,
  pub duration: f64,
  pub peaks: Vec<f32>,
}

/// Decodes a whole file. Runs off the audio thread; a few minutes of audio is
/// tens of megabytes, which keeps seeking trivial and playback glitch-free.
pub fn decode(path: &Path) -> Result<Track, String> {
  let unreadable = |err: DecodeError| format!("Could not read that file: {err}");

  let file = File::open(path).map_err(|e| format!("Could not open that file: {e}"))?;
  let stream = MediaSourceStream::new(Box::new(file), Default::default());
  let mut hint = Hint::new();
  if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
    hint.with_extension(ext);
  }

  let mut format = symphonia::default::get_probe()
    .probe(
      &hint,
      stream,
      FormatOptions::default(),
      MetadataOptions::default(),
    )
    .map_err(|_| "That isn't an audio format Yapora can read.".to_string())?;
  let track = format
    .default_track(TrackType::Audio)
    .ok_or("That file has no audio in it.")?;
  let track_id = track.id;
  let params = track
    .codec_params
    .as_ref()
    .and_then(|p| p.audio())
    .ok_or("That file has no audio in it.")?;
  let mut decoder = symphonia::default::get_codecs()
    .make_audio_decoder(params, &AudioDecoderOptions::default())
    .map_err(unreadable)?;

  let mut samples = Vec::new();
  let mut chunk = Vec::new();
  let mut channels = 0;
  let mut rate = 0;

  while let Some(packet) = format.next_packet().map_err(unreadable)? {
    if packet.track_id != track_id {
      continue;
    }
    match decoder.decode(&packet) {
      Ok(buffer) => {
        channels = buffer.spec().channels().count();
        rate = buffer.spec().rate();
        chunk.resize(buffer.samples_interleaved(), 0.0);
        buffer.copy_to_slice_interleaved(&mut chunk);
        samples.extend_from_slice(&chunk);
      }
      // A corrupt packet costs a few milliseconds of audio, not the file.
      Err(DecodeError::DecodeError(_)) => continue,
      Err(err) => return Err(unreadable(err)),
    }
  }

  if channels == 0 || rate == 0 || samples.is_empty() {
    return Err("That file has no audio in it.".into());
  }

  Ok(Track {
    name: path
      .file_name()
      .map_or_else(|| "Audio".into(), |n| n.to_string_lossy().into_owned()),
    frames: samples.len() / channels,
    samples,
    channels,
    rate,
  })
}

/// Transport state, shared by the commands, the output callback and the
/// analysis worker.
#[derive(Default)]
pub struct Player {
  pub track: Option<Arc<Track>>,
  /// Name, duration and waveform, kept so a reloaded page can redraw them.
  pub info: Option<TrackInfo>,
  /// Playhead in source frames; fractional because playback resamples.
  pub position: f64,
  pub playing: bool,
  /// Mono source-rate samples played since the worker last drained them.
  pub pending: Vec<f32>,
  /// Set on seek or load: the analyser must be refilled from the new
  /// playhead, so a paused preview shows that moment rather than the last.
  pub moved: bool,
}

impl Player {
  pub fn seek(&mut self, seconds: f64) {
    let Some(track) = &self.track else { return };
    self.position = (seconds * track.rate as f64).clamp(0.0, track.frames as f64);
    self.pending.clear();
    self.moved = true;
  }

  pub fn play(&mut self) {
    let Some(track) = &self.track else { return };
    // Play at the end means play again.
    if self.position >= track.frames as f64 - 1.0 {
      self.position = 0.0;
      self.moved = true;
    }
    self.playing = true;
  }

  pub fn seconds(&self) -> f64 {
    self.track
      .as_ref()
      .map_or(0.0, |track| self.position / track.rate as f64)
  }
}

pub type SharedPlayer = Arc<Mutex<Player>>;

pub fn lock(player: &SharedPlayer) -> std::sync::MutexGuard<'_, Player> {
  player.lock().unwrap_or_else(|e| e.into_inner())
}

/// Opens an output device and plays whatever the player holds. A saved device
/// that is no longer present falls back to the system default, the same way
/// the microphone does.
pub fn open_output(
  player: &SharedPlayer,
  device_id: Option<&str>,
) -> Result<cpal::Stream, cpal::Error> {
  let host = cpal::default_host();
  let device = device_id
    .and_then(|id| id.parse().ok())
    .and_then(|id| host.device_by_id(&id))
    .or_else(|| host.default_output_device())
    .ok_or(cpal::Error::from(ErrorKind::DeviceNotAvailable))?;
  let config = device.default_output_config()?;

  let stream = match config.sample_format() {
    SampleFormat::F32 => build::<f32>(&device, &config, player)?,
    SampleFormat::F64 => build::<f64>(&device, &config, player)?,
    SampleFormat::I16 => build::<i16>(&device, &config, player)?,
    SampleFormat::I32 => build::<i32>(&device, &config, player)?,
    SampleFormat::U16 => build::<u16>(&device, &config, player)?,
    _ => return Err(ErrorKind::UnsupportedConfig.into()),
  };
  stream.play()?;
  Ok(stream)
}

fn build<T>(
  device: &cpal::Device,
  config: &cpal::SupportedStreamConfig,
  player: &SharedPlayer,
) -> Result<cpal::Stream, cpal::Error>
where
  T: SizedSample + FromSample<f32>,
{
  let out_channels = config.channels().max(1) as usize;
  let out_rate = config.sample_rate() as f64;
  let player = Arc::clone(player);

  device.build_output_stream(
    config.config(),
    move |data: &mut [T], _: &_| {
      let mut guard = lock(&player);
      render(&mut guard, data, out_channels, out_rate);
    },
    |err: cpal::Error| log::warn!("playback stream: {err}"),
    None,
  )
}

/// Fills one output buffer and records which source frames it consumed, so
/// the analyser sees exactly what is being heard.
fn render<T: SizedSample + FromSample<f32>>(
  player: &mut Player,
  data: &mut [T],
  out_channels: usize,
  out_rate: f64,
) {
  let silence = T::from_sample(0.0);
  let Some(track) = player.track.clone().filter(|_| player.playing) else {
    data.fill(silence);
    return;
  };

  let step = track.rate as f64 / out_rate;
  let last = (track.frames - 1) as f64;
  let start = player.position;

  for frame in data.chunks_mut(out_channels) {
    if player.position >= last {
      player.playing = false;
      player.position = track.frames as f64;
      frame.fill(silence);
      continue;
    }
    for (ch, out) in frame.iter_mut().enumerate() {
      let value = if track.channels == 1 || out_channels == 1 {
        interpolate(|f| track.mono(f), player.position, track.frames)
      } else {
        let src = ch % track.channels;
        interpolate(
          |f| track.samples[f * track.channels + src],
          player.position,
          track.frames,
        )
      };
      *out = T::from_sample(value);
    }
    player.position += step;
  }

  let (from, to) = (start as usize, (player.position as usize).min(track.frames));
  player.pending.extend((from..to).map(|f| track.mono(f)));
}

/// 4-point Hermite interpolation: clean enough for a preview at any pair of
/// sample rates, and far cheaper than a proper resampler.
fn interpolate(sample: impl Fn(usize) -> f32, position: f64, frames: usize) -> f32 {
  let i = position.floor() as isize;
  let t = (position - i as f64) as f32;
  let at = |k: isize| sample((i + k).clamp(0, frames as isize - 1) as usize);
  let (y0, y1, y2, y3) = (at(-1), at(0), at(1), at(2));
  let c1 = 0.5 * (y2 - y0);
  let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  ((c3 * t + c2) * t + c1) * t + y1
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A minimal 16-bit PCM WAV, so decoding is tested without fixture files.
  fn write_wav(path: &Path, rate: u32, channels: u16, frames: &[Vec<i16>]) {
    let data: Vec<u8> = frames
      .iter()
      .flat_map(|frame| frame.iter().flat_map(|s| s.to_le_bytes()))
      .collect();
    let block = channels * 2;
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * block as u32).to_le_bytes());
    bytes.extend_from_slice(&block.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&data);
    std::fs::write(path, bytes).unwrap();
  }

  #[test]
  fn decodes_a_stereo_wav() {
    let path = std::env::temp_dir().join("yapora-test-stereo.wav");
    let frames: Vec<Vec<i16>> = (0..44_100).map(|i| vec![(i % 100) as i16 * 100, 0]).collect();
    write_wav(&path, 44_100, 2, &frames);

    let track = decode(&path).unwrap();
    assert_eq!(track.channels, 2);
    assert_eq!(track.rate, 44_100);
    assert_eq!(track.frames, 44_100);
    assert!((track.duration() - 1.0).abs() < 1e-9);
    assert_eq!(track.peaks().len(), PEAK_BUCKETS);
    let _ = std::fs::remove_file(path);
  }

  #[test]
  fn rejects_a_non_audio_file() {
    let path = std::env::temp_dir().join("yapora-test-not-audio.wav");
    std::fs::write(&path, b"definitely not audio").unwrap();
    assert!(decode(&path).is_err());
    let _ = std::fs::remove_file(path);
  }

  fn player_with(frames: usize, rate: u32) -> Player {
    let track = Track {
      name: "t".into(),
      samples: (0..frames).map(|i| i as f32 / frames as f32).collect(),
      channels: 1,
      rate,
      frames,
    };
    Player {
      track: Some(Arc::new(track)),
      playing: true,
      ..Player::default()
    }
  }

  #[test]
  fn playback_resamples_and_reports_what_it_played() {
    // A 44.1 kHz file through a 48 kHz device, long enough not to hit the end.
    let mut player = player_with(88_200, 44_100);
    let mut out = vec![0.0f32; 480 * 2];
    for _ in 0..100 {
      render(&mut player, &mut out, 2, 48_000.0);
    }

    // 100 buffers of 480 frames = 1 s at 48 kHz = 44 100 source frames.
    assert!((player.position - 44_100.0).abs() < 1e-3);
    // Each buffer reports from where the last stopped, so rounding at the
    // boundaries never drops or repeats a frame for the analyser.
    assert!((player.pending.len() as f64 - player.position).abs() < 1.0);
    // Both output channels carry the mono track.
    assert_eq!(out[200], out[201]);
  }

  #[test]
  fn playback_stops_at_the_end_and_play_restarts() {
    let mut player = player_with(100, 48_000);
    let mut out = vec![1.0f32; 256];
    render(&mut player, &mut out, 1, 48_000.0);
    assert!(!player.playing);
    assert_eq!(out[255], 0.0);

    player.play();
    assert!(player.playing);
    assert_eq!(player.position, 0.0);
  }

  #[test]
  fn seek_clamps_and_marks_the_analyser_for_refill() {
    let mut player = player_with(48_000, 48_000);
    player.seek(5.0);
    assert_eq!(player.position, 48_000.0);
    assert!(player.moved);
    player.seek(-1.0);
    assert_eq!(player.position, 0.0);
  }
}

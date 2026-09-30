//! Native microphone capture and analysis.
//!
//! One dedicated thread owns the cpal stream (it is not `Send` on every
//! platform) and runs the analysis at a fixed rate. Each tick publishes a frame
//! to the hub, which fans it out to the editor and to OBS alike — OBS never
//! touches the microphone itself, so it needs no launch flags or permissions.

mod analyser;
mod synthetic;

use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use axum::body::Bytes;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, FromSample, SampleFormat, SizedSample};
use serde::Serialize;
use tokio::sync::oneshot;

use crate::hub::{AudioStatus, Hub};
use analyser::Analyser;
use synthetic::Synthetic;

/// Analysis rate. The page smooths per frame on top of this, so it animates at
/// the display's refresh rate regardless.
const TICK: Duration = Duration::from_micros(16_667);

/// Cap on samples buffered between ticks, so a stalled tick cannot grow the
/// queue without bound. A quarter second is far more than one tick needs.
const MAX_PENDING_SECONDS: f32 = 0.25;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
  pub device_id: String,
  pub label: String,
}

pub struct StartRequest {
  pub device_id: Option<String>,
  pub synthetic: bool,
  pub fft_size: usize,
  pub smoothing: f32,
}

enum Command {
  Start(StartRequest, oneshot::Sender<AudioStatus>),
  Configure { fft_size: usize, smoothing: f32 },
  Stop,
}

#[derive(Clone)]
pub struct AudioHandle {
  tx: mpsc::Sender<Command>,
}

impl AudioHandle {
  pub fn spawn(hub: Arc<Hub>) -> Self {
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
      .name("yapora-audio".into())
      .spawn(move || Worker::new(hub).run(rx))
      .expect("failed to spawn audio thread");
    Self { tx }
  }

  /// Starts (or restarts) capture and resolves once the stream is open or has
  /// failed, with the resulting status.
  pub async fn start(&self, request: StartRequest) -> AudioStatus {
    let (reply, done) = oneshot::channel();
    if self.tx.send(Command::Start(request, reply)).is_err() {
      return error_status("The audio thread has stopped.".into());
    }
    done
      .await
      .unwrap_or_else(|_| error_status("The audio thread has stopped.".into()))
  }

  pub fn configure(&self, fft_size: usize, smoothing: f32) {
    let _ = self.tx.send(Command::Configure {
      fft_size,
      smoothing,
    });
  }

  pub fn stop(&self) {
    let _ = self.tx.send(Command::Stop);
  }
}

pub fn list_devices() -> Vec<DeviceInfo> {
  let host = cpal::default_host();
  let Ok(devices) = host.input_devices() else {
    return Vec::new();
  };
  devices
    .filter_map(|device| {
      Some(DeviceInfo {
        device_id: device.id().ok()?.to_string(),
        label: device.to_string(),
      })
    })
    .collect()
}

/// Samples handed from the realtime callback to the worker, plus any error the
/// stream reported since the last tick.
#[derive(Default)]
struct Shared {
  pending: Vec<f32>,
  error: Option<cpal::Error>,
}

enum Source {
  None,
  Mic {
    // Held only to keep the stream alive; dropping it stops capture.
    _stream: cpal::Stream,
    shared: Arc<Mutex<Shared>>,
    sample_rate: f32,
  },
  Synthetic {
    generator: Synthetic,
    last: Instant,
  },
}

struct Worker {
  hub: Arc<Hub>,
  analyser: Analyser,
  source: Source,
  samples: Vec<f32>,
  spectrum: Vec<f32>,
}

impl Worker {
  fn new(hub: Arc<Hub>) -> Self {
    Self {
      hub,
      analyser: Analyser::new(2048, 0.6),
      source: Source::None,
      samples: Vec::new(),
      spectrum: Vec::new(),
    }
  }

  fn run(mut self, rx: mpsc::Receiver<Command>) {
    let mut next = Instant::now() + TICK;
    loop {
      match rx.recv_timeout(next.saturating_duration_since(Instant::now())) {
        Ok(command) => self.handle(command),
        Err(RecvTimeoutError::Timeout) => {}
        Err(RecvTimeoutError::Disconnected) => return,
      }

      let now = Instant::now();
      if now >= next {
        self.tick();
        next += TICK;
        // After a long stall, resynchronise instead of bursting to catch up.
        if next < now {
          next = now + TICK;
        }
      }
    }
  }

  fn handle(&mut self, command: Command) {
    match command {
      Command::Start(request, reply) => {
        let status = self.start(request);
        self.hub.set_status(status.clone());
        let _ = reply.send(status);
      }
      Command::Configure {
        fft_size,
        smoothing,
      } => self.analyser.configure(fft_size, smoothing),
      Command::Stop => {
        self.source = Source::None;
        self.analyser.reset();
        self.hub.set_status(AudioStatus::idle());
      }
    }
  }

  fn start(&mut self, request: StartRequest) -> AudioStatus {
    // Release the old device before opening the new one; some drivers refuse
    // a second exclusive handle to the same hardware.
    self.source = Source::None;
    self.analyser.reset();
    self.analyser.configure(request.fft_size, request.smoothing);

    if request.synthetic {
      self.source = Source::Synthetic {
        generator: Synthetic::new(48_000.0),
        last: Instant::now(),
      };
      return running(false);
    }

    let host = cpal::default_host();
    let mut device_missing = false;
    let saved = request
      .device_id
      .as_deref()
      .and_then(|id| id.parse().ok())
      .and_then(|id| host.device_by_id(&id));
    if request.device_id.is_some() && saved.is_none() {
      // A device saved on another machine, or unplugged since. Falling back
      // keeps the avatar alive instead of sitting silent until someone
      // notices and repicks.
      device_missing = true;
    }

    let Some(device) = saved.or_else(|| host.default_input_device()) else {
      return error_status("No microphone found. Plug one in, or check that Windows can see it.".into());
    };

    match open_stream(&device) {
      Ok(source) => {
        self.source = source;
        running(device_missing)
      }
      Err(err) => AudioStatus {
        device_missing,
        ..describe_error(&err)
      },
    }
  }

  fn tick(&mut self) {
    self.samples.clear();
    let sample_rate = match &mut self.source {
      Source::None => return,
      Source::Mic {
        shared,
        sample_rate,
        ..
      } => {
        let mut shared = shared.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(err) = shared.error.take() {
          drop(shared);
          self.source = Source::None;
          self.hub.set_status(describe_error(&err));
          return;
        }
        std::mem::swap(&mut self.samples, &mut shared.pending);
        *sample_rate
      }
      Source::Synthetic { generator, last } => {
        let now = Instant::now();
        let elapsed = now.duration_since(*last).as_secs_f32().min(0.1);
        *last = now;
        let count = (elapsed * generator.sample_rate()) as usize;
        generator.fill(&mut self.samples, count);
        generator.sample_rate()
      }
    };

    self.analyser.push(&self.samples);
    self.analyser.spectrum_db(&mut self.spectrum);
    let frame = encode_frame(self.analyser.rms_db(), sample_rate, &self.spectrum);
    self.hub.frames.send_replace(frame);
  }
}

/// Frame layout, little-endian f32s: `[rmsDb, sampleRate, ...spectrumDb]`.
/// Both values are pre-gain; the page applies gain as a dB offset, which is
/// exact because gain scales every magnitude linearly.
fn encode_frame(rms_db: f32, sample_rate: f32, spectrum: &[f32]) -> Bytes {
  let mut bytes = Vec::with_capacity((spectrum.len() + 2) * 4);
  bytes.extend_from_slice(&rms_db.to_le_bytes());
  bytes.extend_from_slice(&sample_rate.to_le_bytes());
  for value in spectrum {
    bytes.extend_from_slice(&value.to_le_bytes());
  }
  Bytes::from(bytes)
}

fn open_stream(device: &cpal::Device) -> Result<Source, cpal::Error> {
  let config = device.default_input_config()?;
  let sample_rate = config.sample_rate() as f32;
  let shared = Arc::new(Mutex::new(Shared::default()));

  let stream = match config.sample_format() {
    SampleFormat::F32 => build::<f32>(device, &config, &shared)?,
    SampleFormat::F64 => build::<f64>(device, &config, &shared)?,
    SampleFormat::I8 => build::<i8>(device, &config, &shared)?,
    SampleFormat::I16 => build::<i16>(device, &config, &shared)?,
    SampleFormat::I32 => build::<i32>(device, &config, &shared)?,
    SampleFormat::U8 => build::<u8>(device, &config, &shared)?,
    SampleFormat::U16 => build::<u16>(device, &config, &shared)?,
    SampleFormat::U32 => build::<u32>(device, &config, &shared)?,
    _ => return Err(ErrorKind::UnsupportedConfig.into()),
  };
  stream.play()?;

  Ok(Source::Mic {
    _stream: stream,
    shared,
    sample_rate,
  })
}

fn build<T>(
  device: &cpal::Device,
  config: &cpal::SupportedStreamConfig,
  shared: &Arc<Mutex<Shared>>,
) -> Result<cpal::Stream, cpal::Error>
where
  T: SizedSample,
  f32: FromSample<T>,
{
  let channels = config.channels().max(1) as usize;
  let max_pending = (config.sample_rate() as f32 * MAX_PENDING_SECONDS) as usize;
  let data_shared = Arc::clone(shared);
  let error_shared = Arc::clone(shared);

  device.build_input_stream(
    config.config(),
    move |data: &[T], _: &_| {
      let mut shared = data_shared.lock().unwrap_or_else(|e| e.into_inner());
      // Downmix to mono. The analysis only cares about overall energy per
      // frequency, and averaging keeps a stereo mic at the same level.
      for frame in data.chunks(channels) {
        let sum: f32 = frame.iter().map(|&s| f32::from_sample_(s)).sum();
        shared.pending.push(sum / channels as f32);
      }
      let excess = shared.pending.len().saturating_sub(max_pending);
      if excess > 0 {
        shared.pending.drain(..excess);
      }
    },
    move |err: cpal::Error| {
      match err.kind() {
        // Recoverable glitches: the stream keeps running.
        ErrorKind::Xrun | ErrorKind::RealtimeDenied | ErrorKind::DeviceChanged => {
          log::debug!("audio stream: {err}");
        }
        _ => {
          let mut shared = error_shared.lock().unwrap_or_else(|e| e.into_inner());
          shared.error = Some(err);
        }
      }
    },
    None,
  )
}

fn running(device_missing: bool) -> AudioStatus {
  AudioStatus {
    status: "running",
    error: None,
    device_missing,
  }
}

fn error_status(error: String) -> AudioStatus {
  AudioStatus {
    status: "error",
    error: Some(error),
    device_missing: false,
  }
}

/// Names the actual fix rather than collapsing everything into "unavailable".
fn describe_error(err: &cpal::Error) -> AudioStatus {
  let message = match err.kind() {
    ErrorKind::PermissionDenied => {
      return AudioStatus {
        status: "denied",
        error: Some(
          "Microphone access is blocked. Allow desktop apps in Settings › Privacy & security › Microphone."
            .into(),
        ),
        device_missing: false,
      };
    }
    ErrorKind::DeviceBusy => {
      "The microphone is in use. Another application may have exclusive access to it.".into()
    }
    ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated => {
      "The microphone was disconnected. Plug it back in, or pick another in Audio settings.".into()
    }
    _ => format!("Could not open the microphone: {err}"),
  };
  error_status(message)
}

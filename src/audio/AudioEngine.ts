import type { AudioConfig } from "@/store/schema"

import { buildBandPlan, mirrorBands, reduceBands, type BandPlan } from "./bands"
import {
  amplitudeToDb,
  clamp01,
  Envelope,
  EnvelopeBank,
  NoiseGate,
} from "./envelope"
import { createSyntheticSource, type SyntheticSource } from "./synthetic"

export type EngineStatus =
  "idle" | "requesting" | "running" | "suspended" | "denied" | "error"

export interface EngineListener {
  (status: EngineStatus, error: string | null): void
}

/**
 * The analyser maps a dB window onto its 0..255 byte spectrum. These offsets
 * place that window relative to the gate and ceiling the user tunes against
 * the volume meter, which are RMS levels — individual bins sit below those, so
 * the window is shifted down at the bottom.
 *
 * The top of the window sits at the ceiling rather than below it. Dropping it
 * lower leaves loud bands pinned at 255 with nowhere left to go, and the mouth
 * saturates into a flat wall on anything above conversational volume.
 */
const SPECTRUM_FLOOR_OFFSET = -20
const SPECTRUM_CEIL_OFFSET = 0

/**
 * Turns a getUserMedia rejection into something that names the actual fix.
 *
 * Inside OBS these all look identical from the outside — a still avatar — but
 * they need completely different remedies, so the raw error name is worth
 * surfacing rather than collapsing into "microphone unavailable".
 */
function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ""

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Permission refused. In OBS, relaunch with --use-fake-ui-for-media-stream, and check Windows microphone privacy settings allow desktop apps."
    case "NotFoundError":
      return "No microphone found. OBS may not have been granted OS-level microphone access."
    case "NotReadableError":
      return "The microphone is in use or unreadable. Another application may have exclusive access to it."
    case "OverconstrainedError":
      return "The selected microphone does not exist here. Pick one again in Audio settings."
    case "SecurityError":
      return "Blocked by the page's origin. Serve over localhost or https, not a file:// path."
    default:
      return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Owns all Web Audio state and exposes the current levels as plain buffers.
 *
 * Deliberately framework-free and outside React: the render loop reads
 * `level`/`bands` directly every frame. Nothing here triggers a re-render.
 */
class AudioEngine {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private synthetic: SyntheticSource | null = null
  private gainNode: GainNode | null = null
  private analyser: AnalyserNode | null = null

  private spectrum = new Uint8Array(0)
  private waveform = new Float32Array(0)

  private rawBands = new Float32Array(0)
  private shapedBands = new Float32Array(0)
  /** Public, read-only per-frame output. */
  bands = new Float32Array(0)
  /** Smoothed overall level in 0..1. */
  level = 0
  /** Unsmoothed level in dBFS, for the tuning meter. */
  levelDb = -100
  /** Whether the noise gate is currently open. */
  gateOpen = false

  private plan: BandPlan | null = null
  private envelope = new Envelope(18, 180)
  private bank = new EnvelopeBank(0, 10, 120)
  private gate = new NoiseGate(-55)

  private config: AudioConfig | null = null
  private windowDb = 65
  private useSynthetic = false
  /** Set when the saved device was absent and the default was used instead. */
  deviceMissing = false
  private planKey = ""

  status: EngineStatus = "idle"
  error: string | null = null
  private listeners = new Set<EngineListener>()

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    listener(this.status, this.error)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(status: EngineStatus, error: string | null = null) {
    this.status = status
    this.error = error
    for (const listener of this.listeners) listener(status, error)
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000
  }

  get contextState() {
    return this.ctx?.state ?? null
  }

  async start(config: AudioConfig, synthetic: boolean) {
    this.config = config
    this.useSynthetic = synthetic
    this.deviceMissing = false
    this.emit("requesting")

    try {
      const ctx = this.ensureContext()

      this.teardownSource()

      if (synthetic) {
        this.synthetic = createSyntheticSource(ctx)
        this.synthetic.node.connect(this.gainNode!)
      } else {
        const stream = await this.openMicrophone(config)
        this.stream = stream
        this.source = ctx.createMediaStreamSource(stream)
        this.source.connect(this.gainNode!)
      }

      this.applyConfig(config)
      await this.resume()
      this.emit(ctx.state === "running" ? "running" : "suspended")
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ""
      const denied =
        name === "NotAllowedError" || name === "PermissionDeniedError"
      this.emit(denied ? "denied" : "error", describeMicError(err))
    }
  }

  /**
   * Opens the microphone, falling back to the system default if the saved
   * device is not present.
   *
   * Device IDs are salted per browser profile, so a microphone picked in a
   * desktop browser cannot exist inside OBS's CEF — the exact constraint
   * throws OverconstrainedError there and the avatar sits silent. Falling back
   * means an imported profile still works on the first try.
   */
  private async openMicrophone(config: AudioConfig): Promise<MediaStream> {
    // echoCancellation, noiseSuppression and autoGainControl are on by default
    // and all three flatten the dynamics we are trying to visualise — AGC in
    // particular pumps a whisper up to the level of a shout.
    const base: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }

    if (config.deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { ...base, deviceId: { exact: config.deviceId } },
        })
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ""
        // A permission refusal must not be retried — retrying would only
        // produce a second prompt and the same answer.
        if (name !== "OverconstrainedError" && name !== "NotFoundError")
          throw err
        this.deviceMissing = true
      }
    }

    return navigator.mediaDevices.getUserMedia({ audio: base })
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx

    const ctx = new AudioContext()
    this.ctx = ctx

    const gain = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    // Nothing connects to ctx.destination: we analyse the mic, never play it
    // back. Routing it to the speakers would feed back through the mic.
    gain.connect(analyser)

    this.gainNode = gain
    this.analyser = analyser
    this.allocate()

    return ctx
  }

  private allocate() {
    const analyser = this.analyser
    if (!analyser) return
    this.spectrum = new Uint8Array(analyser.frequencyBinCount)
    this.waveform = new Float32Array(analyser.fftSize)
  }

  /**
   * Applied on every settings change. Cheap enough to call freely; the band
   * plan is only rebuilt when an input that affects it actually changed.
   */
  applyConfig(config: AudioConfig) {
    this.config = config
    const analyser = this.analyser
    if (!analyser || !this.gainNode) return

    if (analyser.fftSize !== config.fftSize) {
      analyser.fftSize = config.fftSize
      this.allocate()
    }

    analyser.smoothingTimeConstant = config.smoothing
    analyser.minDecibels = config.gateThreshold + SPECTRUM_FLOOR_OFFSET
    analyser.maxDecibels = Math.max(
      analyser.minDecibels + 10,
      config.ceiling + SPECTRUM_CEIL_OFFSET
    )
    this.windowDb = analyser.maxDecibels - analyser.minDecibels

    this.gainNode.gain.value = Math.pow(10, config.gain / 20)

    this.envelope.setTimes(config.attackMs, config.releaseMs)
    this.bank.setTimes(config.barAttackMs, config.barReleaseMs)
    this.gate.setThreshold(config.gateThreshold)
  }

  /** Called by the renderer when the bar count changes. */
  setBarCount(barCount: number) {
    if (this.bands.length === barCount) return
    this.rawBands = new Float32Array(barCount)
    this.shapedBands = new Float32Array(barCount)
    this.bands = new Float32Array(barCount)
    this.bank.resize(barCount)
    this.plan = null
  }

  private ensurePlan(barCount: number) {
    const config = this.config
    if (!config) return

    const key = [
      barCount,
      config.fftSize,
      config.freqMin,
      config.freqMax,
      config.tilt,
      this.windowDb,
      this.sampleRate,
    ].join(":")

    if (this.plan && this.planKey === key) return

    this.plan = buildBandPlan({
      barCount,
      fftSize: config.fftSize,
      sampleRate: this.sampleRate,
      freqMin: config.freqMin,
      freqMax: config.freqMax,
      tilt: config.tilt,
      windowDb: this.windowDb,
    })
    this.planKey = key
  }

  /**
   * Advances the analysis by `dt` seconds. Called once per animation frame by
   * the renderer; never allocates.
   */
  update(dt: number, barCount: number, mirror: boolean) {
    const analyser = this.analyser
    const config = this.config

    this.setBarCount(barCount)

    if (!analyser || !config || this.status !== "running") {
      // Ease back to rest rather than snapping, so losing the mic mid-stream
      // looks like the avatar going quiet instead of glitching.
      this.level = this.envelope.process(0, dt)
      this.gateOpen = false
      this.shapedBands.fill(0)
      this.bands.set(this.bank.process(this.shapedBands, dt))
      return
    }

    this.ensurePlan(barCount)

    analyser.getFloatTimeDomainData(this.waveform)

    let sumSquares = 0
    for (let i = 0; i < this.waveform.length; i++) {
      const sample = this.waveform[i]
      sumSquares += sample * sample
    }
    const rms = Math.sqrt(sumSquares / this.waveform.length)
    const db = amplitudeToDb(rms)
    this.levelDb = db

    this.gateOpen = this.gate.process(db)

    // Map the dB window between the gate and the ceiling onto 0..1.
    const span = Math.max(1, config.ceiling - config.gateThreshold)
    const normalized = this.gateOpen
      ? clamp01((db - config.gateThreshold) / span)
      : 0

    this.level = this.envelope.process(normalized, dt)

    analyser.getByteFrequencyData(this.spectrum)

    if (this.plan) {
      reduceBands(this.spectrum, this.plan, this.rawBands)
    } else {
      this.rawBands.fill(0)
    }

    // The gate governs the bars too. Individual bins are rarely silent even in
    // a quiet room, so without this the mouth would shimmer on room tone while
    // the halo — correctly — sat still.
    if (!this.gateOpen) this.rawBands.fill(0)

    if (mirror) {
      mirrorBands(this.rawBands, this.shapedBands)
    } else {
      this.shapedBands.set(this.rawBands)
    }

    this.bands.set(this.bank.process(this.shapedBands, dt))
  }

  async resume() {
    if (!this.ctx) return
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume()
      } catch {
        // Still blocked by the autoplay policy; a later gesture will retry.
      }
    }
    if (this.ctx.state === "running" && this.status === "suspended") {
      this.emit("running")
    }
  }

  private teardownSource() {
    this.source?.disconnect()
    this.source = null
    this.synthetic?.stop()
    this.synthetic = null
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
  }

  stop() {
    this.teardownSource()
    this.envelope.reset()
    this.bank.reset()
    this.gate.reset()
    this.level = 0
    this.levelDb = -100
    this.gateOpen = false
    this.bands.fill(0)
    this.emit("idle")
  }

  get isSynthetic() {
    return this.useSynthetic
  }
}

export const audioEngine = new AudioEngine()

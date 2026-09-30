import { invoke, inApp } from "@/lib/native"
import type { AudioConfig } from "@/store/schema"

import { buildBandPlan, mirrorBands, reduceBands, type BandPlan } from "./bands"
import { clamp01, Envelope, EnvelopeBank, NoiseGate } from "./envelope"
import { analysisLink, type LinkStatus } from "./link"

export type EngineStatus =
  | "idle"
  | "requesting"
  | "running"
  | "suspended"
  | "denied"
  | "error"
  | "offline"

export interface EngineListener {
  (status: EngineStatus, error: string | null): void
}

/**
 * The spectrum's dB window is mapped onto 0..255, as the Web Audio
 * AnalyserNode did. These offsets place that window relative to the gate and
 * ceiling the user tunes against the volume meter, which are RMS levels —
 * individual bins sit below those, so the window is shifted down at the bottom.
 *
 * The top of the window sits at the ceiling rather than below it. Dropping it
 * lower leaves loud bands pinned at 255 with nowhere left to go, and the mouth
 * saturates into a flat wall on anything above conversational volume.
 */
const SPECTRUM_FLOOR_OFFSET = -20
const SPECTRUM_CEIL_OFFSET = 0

/** Frames older than this mean the source has stopped, not merely hiccuped. */
const STALE_MS = 250

const OFFLINE_MESSAGE =
  "Can't reach the Yapora app. Start it, and this source will pick it up on its own."

/**
 * Turns the app's analysis stream into the levels the renderer draws.
 *
 * Capture and FFT happen natively in the app; frames arrive over the analysis
 * link as a pre-gain dB spectrum. Everything the user tunes — gain, gate,
 * ceiling, envelopes, band plan — is applied here, identically in the editor
 * and in OBS.
 *
 * Deliberately framework-free and outside React: the render loop reads
 * `level`/`bands` directly every frame. Nothing here triggers a re-render.
 */
class AudioEngine {
  private spectrum = new Uint8Array(0)

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
  private minDb = -75
  private maxDb = -12
  private useSynthetic = false
  /** Set when the saved device was absent and the default was used instead. */
  deviceMissing = false
  private planKey = ""

  status: EngineStatus = "idle"
  error: string | null = null
  private listeners = new Set<EngineListener>()
  private unlink: (() => void) | null = null

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

  private handleLink = (link: LinkStatus | null) => {
    if (!link) {
      this.emit("offline", OFFLINE_MESSAGE)
      return
    }
    this.deviceMissing = link.deviceMissing
    this.emit(link.status, link.error)
  }

  /**
   * In the app this opens the microphone; in OBS it only subscribes, since the
   * app owns the device. Either way, status arrives over the link.
   */
  async start(config: AudioConfig, synthetic: boolean) {
    this.config = config
    this.useSynthetic = synthetic
    this.applyConfig(config)

    if (!this.unlink) {
      this.unlink = analysisLink.onStatus(this.handleLink)
      analysisLink.connect()
    }

    if (!inApp) return

    this.emit("requesting")
    try {
      const status = await invoke<LinkStatus>("audio_start", {
        deviceId: config.deviceId,
        synthetic,
        fftSize: config.fftSize,
        smoothing: config.smoothing,
      })
      this.handleLink(status)
    } catch (err) {
      this.emit("error", err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Applied on every settings change. Cheap enough to call freely; the band
   * plan is only rebuilt when an input that affects it actually changed.
   */
  applyConfig(config: AudioConfig) {
    const previous = this.config
    this.config = config

    this.minDb = config.gateThreshold + SPECTRUM_FLOOR_OFFSET
    this.maxDb = Math.max(
      this.minDb + 10,
      config.ceiling + SPECTRUM_CEIL_OFFSET
    )

    this.envelope.setTimes(config.attackMs, config.releaseMs)
    this.bank.setTimes(config.barAttackMs, config.barReleaseMs)
    this.gate.setThreshold(config.gateThreshold)

    // FFT size and smoothing shape the analysis itself, which happens in the
    // app. OBS just receives whatever the app computes.
    if (
      inApp &&
      previous &&
      (previous.fftSize !== config.fftSize ||
        previous.smoothing !== config.smoothing)
    ) {
      void invoke("audio_configure", {
        fftSize: config.fftSize,
        smoothing: config.smoothing,
      })
    }
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

  private ensurePlan(barCount: number, fftSize: number, sampleRate: number) {
    const config = this.config
    if (!config) return

    const windowDb = this.maxDb - this.minDb
    const key = [
      barCount,
      fftSize,
      config.freqMin,
      config.freqMax,
      config.tilt,
      windowDb,
      sampleRate,
    ].join(":")

    if (this.plan && this.planKey === key) return

    this.plan = buildBandPlan({
      barCount,
      fftSize,
      sampleRate,
      freqMin: config.freqMin,
      freqMax: config.freqMax,
      tilt: config.tilt,
      windowDb,
    })
    this.planKey = key
  }

  /**
   * Advances the analysis by `dt` seconds. Called once per animation frame by
   * the renderer; never allocates except when the FFT size changes.
   */
  update(dt: number, barCount: number, mirror: boolean) {
    const config = this.config
    const frame = analysisLink.frame

    this.setBarCount(barCount)

    const fresh =
      frame !== null && performance.now() - analysisLink.frameAt < STALE_MS

    if (!config || !fresh || frame.length < 3 || this.status !== "running") {
      // Ease back to rest rather than snapping, so losing the mic mid-stream
      // looks like the avatar going quiet instead of glitching.
      this.level = this.envelope.process(0, dt)
      this.levelDb = -100
      this.gateOpen = false
      this.shapedBands.fill(0)
      this.bands.set(this.bank.process(this.shapedBands, dt))
      return
    }

    const db = frame[0] + config.gain
    const sampleRate = frame[1]
    const binCount = frame.length - 2
    this.levelDb = db

    this.gateOpen = this.gate.process(db)

    // Map the dB window between the gate and the ceiling onto 0..1.
    const span = Math.max(1, config.ceiling - config.gateThreshold)
    const normalized = this.gateOpen
      ? clamp01((db - config.gateThreshold) / span)
      : 0

    this.level = this.envelope.process(normalized, dt)

    this.ensurePlan(barCount, binCount * 2, sampleRate)
    this.toBytes(frame, config.gain)

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

  /**
   * dB spectrum to the 0..255 bytes the band plan works in — the exact
   * conversion `AnalyserNode.getByteFrequencyData` performs.
   */
  private toBytes(frame: Float32Array, gainDb: number) {
    const binCount = frame.length - 2
    if (this.spectrum.length !== binCount) {
      this.spectrum = new Uint8Array(binCount)
    }
    const scale = 255 / (this.maxDb - this.minDb)
    const offset = gainDb - this.minDb
    for (let i = 0; i < binCount; i++) {
      const value = Math.floor(scale * (frame[i + 2] + offset))
      this.spectrum[i] = value < 0 ? 0 : value > 255 ? 255 : value
    }
  }

  stop() {
    this.unlink?.()
    this.unlink = null
    analysisLink.disconnect()
    if (inApp) void invoke("audio_stop")
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

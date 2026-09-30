import type { AudioConfig } from "@/store/schema"

import { buildBandPlan, mirrorBands, reduceBands, type BandPlan } from "./bands"
import { clamp01, Envelope, EnvelopeBank, NoiseGate } from "./envelope"

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

/**
 * Turns analysis frames into the levels the renderer draws: everything the
 * user tunes — gain, gate, ceiling, envelopes, band plan.
 *
 * The live engine runs one of these on the app's stream; video export runs its
 * own on the file, so an export reacts exactly as the preview did.
 *
 * A frame is `[rmsDb, sampleRate, ...spectrumDb]`, all pre-gain.
 */
export class Reaction {
  private spectrum = new Uint8Array(0)

  private rawBands = new Float32Array(0)
  private shapedBands = new Float32Array(0)
  /** Smoothed per-bar output, 0..1. */
  bands = new Float32Array(0)
  /** Smoothed overall level in 0..1. */
  level = 0
  /** Unsmoothed level in dBFS, for the tuning meter. */
  levelDb = -100
  /** Whether the noise gate is currently open. */
  gateOpen = false

  private plan: BandPlan | null = null
  private planKey = ""
  private envelope = new Envelope(18, 180)
  private bank = new EnvelopeBank(0, 10, 120)
  private gate = new NoiseGate(-55)

  private config: AudioConfig | null = null
  private minDb = -75
  private maxDb = -12

  /**
   * Applied on every settings change. Cheap enough to call freely; the band
   * plan is only rebuilt when an input that affects it actually changed.
   */
  configure(config: AudioConfig) {
    this.config = config
    this.minDb = config.gateThreshold + SPECTRUM_FLOOR_OFFSET
    this.maxDb = Math.max(
      this.minDb + 10,
      config.ceiling + SPECTRUM_CEIL_OFFSET
    )
    this.envelope.setTimes(config.attackMs, config.releaseMs)
    this.bank.setTimes(config.barAttackMs, config.barReleaseMs)
    this.gate.setThreshold(config.gateThreshold)
  }

  private setBarCount(barCount: number) {
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
   * Advances by `dt` seconds. `null` means no signal: everything eases back to
   * rest rather than snapping, so losing the mic mid-stream looks like the
   * avatar going quiet instead of glitching. Never allocates except when the
   * bar count or FFT size changes.
   */
  process(
    frame: Float32Array | null,
    dt: number,
    barCount: number,
    mirror: boolean
  ) {
    const config = this.config
    this.setBarCount(barCount)

    if (!config || !frame || frame.length < 3) {
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

  reset() {
    this.envelope.reset()
    this.bank.reset()
    this.gate.reset()
    this.level = 0
    this.levelDb = -100
    this.gateOpen = false
    this.bands.fill(0)
  }
}

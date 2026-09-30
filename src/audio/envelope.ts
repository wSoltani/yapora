/**
 * One-pole envelope follower with independent attack and release times.
 *
 * A fast attack with a slow release is what makes an audio-reactive visual read
 * as alive rather than twitchy: it snaps up on a syllable and eases back down
 * between them. The analyser's own `smoothingTimeConstant` cannot do this —
 * it is symmetric, so making the decay pleasant also makes the onset mushy.
 */
export class Envelope {
  private value = 0
  private attackMs: number
  private releaseMs: number

  constructor(attackMs: number, releaseMs: number) {
    this.attackMs = attackMs
    this.releaseMs = releaseMs
  }

  setTimes(attackMs: number, releaseMs: number) {
    this.attackMs = attackMs
    this.releaseMs = releaseMs
  }

  /** `dt` in seconds. Returns the smoothed value. */
  process(target: number, dt: number): number {
    const tauMs = target > this.value ? this.attackMs : this.releaseMs
    // A zero time constant means "follow instantly" rather than divide by zero.
    const coeff = tauMs <= 0 ? 1 : 1 - Math.exp(-(dt * 1000) / tauMs)
    this.value += (target - this.value) * Math.min(1, coeff)
    return this.value
  }

  reset(value = 0) {
    this.value = value
  }

  get current() {
    return this.value
  }
}

/**
 * A bank of envelopes sharing one pair of time constants, for the spectrum
 * bars. Kept as a flat array rather than N Envelope objects to avoid
 * per-frame allocation and pointer chasing.
 */
export class EnvelopeBank {
  private values: Float32Array
  private attackMs: number
  private releaseMs: number

  constructor(size: number, attackMs: number, releaseMs: number) {
    this.values = new Float32Array(size)
    this.attackMs = attackMs
    this.releaseMs = releaseMs
  }

  resize(size: number) {
    if (size === this.values.length) return
    this.values = new Float32Array(size)
  }

  setTimes(attackMs: number, releaseMs: number) {
    this.attackMs = attackMs
    this.releaseMs = releaseMs
  }

  /** Smooths `targets` in place into the internal buffer and returns it. */
  process(targets: Float32Array, dt: number): Float32Array {
    const attackCoeff =
      this.attackMs <= 0
        ? 1
        : Math.min(1, 1 - Math.exp(-(dt * 1000) / this.attackMs))
    const releaseCoeff =
      this.releaseMs <= 0
        ? 1
        : Math.min(1, 1 - Math.exp(-(dt * 1000) / this.releaseMs))

    for (let i = 0; i < this.values.length; i++) {
      const target = targets[i] ?? 0
      const current = this.values[i]
      const coeff = target > current ? attackCoeff : releaseCoeff
      this.values[i] = current + (target - current) * coeff
    }

    return this.values
  }

  reset() {
    this.values.fill(0)
  }
}

/**
 * Noise gate with hysteresis. Without the hysteresis a signal hovering at the
 * threshold chatters the gate open and shut and the mouth flutters on room
 * tone; opening at the threshold but only closing 6dB below it stops that.
 */
export class NoiseGate {
  private open = false
  private threshold: number
  private hysteresis: number

  constructor(threshold: number, hysteresis = 6) {
    this.threshold = threshold
    this.hysteresis = hysteresis
  }

  setThreshold(threshold: number) {
    this.threshold = threshold
  }

  /** `db` is the current level in dBFS. */
  process(db: number): boolean {
    if (this.open) {
      if (db < this.threshold - this.hysteresis) this.open = false
    } else if (db >= this.threshold) {
      this.open = true
    }
    return this.open
  }

  reset() {
    this.open = false
  }
}

/** Amplitude (0..1) to dBFS, floored so silence does not produce -Infinity. */
export function amplitudeToDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(amplitude, 1e-7))
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

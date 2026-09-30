export interface BandPlan {
  /** Inclusive start bin for each bar. */
  starts: Int32Array
  /** Exclusive end bin for each bar. */
  ends: Int32Array
  /**
   * Per-bar lift in byte units, compensating for the high-frequency rolloff of
   * speech. Added to the analyser's byte value, not multiplied by it.
   */
  lifts: Float32Array
  barCount: number
}

export interface BandPlanInput {
  barCount: number
  fftSize: number
  sampleRate: number
  freqMin: number
  freqMax: number
  tilt: number
  /** Width of the analyser's dB window, used to convert the lift into bytes. */
  windowDb: number
}

/** Most the tilt may lift the top bar, in dB. */
const MAX_LIFT_DB = 24

/**
 * Maps FFT bins onto bars logarithmically.
 *
 * This is the difference between a mouth that moves and one that does not.
 * A 2048-point FFT at 48kHz has ~23Hz bins, so a linear split across 85Hz-8kHz
 * would put every vowel and most consonant energy into the bottom two or three
 * bars and leave the rest permanently flat. Splitting by octave instead gives
 * each bar a comparable share of what speech actually contains.
 */
export function buildBandPlan({
  barCount,
  fftSize,
  sampleRate,
  freqMin,
  freqMax,
  tilt,
  windowDb,
}: BandPlanInput): BandPlan {
  const binCount = fftSize / 2
  const nyquist = sampleRate / 2
  const hzPerBin = nyquist / binCount

  const lo = Math.max(1, freqMin)
  const hi = Math.max(lo * 2, Math.min(freqMax, nyquist))
  const ratio = hi / lo

  const starts = new Int32Array(barCount)
  const ends = new Int32Array(barCount)
  const lifts = new Float32Array(barCount)
  // The analyser maps its dB window onto 0..255, so a dB lift converts to a
  // byte offset at this rate.
  const bytesPerDb = 255 / Math.max(1, windowDb)

  let cursor = Math.max(1, Math.floor(lo / hzPerBin))

  for (let i = 0; i < barCount; i++) {
    const fLo = lo * Math.pow(ratio, i / barCount)
    const fHi = lo * Math.pow(ratio, (i + 1) / barCount)

    // At the low end several consecutive bars resolve to the same bin. Walking
    // a cursor forward guarantees every bar owns at least one distinct bin
    // instead of a handful of bars all reading the same one.
    const start = Math.max(cursor, Math.floor(fLo / hzPerBin))
    const end = Math.min(
      binCount,
      Math.max(start + 1, Math.ceil(fHi / hzPerBin))
    )

    starts[i] = Math.min(start, binCount - 1)
    ends[i] = end
    cursor = end

    // Lift rises linearly across the bars, which is linear in log-frequency
    // because the bars themselves are spaced logarithmically.
    const position = barCount === 1 ? 0 : i / (barCount - 1)
    lifts[i] = tilt * MAX_LIFT_DB * position * bytesPerDb

    if (cursor >= binCount) {
      // Ran out of spectrum: park the remaining bars on the last bin so they
      // stay in sync with the others rather than reading garbage.
      for (let j = i + 1; j < barCount; j++) {
        starts[j] = binCount - 1
        ends[j] = binCount
        lifts[j] = lifts[i]
      }
      break
    }
  }

  return { starts, ends, lifts, barCount }
}

/**
 * Reduces the analyser's byte spectrum into per-bar values in 0..1.
 * Writes into `out` rather than allocating, since this runs every frame.
 */
export function reduceBands(
  spectrum: Uint8Array,
  plan: BandPlan,
  out: Float32Array
): Float32Array {
  for (let i = 0; i < plan.barCount; i++) {
    const start = plan.starts[i]
    const end = plan.ends[i]

    // Peak rather than mean: averaging across a wide high-frequency band
    // washes out the transients that make consonants visible.
    let peak = 0
    for (let bin = start; bin < end; bin++) {
      const value = spectrum[bin]
      if (value > peak) peak = value
    }

    // Additive in the byte (dB) domain. A multiplicative gain on an already
    // normalised value pins every moderately loud band at 1.0 and the mouth
    // becomes a flat wall of full-height bars.
    const lifted = (peak + plan.lifts[i]) / 255
    out[i] = lifted > 1 ? 1 : lifted < 0 ? 0 : lifted
  }

  return out
}

/**
 * Mirrors the left half of the spectrum onto the right so the mouth reads as a
 * symmetrical shape. With an odd bar count the middle bar is shared.
 */
export function mirrorBands(values: Float32Array, out: Float32Array): void {
  const n = out.length
  if (n === 0) return

  const half = Math.ceil(n / 2)
  const odd = n % 2 === 1

  // Low frequencies sit at the centre of the mouth and highs fan out to both
  // edges, so the shape stays symmetrical while still tracking the spectrum.
  for (let i = 0; i < half; i++) {
    out[half - 1 - i] = values[i] ?? 0
  }

  // With an odd bar count the centre bar is shared by both halves, so the right
  // side starts one band further up to avoid drawing it twice.
  const offset = odd ? 1 : 0
  for (let i = 0; i + half < n; i++) {
    out[half + i] = values[i + offset] ?? 0
  }
}

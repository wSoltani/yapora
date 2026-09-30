/**
 * A speech-shaped test signal.
 *
 * Granting mic permission on every reload — and having to actually talk to see
 * whether a tuning change helped — makes the visualiser miserable to develop
 * against. This produces a deterministic, speech-like signal instead: a
 * fundamental with harmonics, band-limited noise for consonants, and a syllable
 * rhythm that opens and closes the gate the way real speech does.
 */
export interface SyntheticSource {
  node: AudioNode
  stop: () => void
}

export function createSyntheticSource(ctx: AudioContext): SyntheticSource {
  const out = ctx.createGain()
  out.gain.value = 0

  // Voiced component: a ~120Hz fundamental plus harmonics, roughly a voice.
  const fundamental = ctx.createOscillator()
  fundamental.type = "sawtooth"
  fundamental.frequency.value = 120

  // A moving formant filter makes the spectrum shift the way vowels do, so the
  // upper bars actually get exercised.
  const formant = ctx.createBiquadFilter()
  formant.type = "bandpass"
  formant.frequency.value = 700
  formant.Q.value = 2

  const formantLfo = ctx.createOscillator()
  formantLfo.frequency.value = 0.7
  const formantDepth = ctx.createGain()
  formantDepth.gain.value = 600
  formantLfo.connect(formantDepth).connect(formant.frequency)

  // Unvoiced component: filtered noise standing in for consonants.
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const noiseData = noiseBuffer.getChannelData(0)
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = Math.random() * 2 - 1
  }
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer
  noise.loop = true

  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = "highpass"
  noiseFilter.frequency.value = 2000

  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.18

  // Syllable envelope: bursts with pauses, so the gate opens and closes.
  const syllable = ctx.createOscillator()
  syllable.type = "sine"
  syllable.frequency.value = 3.2
  const syllableDepth = ctx.createGain()
  syllableDepth.gain.value = 0.5
  const syllableOffset = ctx.createConstantSource()
  syllableOffset.offset.value = 0.5

  // Slower phrase envelope gates whole "sentences" in and out.
  const phrase = ctx.createOscillator()
  phrase.type = "sine"
  phrase.frequency.value = 0.18
  const phraseDepth = ctx.createGain()
  phraseDepth.gain.value = 0.55
  const phraseOffset = ctx.createConstantSource()
  phraseOffset.offset.value = 0.45

  const phraseGain = ctx.createGain()
  phraseGain.gain.value = 0

  fundamental.connect(formant)
  formant.connect(out)
  noise.connect(noiseFilter).connect(noiseGain).connect(out)

  syllableDepth.connect(out.gain)
  syllableOffset.connect(out.gain)
  syllable.connect(syllableDepth)

  out.connect(phraseGain)
  phraseDepth.connect(phraseGain.gain)
  phraseOffset.connect(phraseGain.gain)
  phrase.connect(phraseDepth)

  const started: Array<{ start: () => void; stop: () => void }> = [
    fundamental,
    formantLfo,
    noise,
    syllable,
    syllableOffset,
    phrase,
    phraseOffset,
  ]

  for (const node of started) node.start()

  return {
    node: phraseGain,
    stop: () => {
      for (const node of started) {
        try {
          node.stop()
        } catch {
          // Already stopped; nothing to do.
        }
      }
      phraseGain.disconnect()
    },
  }
}

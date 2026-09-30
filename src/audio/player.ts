import { open } from "@tauri-apps/plugin-dialog"

import { invoke } from "@/lib/native"

/** A loaded audio file, as the app describes it. */
export interface TrackInfo {
  name: string
  /** Seconds. */
  duration: number
  /** Peak level per bucket across the file, 0..1, for the waveform. */
  peaks: number[]
}

export interface Transport {
  /** Seconds. */
  position: number
  playing: boolean
}

const AUDIO_EXTENSIONS = [
  "wav",
  "mp3",
  "flac",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "aif",
  "aiff",
  "caf",
]

/**
 * Asks for an audio file and loads it into the app. Resolves to `null` if the
 * picker was cancelled; rejects with a readable message if the file could not
 * be decoded.
 */
export async function chooseAudioFile(): Promise<TrackInfo | null> {
  const path = await open({
    multiple: false,
    directory: false,
    title: "Choose an audio file",
    filters: [
      { name: "Audio", extensions: AUDIO_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  })
  if (typeof path !== "string") return null
  return invoke<TrackInfo>("file_load", { path })
}

/** The track already loaded in the app, e.g. after the page reloads. */
export function loadedTrack(): Promise<TrackInfo | null> {
  return invoke<TrackInfo | null>("file_info")
}

export const readTransport = () => invoke<Transport>("file_transport")
export const play = () => invoke<Transport>("file_play")
export const pause = () => invoke<Transport>("file_pause")
export const seek = (seconds: number) =>
  invoke<Transport>("file_seek", { seconds })

/**
 * Smooth playhead from sparse polls: the last reported position plus the time
 * since, while playing. Polling a few times a second keeps it honest without
 * an IPC round trip per animation frame.
 */
export class PlayheadClock {
  private base: Transport = { position: 0, playing: false }
  private at = performance.now()

  sync(transport: Transport) {
    this.base = transport
    this.at = performance.now()
  }

  get playing() {
    return this.base.playing
  }

  now(duration: number): number {
    if (!this.base.playing) return this.base.position
    const elapsed = (performance.now() - this.at) / 1000
    return Math.min(duration, this.base.position + elapsed)
  }
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

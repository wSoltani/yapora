import { invoke, inApp } from "@/lib/native"
import type { AudioSource } from "@/store/app"
import type { AudioConfig } from "@/store/schema"

import { analysisLink, type LinkStatus } from "./link"
import { Reaction } from "./reaction"

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

/** Frames older than this mean the source has stopped, not merely hiccuped. */
const STALE_MS = 250

const OFFLINE_MESSAGE =
  "Can't reach the Yapora app. Start it, and this source will pick it up on its own."

/**
 * The live audio session: starts the app's source, tracks its status, and
 * runs the app's analysis stream through a {@link Reaction}.
 *
 * Capture and FFT happen natively in the app; frames arrive over the analysis
 * link as a pre-gain dB spectrum. The reaction — everything the user tunes —
 * is applied here, identically in the editor and in OBS.
 *
 * Deliberately framework-free and outside React: the render loop reads
 * `level`/`bands` directly every frame. Nothing here triggers a re-render.
 */
class AudioEngine {
  private reaction = new Reaction()
  private config: AudioConfig | null = null

  /** Set when the saved device was absent and the default was used instead. */
  deviceMissing = false

  status: EngineStatus = "idle"
  error: string | null = null
  private listeners = new Set<EngineListener>()
  private unlink: (() => void) | null = null

  /** Smoothed per-bar output, 0..1. */
  get bands() {
    return this.reaction.bands
  }
  /** Smoothed overall level in 0..1. */
  get level() {
    return this.reaction.level
  }
  /** Unsmoothed level in dBFS, for the tuning meter. */
  get levelDb() {
    return this.reaction.levelDb
  }
  /** Whether the noise gate is currently open. */
  get gateOpen() {
    return this.reaction.gateOpen
  }

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
   * In the app this opens the source — microphone, test signal or file
   * playback; in OBS it only subscribes, since the app owns the audio. Either
   * way, status arrives over the link.
   */
  async start(
    config: AudioConfig,
    source: AudioSource,
    devices: { mic: string | null; output: string | null }
  ) {
    this.config = config
    this.applyConfig(config)

    if (!this.unlink) {
      this.unlink = analysisLink.onStatus(this.handleLink)
      analysisLink.connect()
    }

    if (!inApp) return

    this.emit("requesting")
    try {
      const status = await invoke<LinkStatus>("audio_start", {
        deviceId: devices.mic,
        outputDeviceId: devices.output,
        source,
        fftSize: config.fftSize,
        smoothing: config.smoothing,
      })
      this.handleLink(status)
    } catch (err) {
      this.emit("error", err instanceof Error ? err.message : String(err))
    }
  }

  /** Applied on every settings change. */
  applyConfig(config: AudioConfig) {
    const previous = this.config
    this.config = config
    this.reaction.configure(config)

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

  /** Advances by `dt` seconds. Called once per animation frame by the renderer. */
  update(dt: number, barCount: number, mirror: boolean) {
    const frame = analysisLink.frame
    const fresh =
      frame !== null && performance.now() - analysisLink.frameAt < STALE_MS
    const live = fresh && this.status === "running"
    this.reaction.process(live ? frame : null, dt, barCount, mirror)
  }

  stop() {
    this.unlink?.()
    this.unlink = null
    analysisLink.disconnect()
    if (inApp) void invoke("audio_stop")
    this.reaction.reset()
    this.emit("idle")
  }
}

export const audioEngine = new AudioEngine()

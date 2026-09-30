import { Channel } from "@tauri-apps/api/core"

import { inApp, invoke, streamUrl } from "@/lib/native"

export interface LinkStatus {
  status: "idle" | "running" | "denied" | "error"
  error: string | null
  deviceMissing: boolean
}

type Message =
  ({ type: "status" } & LinkStatus) | { type: "profile"; revision: number }

const RECONNECT_MS = 1000

/**
 * Where analysis frames and mic status come from. The editor window gets them
 * straight from the app over IPC, so it keeps working with OBS output off; OBS
 * gets them over the local server's WebSocket, along with profile revisions.
 *
 * Frames are not queued: only the newest one is kept, and the render loop
 * reads it whenever it draws. A page that stalls for a moment picks up the
 * current spectrum, not a backlog.
 */
class AnalysisLink {
  private socket: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | undefined
  private wanted = false
  /** Bumped per IPC subscription, so a stale one's late messages are ignored. */
  private generation = 0

  /** `[rmsDb, sampleRate, ...spectrumDb]`, all pre-gain. */
  frame: Float32Array | null = null
  frameAt = 0

  private statusListeners = new Set<(status: LinkStatus | null) => void>()
  private profileListeners = new Set<(revision: number) => void>()

  connect() {
    if (inApp) {
      this.subscribe()
      return
    }

    this.wanted = true
    if (this.socket) return
    clearTimeout(this.retry)

    const socket = new WebSocket(streamUrl())
    socket.binaryType = "arraybuffer"
    this.socket = socket

    socket.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.receiveFrame(event.data)
        return
      }
      const message = JSON.parse(event.data as string) as Message
      if (message.type === "status") {
        const { status, error, deviceMissing } = message
        this.receiveStatus({ status, error, deviceMissing })
      } else if (message.type === "profile") {
        for (const listener of this.profileListeners) listener(message.revision)
      }
    }

    socket.onclose = () => {
      this.socket = null
      this.frame = null
      // Also fires for a connection that never opened, so a page that starts
      // before the app learns why it is silent.
      for (const listener of this.statusListeners) listener(null)
      // OBS may well start before the app does, so keep knocking rather than
      // giving up after the first refusal.
      if (this.wanted)
        this.retry = setTimeout(() => this.connect(), RECONNECT_MS)
    }
  }

  /** The app replaces any previous subscription, so this is safe to repeat. */
  private subscribe() {
    const generation = ++this.generation
    const frames = new Channel<ArrayBuffer>((buffer) => {
      if (generation === this.generation) this.receiveFrame(buffer)
    })
    const status = new Channel<LinkStatus>((next) => {
      if (generation === this.generation) this.receiveStatus(next)
    })
    void invoke("audio_subscribe", { frames, status })
  }

  private receiveFrame(buffer: ArrayBuffer) {
    this.frame = new Float32Array(buffer)
    this.frameAt = performance.now()
  }

  private receiveStatus(status: LinkStatus) {
    for (const listener of this.statusListeners) listener(status)
  }

  disconnect() {
    this.generation++
    this.wanted = false
    clearTimeout(this.retry)
    const socket = this.socket
    this.socket = null
    this.frame = null
    if (socket) {
      // Detached first, so a quick reconnect (StrictMode remounts) is not
      // clobbered by this socket's close arriving later.
      socket.onclose = null
      socket.onmessage = null
      socket.close()
    }
  }

  /** `null` means the connection to the app was lost. */
  onStatus(listener: (status: LinkStatus | null) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  onProfile(listener: (revision: number) => void): () => void {
    this.profileListeners.add(listener)
    return () => {
      this.profileListeners.delete(listener)
    }
  }
}

export const analysisLink = new AnalysisLink()

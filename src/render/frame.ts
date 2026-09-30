/**
 * The per-frame contract between the audio engine and whatever draws.
 * Nothing here is React state — consumers receive this object and write to the
 * DOM directly.
 */
export interface FrameState {
  /** Smoothed overall level, 0..1. */
  level: number
  /** Smoothed per-bar spectrum, 0..1. Length tracks the configured bar count. */
  bands: Float32Array
  gateOpen: boolean
  /** Seconds since the previous frame. */
  dt: number
  /** Seconds since the loop started, for any time-based motion. */
  time: number
}

export type FrameConsumer = (frame: FrameState) => void

/**
 * A tiny subscription bus so each layer owns its own per-frame maths while the
 * app still runs exactly one `requestAnimationFrame` loop.
 */
class RenderBus {
  private consumers = new Set<FrameConsumer>()

  subscribe(consumer: FrameConsumer): () => void {
    this.consumers.add(consumer)
    return () => {
      this.consumers.delete(consumer)
    }
  }

  emit(frame: FrameState) {
    for (const consumer of this.consumers) consumer(frame)
  }

  get size() {
    return this.consumers.size
  }
}

export const renderBus = new RenderBus()

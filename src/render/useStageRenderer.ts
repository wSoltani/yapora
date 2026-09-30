import * as React from "react"

import { audioEngine } from "@/audio/AudioEngine"

import { renderBus, type FrameConsumer, type FrameState } from "./frame"

/**
 * Subscribes a layer to the frame loop.
 *
 * The callback is held in a ref and the subscription is created once, so a
 * layer can close over fresh props every render without resubscribing sixty
 * times a second.
 */
export function useFrame(consumer: FrameConsumer) {
  const ref = React.useRef(consumer)

  // Updated before paint, so the loop's next frame always sees the callback
  // from the render that just committed.
  React.useLayoutEffect(() => {
    ref.current = consumer
  })

  React.useEffect(() => {
    return renderBus.subscribe((frame) => ref.current(frame))
  }, [])
}

interface RendererOptions {
  barCount: number
  mirror: boolean
  fpsCap: number | null
}

/**
 * The application's single `requestAnimationFrame` loop.
 *
 * It advances the audio analysis and pushes one FrameState to every layer.
 * Nothing in this path touches React state, so a frame costs a handful of
 * attribute writes rather than a render pass.
 */
export function useStageRenderer({
  barCount,
  mirror,
  fpsCap,
}: RendererOptions) {
  // Read through a ref so changing settings never restarts the loop.
  const options = React.useRef({ barCount, mirror, fpsCap })

  React.useLayoutEffect(() => {
    options.current = { barCount, mirror, fpsCap }
  }, [barCount, mirror, fpsCap])

  React.useEffect(() => {
    let raf = 0
    let last = performance.now()
    let start = last
    let accumulator = 0

    const frame: FrameState = {
      level: 0,
      bands: new Float32Array(0),
      gateOpen: false,
      dt: 0,
      time: 0,
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)

      // A long tab-hidden pause would otherwise arrive as one enormous dt and
      // snap every envelope straight to its target.
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

      const {
        barCount: bars,
        mirror: shouldMirror,
        fpsCap: cap,
      } = options.current

      if (cap) {
        // rAF runs at the display's refresh rate, which on a 144Hz monitor
        // means 144 frames of work for a 60fps capture.
        accumulator += dt
        const interval = 1 / cap
        if (accumulator < interval) return
        accumulator %= interval
      }

      audioEngine.update(dt, bars, shouldMirror)

      frame.level = audioEngine.level
      frame.bands = audioEngine.bands
      frame.gateOpen = audioEngine.gateOpen
      frame.dt = dt
      frame.time = (now - start) / 1000

      renderBus.emit(frame)
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        last = performance.now()
        start = last - frame.time * 1000
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])
}

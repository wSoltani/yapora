import * as React from "react"

import { computeViewport, type Viewport } from "@/stage/geometry"

/**
 * Tracks the letterboxed stage viewport for a container element, so DOM
 * overlays can be positioned in the same coordinate space the SVG uses.
 */
export function useViewport(ref: React.RefObject<HTMLElement | null>) {
  const [viewport, setViewport] = React.useState<Viewport>(() =>
    computeViewport(0, 0)
  )

  React.useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setViewport(computeViewport(width, height))
    })

    observer.observe(element)
    const rect = element.getBoundingClientRect()
    setViewport(computeViewport(rect.width, rect.height))

    return () => observer.disconnect()
  }, [ref])

  return viewport
}

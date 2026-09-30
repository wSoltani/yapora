import * as React from "react"

import { useFrame } from "@/render/useStageRenderer"
import type { MouthConfig } from "@/store/schema"

import {
  computeBackdropRect,
  computeBarGeometry,
  computeBarLayout,
} from "./geometry"

interface MouthLayerProps {
  mouth: MouthConfig
}

export function MouthLayer({ mouth }: MouthLayerProps) {
  const maskId = `${React.useId()}-mouth-mask`
  const barsRef = React.useRef<Array<SVGRectElement | null>>([])

  const layout = React.useMemo(() => computeBarLayout(mouth), [mouth])
  const backdrop = React.useMemo(() => computeBackdropRect(mouth), [mouth])

  const indices = React.useMemo(
    () => Array.from({ length: mouth.barCount }, (_, i) => i),
    [mouth.barCount]
  )

  // Lowering the bar count leaves detached nodes at the tail of the ref array;
  // truncating after the refs are assigned keeps the frame loop from writing
  // to elements that are no longer in the document.
  React.useLayoutEffect(() => {
    barsRef.current.length = mouth.barCount
  }, [mouth.barCount])

  useFrame(({ bands }) => {
    const bars = barsRef.current

    for (let i = 0; i < bars.length; i++) {
      const rect = bars[i]
      if (!rect) continue

      const { y, height } = computeBarGeometry(bands[i] ?? 0, mouth, layout)

      // Writing y/height rather than a CSS scaleY transform: scaling squashes
      // the rounded caps into ellipses, so a "rounded bar" stops looking
      // rounded the moment it moves.
      rect.setAttribute("y", y.toFixed(2))
      rect.setAttribute("height", height.toFixed(2))
    }
  })

  if (!mouth.enabled) return null

  const feather = mouth.backdrop.feather

  return (
    <g data-layer="mouth" opacity={mouth.opacity}>
      {mouth.backdrop.enabled && (
        <>
          {feather > 0 && (
            <defs>
              {/*
                objectBoundingBox units make the radial gradient elliptical to
                match the backdrop's proportions automatically, so a wide short
                mouth fades evenly on every edge.
              */}
              <radialGradient id={`${maskId}-grad`}>
                <stop offset={Math.max(0, 1 - feather)} stopColor="#fff" />
                <stop offset={1} stopColor="#000" />
              </radialGradient>
              <mask id={maskId}>
                <rect
                  x={backdrop.x}
                  y={backdrop.y}
                  width={backdrop.width}
                  height={backdrop.height}
                  rx={backdrop.rx}
                  fill={`url(#${maskId}-grad)`}
                />
              </mask>
            </defs>
          )}
          {/*
            A semi-opaque plate, not a blur: backdrop-filter does not apply to
            SVG content, so this is what keeps the mouth legible when it sits
            over a busy part of the avatar.
          */}
          <rect
            x={backdrop.x}
            y={backdrop.y}
            width={backdrop.width}
            height={backdrop.height}
            rx={backdrop.rx}
            fill={mouth.backdrop.color}
            opacity={mouth.backdrop.opacity}
            mask={feather > 0 ? `url(#${maskId})` : undefined}
          />
        </>
      )}

      {indices.map((index) => {
        const initial = computeBarGeometry(0, mouth, layout)
        return (
          <rect
            key={index}
            ref={(node) => {
              barsRef.current[index] = node
            }}
            x={layout.x(index)}
            y={initial.y}
            width={layout.barWidth}
            height={initial.height}
            rx={layout.rx}
            fill={mouth.color}
          />
        )
      })}
    </g>
  )
}

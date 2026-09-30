import * as React from "react"

import { setAttr } from "@/render/dom"
import { useFrame } from "@/render/useStageRenderer"
import type { AvatarConfig, HaloConfig } from "@/store/schema"

import { avatarBox, ShapeOutline } from "./shape"

interface HaloLayerProps {
  halo: HaloConfig
  avatar: AvatarConfig
}

export function HaloLayer({ halo, avatar }: HaloLayerProps) {
  const filterId = `${React.useId()}-halo-glow`
  const groupRef = React.useRef<SVGGElement>(null)
  const ringRef = React.useRef<SVGPathElement>(null)
  const glowRef = React.useRef<SVGPathElement>(null)

  const outline = React.useMemo(
    () =>
      new ShapeOutline(avatar.shape, avatarBox(avatar), avatar.cornerRadius),
    [avatar]
  )

  /** Offset at rest: the gap is measured from the avatar's edge to the ring's inner edge. */
  const baseOffset = halo.gap + halo.thickness / 2

  useFrame(({ level }) => {
    // The floor keeps a little life in the ring during silence so it reads as
    // idle rather than broken.
    const amount = halo.floor + (1 - halo.floor) * level
    const path = outline.path(baseOffset + amount * halo.reactivity)

    setAttr(ringRef.current, "d", path)
    setAttr(glowRef.current, "d", path)

    // Opacity rides the same envelope as the size, so the ring brightens and
    // swells together rather than reading as two separate effects.
    const opacity =
      halo.opacityMin + (halo.opacityMax - halo.opacityMin) * amount
    setAttr(groupRef.current, "opacity", opacity.toFixed(3))
  })

  if (!halo.enabled) return null

  const restPath = outline.path(baseOffset)

  // The blur is recomputed over its whole region on every repaint, so the
  // region hugs the furthest the ring can reach — its largest offset, half
  // its stroke, and three standard deviations of blur — instead of covering
  // the entire stage.
  const box = avatarBox(avatar)
  const reach =
    baseOffset + halo.reactivity + halo.thickness / 2 + halo.glow * 3
  const glowRegion = {
    x: box.cx - box.width / 2 - reach,
    y: box.cy - box.height / 2 - reach,
    width: box.width + reach * 2,
    height: box.height + reach * 2,
  }

  return (
    <g ref={groupRef} data-layer="halo" opacity={halo.opacityMin}>
      {halo.glow > 0 && (
        <>
          <defs>
            {/*
              Blurring in userSpaceOnUse rather than with a CSS drop-shadow is
              deliberate: CSS filter lengths are in CSS pixels, so the glow
              would stay the same thickness while the stage scaled, and would
              look completely different in a 400px tab and a 1080p OBS source.
            */}
            <filter id={filterId} filterUnits="userSpaceOnUse" {...glowRegion}>
              <feGaussianBlur stdDeviation={halo.glow} />
            </filter>
          </defs>
          <path
            ref={glowRef}
            d={restPath}
            fill="none"
            stroke={halo.color}
            strokeWidth={halo.thickness}
            filter={`url(#${filterId})`}
            opacity={0.75}
          />
        </>
      )}

      {/*
        The outline is regenerated at each size with a fixed stroke-width,
        rather than scaling one shape: scaling would thin and thicken the ring
        as it breathes, and stretch a rectangle's corners unevenly.
      */}
      <path
        ref={ringRef}
        d={restPath}
        fill="none"
        stroke={halo.color}
        strokeWidth={halo.thickness}
        strokeLinejoin="round"
      />
    </g>
  )
}

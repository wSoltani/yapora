import * as React from "react"

import { useFrame } from "@/render/useStageRenderer"
import type { AvatarConfig, HaloConfig } from "@/store/schema"

interface HaloLayerProps {
  halo: HaloConfig
  avatar: AvatarConfig
}

export function HaloLayer({ halo, avatar }: HaloLayerProps) {
  const filterId = `${React.useId()}-halo-glow`
  const groupRef = React.useRef<SVGGElement>(null)
  const ringRef = React.useRef<SVGCircleElement>(null)
  const glowRef = React.useRef<SVGCircleElement>(null)

  /** Radius at rest: the gap is measured from the avatar's edge to the ring's inner edge. */
  const baseRadius = avatar.radius + halo.gap + halo.thickness / 2

  useFrame(({ level }) => {
    // The floor keeps a little life in the ring during silence so it reads as
    // idle rather than broken.
    const amount = halo.floor + (1 - halo.floor) * level
    const radius = (baseRadius + amount * halo.reactivity).toFixed(2)

    ringRef.current?.setAttribute("r", radius)
    glowRef.current?.setAttribute("r", radius)

    // Opacity rides the same envelope as the radius, so the ring brightens and
    // swells together rather than reading as two separate effects.
    const opacity =
      halo.opacityMin + (halo.opacityMax - halo.opacityMin) * amount
    groupRef.current?.setAttribute("opacity", opacity.toFixed(3))
  })

  if (!halo.enabled) return null

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
            <filter
              id={filterId}
              filterUnits="userSpaceOnUse"
              x={-200}
              y={-200}
              width={1400}
              height={1400}
            >
              <feGaussianBlur stdDeviation={halo.glow} />
            </filter>
          </defs>
          <circle
            ref={glowRef}
            cx={avatar.center.x}
            cy={avatar.center.y}
            r={baseRadius}
            fill="none"
            stroke={halo.color}
            strokeWidth={halo.thickness}
            filter={`url(#${filterId})`}
            opacity={0.75}
          />
        </>
      )}

      {/*
        A fixed stroke-width with an animated radius, rather than scaling the
        whole circle: scaling would thin and thicken the ring as it breathes,
        which reads as the halo changing weight instead of changing size.
      */}
      <circle
        ref={ringRef}
        cx={avatar.center.x}
        cy={avatar.center.y}
        r={baseRadius}
        fill="none"
        stroke={halo.color}
        strokeWidth={halo.thickness}
        strokeLinecap="round"
      />
    </g>
  )
}

import * as React from "react"

import { setAttr } from "@/render/dom"
import { useFrame } from "@/render/useStageRenderer"
import type { AvatarConfig, StageConfig } from "@/store/schema"

import { avatarMotion } from "./motion"
import { avatarBox, ShapeOutline } from "./shape"

interface AvatarLayerProps {
  avatar: AvatarConfig
  motion: StageConfig["motion"]
  url: string | null
}

export function AvatarLayer({ avatar, motion, url }: AvatarLayerProps) {
  const clipId = `${React.useId()}-avatar-clip`
  const groupRef = React.useRef<SVGGElement>(null)

  const { center, cropRect, natural, ringWidth, ringColor } = avatar
  const box = avatarBox(avatar)
  const outline = new ShapeOutline(avatar.shape, box, avatar.cornerRadius)
  const shapePath = outline.path()

  /**
   * Motion hook. All three amounts ship at 0, so this resolves to the identity
   * transform and the avatar sits still — but the wiring is already here, which
   * is what makes bounce/tilt/pop a settings change later rather than a
   * restructure of the render path.
   */
  useFrame(({ level, time }) => {
    const group = groupRef.current
    if (!group) return

    const moved = avatarMotion(motion, level, time)
    if (!moved) {
      if (group.getAttribute("transform") !== null) {
        group.removeAttribute("transform")
      }
      return
    }
    const { dy, angle, scale } = moved

    // Rounded, with signed zero folded away, so the transform stops changing
    // once the avatar settles and the frame loop stops repainting it.
    const f = (n: number, digits: number) =>
      (Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n).toFixed(digits)

    setAttr(
      group,
      "transform",
      `translate(${center.x} ${f(center.y + dy, 2)}) rotate(${f(angle, 2)}) scale(${f(scale, 4)}) translate(${-center.x} ${-center.y})`
    )
  })

  return (
    <g ref={groupRef} data-layer="avatar">
      <defs>
        <clipPath id={clipId}>
          <path d={shapePath} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {url && cropRect && natural ? (
          /**
           * A nested <svg> whose viewBox is the crop rectangle in the source
           * image's own pixels. This windows into the image losslessly — the
           * original is never resampled or re-encoded, so the crop stays
           * re-editable at full quality and scales to any OBS resolution.
           */
          <svg
            x={box.cx - box.width / 2}
            y={box.cy - box.height / 2}
            width={box.width}
            height={box.height}
            viewBox={`${cropRect.x} ${cropRect.y} ${cropRect.width} ${cropRect.height}`}
            preserveAspectRatio="xMidYMid slice"
            overflow="hidden"
          >
            <image
              href={url}
              x={0}
              y={0}
              width={natural.width}
              height={natural.height}
              preserveAspectRatio="none"
            />
          </svg>
        ) : (
          <path d={shapePath} fill="currentColor" fillOpacity={0.08} />
        )}
      </g>

      {ringWidth > 0 && (
        <path
          d={outline.path(-ringWidth / 2)}
          fill="none"
          stroke={ringColor}
          strokeWidth={ringWidth}
        />
      )}
    </g>
  )
}

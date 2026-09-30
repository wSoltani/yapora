import { useStageRenderer } from "@/render/useStageRenderer"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"
import { STAGE_CENTER, STAGE_SIZE } from "@/store/schema"

import { AvatarLayer } from "./AvatarLayer"
import { backgroundCss } from "./background"
import { HaloLayer } from "./HaloLayer"
import { MouthLayer } from "./MouthLayer"

interface StageProps {
  className?: string
  /** Edit mode draws a checkerboard so "transparent" is actually visible. */
  showCheckerboard?: boolean
}

export function Stage({ className, showCheckerboard = false }: StageProps) {
  const profile = useProfileStore((s) => s.profile)
  const avatarUrl = useAppStore((s) => s.avatarUrl)

  const { avatar, halo, mouth, stage, ui } = profile

  useStageRenderer({
    barCount: mouth.barCount,
    mirror: mouth.mirrorSpectrum,
    fpsCap: ui.fpsCap,
  })

  const background = backgroundCss(stage)
  const transparent = stage.background === "transparent"
  const checkerboard = transparent && showCheckerboard

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background,
      }}
      data-stage-root=""
    >
      {checkerboard && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #1b1b1f 25%, transparent 25%), linear-gradient(-45deg, #1b1b1f 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1b1b1f 75%), linear-gradient(-45deg, transparent 75%, #1b1b1f 75%)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0px",
            backgroundColor: "#111114",
          }}
        />
      )}

      <svg
        style={{ position: "relative", width: "100%", height: "100%" }}
        viewBox={`0 0 ${STAGE_SIZE} ${STAGE_SIZE}`}
        preserveAspectRatio="xMidYMid meet"
        /* The stage is decorative output, not content to be announced. */
        aria-hidden
      >
        <g
          transform={
            stage.scale === 1
              ? undefined
              : `translate(${STAGE_CENTER} ${STAGE_CENTER}) scale(${stage.scale}) translate(${-STAGE_CENTER} ${-STAGE_CENTER})`
          }
        >
          {/* Halo first so its glow sits behind the avatar rather than over it. */}
          <HaloLayer halo={halo} avatar={avatar} />
          <AvatarLayer avatar={avatar} motion={stage.motion} url={avatarUrl} />
          <MouthLayer mouth={mouth} />
        </g>
      </svg>
    </div>
  )
}

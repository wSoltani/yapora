import type { HaloConfig, StageConfig } from "@/store/schema"

/**
 * Per-frame maths shared by the live SVG layers and the export renderer, so
 * an exported video moves exactly as the preview did.
 */

/** How far the halo ring sits outside the avatar, and how opaque it is. */
export function haloFrame(halo: HaloConfig, level: number) {
  // The floor keeps a little life in the ring during silence so it reads as
  // idle rather than broken.
  const amount = halo.floor + (1 - halo.floor) * level
  return {
    // The gap is measured from the avatar's edge to the ring's inner edge.
    offset: halo.gap + halo.thickness / 2 + amount * halo.reactivity,
    // Opacity rides the same envelope as the size, so the ring brightens and
    // swells together rather than reading as two separate effects.
    opacity: halo.opacityMin + (halo.opacityMax - halo.opacityMin) * amount,
  }
}

/** The ring's offset at rest and at its largest. */
export function haloReach(halo: HaloConfig) {
  const rest = halo.gap + halo.thickness / 2
  return { rest, max: rest + halo.reactivity }
}

export interface AvatarMotion {
  dy: number
  /** Degrees. */
  angle: number
  scale: number
}

/** `null` when every motion amount is zero and the avatar sits still. */
export function avatarMotion(
  motion: StageConfig["motion"],
  level: number,
  time: number
): AvatarMotion | null {
  if (motion.bounce === 0 && motion.tilt === 0 && motion.pop === 0) {
    return null
  }
  return {
    dy: -level * motion.bounce,
    angle: Math.sin(time * 1.4) * motion.tilt * level,
    scale: 1 + level * motion.pop,
  }
}

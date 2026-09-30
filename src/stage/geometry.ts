import { STAGE_SIZE, type MouthConfig } from "@/store/schema"

export interface Viewport {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * The SVG uses `preserveAspectRatio="xMidYMid meet"`, so it letterboxes the
 * square stage inside whatever box the container has. Reproducing that maths
 * here is what lets the edit-mode gizmo — a plain DOM overlay — sit exactly on
 * top of SVG geometry at any window size.
 */
export function computeViewport(width: number, height: number): Viewport {
  const scale = Math.min(width, height) / STAGE_SIZE || 1
  return {
    scale,
    offsetX: (width - STAGE_SIZE * scale) / 2,
    offsetY: (height - STAGE_SIZE * scale) / 2,
  }
}

export const stageToPxX = (x: number, v: Viewport) => v.offsetX + x * v.scale
export const stageToPxY = (y: number, v: Viewport) => v.offsetY + y * v.scale
export const stageToPxLen = (len: number, v: Viewport) => len * v.scale

export const pxToStageX = (x: number, v: Viewport) => (x - v.offsetX) / v.scale
export const pxToStageY = (y: number, v: Viewport) => (y - v.offsetY) / v.scale
export const pxToStageLen = (len: number, v: Viewport) => len / v.scale

export interface BarLayout {
  /** Left edge of bar i. */
  x: (index: number) => number
  barWidth: number
  slot: number
  left: number
  top: number
  centerY: number
  bottom: number
  rx: number
}

export function computeBarLayout(mouth: MouthConfig): BarLayout {
  const left = mouth.center.x - mouth.width / 2
  const slot = mouth.width / mouth.barCount
  const barWidth = slot * (1 - mouth.gapRatio)
  const inset = (slot - barWidth) / 2

  return {
    x: (index) => left + slot * index + inset,
    barWidth,
    slot,
    left,
    top: mouth.center.y - mouth.height / 2,
    centerY: mouth.center.y,
    bottom: mouth.center.y + mouth.height / 2,
    rx: (barWidth / 2) * mouth.capRadius,
  }
}

/**
 * Height and vertical origin for a bar at a given 0..1 value.
 * `minHeight` keeps the mouth visible as a closed line during silence rather
 * than having it vanish entirely.
 */
export function computeBarGeometry(
  value: number,
  mouth: MouthConfig,
  layout: BarLayout
): { y: number; height: number } {
  const fraction = mouth.minHeight + (1 - mouth.minHeight) * value
  const height = Math.max(0.5, mouth.height * fraction)

  if (mouth.symmetry === "baseline") {
    return { y: layout.bottom - height, height }
  }

  return { y: layout.centerY - height / 2, height }
}

/** Backdrop rect, expanded from the mouth box by its padding. */
export function computeBackdropRect(mouth: MouthConfig) {
  const padding = mouth.backdrop.padding
  const width = mouth.width + padding * 2
  const height = mouth.height + padding * 2

  return {
    x: mouth.center.x - width / 2,
    y: mouth.center.y - height / 2,
    width,
    height,
    rx: (height / 2) * mouth.backdrop.radius,
  }
}

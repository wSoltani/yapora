import * as React from "react"

import {
  pxToStageLen,
  stageToPxLen,
  stageToPxX,
  stageToPxY,
  type Viewport,
} from "@/stage/geometry"
import { STAGE_SIZE, type MouthConfig } from "@/store/schema"
import { cn } from "@/lib/utils"

const MIN_WIDTH = 20
const MIN_HEIGHT = 10

/** Anchor direction per handle: -1 = leading edge, 1 = trailing, 0 = fixed. */
const HANDLES = [
  { id: "nw", x: -1, y: -1, cursor: "nwse-resize" },
  { id: "n", x: 0, y: -1, cursor: "ns-resize" },
  { id: "ne", x: 1, y: -1, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0, y: 1, cursor: "ns-resize" },
  { id: "sw", x: -1, y: 1, cursor: "nesw-resize" },
  { id: "w", x: -1, y: 0, cursor: "ew-resize" },
] as const

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const toRect = (mouth: MouthConfig): Rect => ({
  left: mouth.center.x - mouth.width / 2,
  top: mouth.center.y - mouth.height / 2,
  right: mouth.center.x + mouth.width / 2,
  bottom: mouth.center.y + mouth.height / 2,
})

interface MouthGizmoProps {
  mouth: MouthConfig
  viewport: Viewport
  onChange: (patch: Partial<MouthConfig>) => void
  onDismiss: () => void
}

/**
 * Drag/resize handles for the mouth.
 *
 * A plain DOM overlay rather than a gizmo library: the stage-to-pixel mapping
 * is a uniform scale plus a letterbox offset, so converting pointer deltas
 * directly into stage units is exact and avoids round-tripping through a
 * library's CSS transforms.
 */
export function MouthGizmo({
  mouth,
  viewport,
  onChange,
  onDismiss,
}: MouthGizmoProps) {
  const frameRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{
    mode: "move" | "resize"
    handle: (typeof HANDLES)[number] | null
    startX: number
    startY: number
    rect: Rect
  } | null>(null)

  const rect = toRect(mouth)

  const left = stageToPxX(rect.left, viewport)
  const top = stageToPxY(rect.top, viewport)
  const width = stageToPxLen(mouth.width, viewport)
  const height = stageToPxLen(mouth.height, viewport)

  const commit = (next: Rect) => {
    const w = Math.max(MIN_WIDTH, next.right - next.left)
    const h = Math.max(MIN_HEIGHT, next.bottom - next.top)
    onChange({
      center: {
        x: Math.round((next.left + next.right) / 2),
        y: Math.round((next.top + next.bottom) / 2),
      },
      width: Math.round(w),
      height: Math.round(h),
    })
  }

  /**
   * One handler for the frame and all eight handles; which was grabbed comes
   * from the element's own `data-handle`. Keeps this a plain event handler
   * rather than a factory called during render.
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const id = event.currentTarget.dataset.handle
    const handle = HANDLES.find((candidate) => candidate.id === id) ?? null

    drag.current = {
      mode: handle ? "resize" : "move",
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect: toRect(mouth),
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state) return

    const dx = pxToStageLen(event.clientX - state.startX, viewport)
    const dy = pxToStageLen(event.clientY - state.startY, viewport)
    const start = state.rect

    if (state.mode === "move") {
      const w = start.right - start.left
      const h = start.bottom - start.top
      // Keep the box inside the stage so it can never be dragged out of reach.
      const cx = Math.min(
        STAGE_SIZE - w / 2,
        Math.max(w / 2, (start.left + start.right) / 2 + dx)
      )
      const cy = Math.min(
        STAGE_SIZE - h / 2,
        Math.max(h / 2, (start.top + start.bottom) / 2 + dy)
      )
      commit({
        left: cx - w / 2,
        right: cx + w / 2,
        top: cy - h / 2,
        bottom: cy + h / 2,
      })
      return
    }

    const handle = state.handle
    if (!handle) return

    const next = { ...start }

    // The opposite edge stays put, so the box grows from the handle you grabbed.
    if (handle.x === -1)
      next.left = Math.min(start.right - MIN_WIDTH, start.left + dx)
    if (handle.x === 1)
      next.right = Math.max(start.left + MIN_WIDTH, start.right + dx)
    if (handle.y === -1)
      next.top = Math.min(start.bottom - MIN_HEIGHT, start.top + dy)
    if (handle.y === 1)
      next.bottom = Math.max(start.top + MIN_HEIGHT, start.bottom + dy)

    if (event.shiftKey && handle.x !== 0 && handle.y !== 0) {
      // Lock aspect from the anchored corner rather than the centre.
      const ratio = (start.right - start.left) / (start.bottom - start.top)
      const w = next.right - next.left
      const h = w / ratio
      if (handle.y === -1) next.top = next.bottom - h
      else next.bottom = next.top + h
    }

    commit(next)
  }

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drag.current = null
  }

  /**
   * Keyboard nudging. Handles are fine for roughing a position in, but landing
   * a mouth precisely on a face is a one-pixel-at-a-time job.
   */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }

    if (event.key === "Escape") {
      onDismiss()
      return
    }

    const delta = deltas[event.key]
    if (!delta) return

    event.preventDefault()
    onChange({
      center: {
        x: mouth.center.x + delta[0],
        y: mouth.center.y + delta[1],
      },
    })
  }

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      role="application"
      aria-label="Mouth position and size"
      className={cn(
        "absolute cursor-move rounded-sm outline-none",
        "ring-1 ring-sky-400/80 focus-visible:ring-2 focus-visible:ring-sky-300"
      )}
      style={{ left, top, width, height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <div className="pointer-events-none absolute -top-5 left-0 rounded-sm bg-sky-400/90 px-1 font-mono text-[9px] leading-4 text-sky-950">
        {Math.round(mouth.width)} × {Math.round(mouth.height)}
      </div>

      {HANDLES.map((handle) => (
        <div
          key={handle.id}
          data-handle={handle.id}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute size-2.5 rounded-full border border-sky-950/50 bg-sky-300 shadow-sm"
          style={{
            cursor: handle.cursor,
            left: `calc(${((handle.x + 1) / 2) * 100}% - 5px)`,
            top: `calc(${((handle.y + 1) / 2) * 100}% - 5px)`,
          }}
        />
      ))}
    </div>
  )
}

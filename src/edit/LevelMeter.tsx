import * as React from "react"

import { audioEngine } from "@/audio/AudioEngine"
import { setAttr, setStyle, setText } from "@/render/dom"
import { useFrame } from "@/render/useStageRenderer"

const METER_MIN = -70
const METER_MAX = 0

const toPercent = (db: number) =>
  ((Math.max(METER_MIN, Math.min(METER_MAX, db)) - METER_MIN) /
    (METER_MAX - METER_MIN)) *
  100

interface LevelMeterProps {
  gateThreshold: number
  ceiling: number
}

/**
 * Input level with the gate and ceiling drawn on it.
 *
 * Tuning a noise gate blind is guesswork — you cannot tell whether the mouth is
 * still because the threshold is too high or because the mic is dead. Showing
 * the live level against both markers turns it into a single obvious decision:
 * put the gate just above where the room sits when you are silent.
 */
export function LevelMeter({ gateThreshold, ceiling }: LevelMeterProps) {
  const fillRef = React.useRef<HTMLDivElement>(null)
  const peakRef = React.useRef<HTMLDivElement>(null)
  const dotRef = React.useRef<HTMLDivElement>(null)
  const readoutRef = React.useRef<HTMLSpanElement>(null)

  const peak = React.useRef({ value: METER_MIN, at: 0 })
  const drawnAt = React.useRef(0)

  useFrame(({ time }) => {
    const db = audioEngine.levelDb

    // Peak hold, so a transient that lasts two frames is still readable.
    if (db > peak.current.value || time - peak.current.at > 1.2) {
      peak.current = { value: db, at: time }
    }

    // Room noise moves the level every frame. A meter reads just as well at
    // 30 fps and whole-percent steps, and every write it skips is a repaint
    // the window does not have to do.
    if (time - drawnAt.current < 1 / 30) return
    drawnAt.current = time

    setStyle(fillRef.current, "width", `${Math.round(toPercent(db))}%`)
    setStyle(
      peakRef.current,
      "left",
      `${Math.round(toPercent(peak.current.value))}%`
    )
    setAttr(dotRef.current, "data-open", String(audioEngine.gateOpen))
    setText(
      readoutRef.current,
      db <= METER_MIN ? "−∞ dB" : `${db.toFixed(0)} dB`
    )
  })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <div
            ref={dotRef}
            data-open="false"
            className="size-1.5 rounded-full bg-muted-foreground/40 transition-colors data-[open=true]:bg-emerald-400"
          />
          <span className="text-[10px] text-muted-foreground">Input</span>
        </div>
        <span
          ref={readoutRef}
          className="font-mono text-[10px] text-muted-foreground"
        >
          −∞ dB
        </span>
      </div>

      <div className="relative h-3 w-full overflow-hidden rounded-sm bg-muted">
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 w-0 bg-gradient-to-r from-emerald-500/70 via-emerald-400 to-amber-400"
        />
        <div
          ref={peakRef}
          className="absolute inset-y-0 w-px bg-foreground/60"
          style={{ left: "0%" }}
        />

        {/* Gate: everything to the left of this reads as silence. */}
        <div
          className="absolute inset-y-0 w-0.5 bg-sky-400"
          style={{ left: `${toPercent(gateThreshold)}%` }}
          title="Noise gate"
        />
        {/* Ceiling: the level that produces a full-scale response. */}
        <div
          className="absolute inset-y-0 w-0.5 bg-rose-400"
          style={{ left: `${toPercent(ceiling)}%` }}
          title="Ceiling"
        />
      </div>

      <div className="flex justify-between text-[9px] text-muted-foreground/60">
        <span>−70</span>
        <span className="text-sky-400">gate</span>
        <span className="text-rose-400">ceiling</span>
        <span>0 dB</span>
      </div>
    </div>
  )
}

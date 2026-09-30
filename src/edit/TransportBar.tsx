import * as React from "react"
import { Pause, Play } from "lucide-react"
import { toast } from "sonner"

import {
  formatTime,
  pause,
  play,
  PlayheadClock,
  readTransport,
  seek,
  type TrackInfo,
  type Transport,
} from "@/audio/player"
import { Button } from "@/components/ui/button"
import { setAttr, setText } from "@/render/dom"

const POLL_MS = 250
const WAVE_HEIGHT = 100

/** The waveform as one filled shape, mirrored about the centre line. */
function wavePath(peaks: number[]): string {
  const mid = WAVE_HEIGHT / 2
  const top = peaks.map(
    (p, i) => `${i === 0 ? "M" : "L"}${i} ${(mid - p * mid).toFixed(1)}`
  )
  const bottom = peaks
    .map((p, i) => `L${i} ${(mid + p * mid).toFixed(1)}`)
    .reverse()
  return `${top.join("")}${bottom.join("")}Z`
}

/** Keys pressed in these should do their own thing, not play/pause. */
function isInteractive(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        "input, textarea, select, button, [role=slider], [role=switch], [role=combobox]"
      ) !== null)
  )
}

/**
 * Play, pause and scrub the audio file driving the preview. The playhead is
 * drawn from a local clock between polls, so it moves smoothly without an
 * IPC call per frame.
 */
export function TransportBar({ track }: { track: TrackInfo }) {
  const [clock] = React.useState(() => new PlayheadClock())
  const [playing, setPlaying] = React.useState(false)
  const waveRef = React.useRef<SVGSVGElement>(null)
  const playedRef = React.useRef<SVGRectElement>(null)
  const timeRef = React.useRef<HTMLSpanElement>(null)

  const path = React.useMemo(() => wavePath(track.peaks), [track.peaks])
  const width = Math.max(1, track.peaks.length - 1)

  const sync = React.useCallback(
    (transport: Transport) => {
      clock.sync(transport)
      setPlaying(transport.playing)
    },
    [clock]
  )

  React.useEffect(() => {
    let alive = true
    const poll = () => {
      void readTransport().then((t) => alive && sync(t))
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sync, track])

  React.useEffect(() => {
    let raf = 0
    const draw = () => {
      const position = clock.now(track.duration)
      const fraction = track.duration > 0 ? position / track.duration : 0
      setAttr(playedRef.current, "width", (fraction * width).toFixed(1))
      setText(
        timeRef.current,
        `${formatTime(position)} / ${formatTime(track.duration)}`
      )
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [clock, track.duration, width])

  const toggle = React.useCallback(() => {
    // Play can fail if the speakers cannot be opened; the Audio tab shows
    // the details, this just says why nothing happened.
    void (clock.playing ? pause() : play()).then(sync, (error: unknown) => {
      toast.error(String(error).split("\n")[0])
    })
  }, [clock, sync])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || isInteractive(event.target)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggle])

  const seekTo = (clientX: number) => {
    const rect = waveRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const fraction = Math.min(
      1,
      Math.max(0, (clientX - rect.left) / rect.width)
    )
    const seconds = fraction * track.duration
    // Move the playhead now; the app confirms on the next poll.
    clock.sync({ position: seconds, playing: clock.playing })
    void seek(seconds).then(sync)
  }

  return (
    <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background/80 p-1.5 pr-3 shadow-lg backdrop-blur">
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause /> : <Play />}
      </Button>

      <svg
        ref={waveRef}
        viewBox={`0 0 ${width} ${WAVE_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-8 min-w-0 flex-1 cursor-pointer touch-none"
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(track.duration)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          seekTo(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            seekTo(event.clientX)
          }
        }}
      >
        <defs>
          <clipPath id="transport-played">
            <rect ref={playedRef} x={0} y={0} width={0} height={WAVE_HEIGHT} />
          </clipPath>
        </defs>
        <path d={path} className="fill-muted-foreground/35" />
        <path
          d={path}
          className="fill-primary"
          clipPath="url(#transport-played)"
        />
      </svg>

      <span
        ref={timeRef}
        className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums"
      />
    </div>
  )
}

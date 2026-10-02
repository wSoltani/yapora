import * as React from "react"
import { Film, X } from "lucide-react"
import { toast } from "sonner"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Button } from "@/components/ui/button"
import { Field } from "@/edit/controls"
import {
  chooseExportPath,
  exportVideo,
  supportedFormats,
  type VideoFormat,
} from "@/export/exporter"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"

const SIZES = {
  square: { label: "Square", width: 1080, height: 1080 },
  landscape: { label: "16:9", width: 1920, height: 1080 },
  portrait: { label: "9:16", width: 1080, height: 1920 },
} as const
type SizeKey = keyof typeof SIZES

const FORMAT_LABELS: Record<VideoFormat, string> = {
  mp4: "MP4",
  webm: "WebM",
}

async function loadImage(url: string | null) {
  if (!url) return null
  const blob = await (await fetch(url)).blob()
  return createImageBitmap(blob)
}

/**
 * Renders the loaded audio file to a video with the current look. Lives in
 * the Output tab; the file itself is chosen in Audio → Source.
 */
export function VideoExport() {
  const track = useAppStore((s) => s.track)
  const avatarUrl = useAppStore((s) => s.avatarUrl)
  const background = useProfileStore((s) => s.profile.stage.background)
  // Saved with the profile, so each look keeps its own export settings.
  const {
    size,
    fps,
    format: preferred,
  } = useProfileStore((s) => s.profile.export)
  const setExport = useProfileStore((s) => s.setExport)

  const [formats, setFormats] = React.useState<VideoFormat[] | null>(null)
  const [progress, setProgress] = React.useState<number | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const { width, height } = SIZES[size]
  // The saved choice stays saved even where it can't be encoded, so moving a
  // profile to another machine doesn't silently rewrite it.
  const format = formats?.includes(preferred) ? preferred : formats?.[0]

  React.useEffect(() => {
    let alive = true
    void supportedFormats(width, height).then((found) => {
      if (alive) setFormats(found)
    })
    return () => {
      alive = false
    }
  }, [width, height])

  const run = async () => {
    if (!track || !format) return
    const path = await chooseExportPath(track.name, format)
    if (!path) return

    const abort = new AbortController()
    abortRef.current = abort
    setProgress(0)
    try {
      await exportVideo({
        path,
        // Snapshot: edits made while it renders don't change it halfway.
        profile: structuredClone(useProfileStore.getState().profile),
        image: await loadImage(avatarUrl),
        settings: { width, height, fps, format },
        onProgress: setProgress,
        signal: abort.signal,
      })
      toast.success(`Video saved to ${path}`)
    } catch (error) {
      if (abort.signal.aborted) {
        toast("Export cancelled")
      } else {
        toast.error(
          `Export failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  if (!track) {
    return (
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Choose an audio file in{" "}
        <span className="font-medium text-foreground">
          Audio &rsaquo; Source &rsaquo; Audio file
        </span>
        , then export it here as a video with your current look.
      </p>
    )
  }

  const exporting = progress !== null

  return (
    <div className="flex flex-col gap-3">
      <p className="truncate text-xs">
        <span className="text-muted-foreground">Audio: </span>
        <span className="font-medium">{track.name}</span>
      </p>

      <Field label="Size" hint={`${width} × ${height}`}>
        <ToggleGroup
          value={[size]}
          onValueChange={(value) => {
            const next = value[0] as SizeKey | undefined
            if (next) setExport({ size: next })
          }}
          disabled={exporting}
          className="w-full"
        >
          {(Object.keys(SIZES) as SizeKey[]).map((key) => (
            <ToggleGroupItem
              key={key}
              value={key}
              className="flex-1 text-[11px]"
            >
              {SIZES[key].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field label="Frame rate">
        <ToggleGroup
          value={[String(fps)]}
          onValueChange={(value) => {
            if (value[0] === "30" || value[0] === "60") {
              setExport({ fps: Number(value[0]) as 30 | 60 })
            }
          }}
          disabled={exporting}
          className="w-full"
        >
          {[30, 60].map((rate) => (
            <ToggleGroupItem
              key={rate}
              value={String(rate)}
              className="flex-1 text-[11px]"
            >
              {rate} fps
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field label="Format">
        {formats && format ? (
          <ToggleGroup
            value={[format]}
            onValueChange={(value) => {
              const next = value[0] as VideoFormat | undefined
              if (next) setExport({ format: next })
            }}
            disabled={exporting}
            className="w-full"
          >
            {formats.map((f) => (
              <ToggleGroupItem key={f} value={f} className="flex-1 text-[11px]">
                {FORMAT_LABELS[f]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            {formats
              ? "No video encoder is available at this size."
              : "Checking…"}
          </p>
        )}
      </Field>

      {background === "transparent" && format && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {format === "webm"
            ? "WebM keeps the background transparent. OBS and Chrome show it; some players show black instead."
            : formats?.includes("webm")
              ? "MP4 can't be transparent, so the background exports as green screen (#00b140). Choose WebM to keep it transparent."
              : "MP4 can't be transparent, so the background exports as green screen (#00b140)."}
        </p>
      )}

      {exporting ? (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">
            {Math.round(progress * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => abortRef.current?.abort()}
            aria-label="Cancel export"
          >
            <X />
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          disabled={!formats || formats.length === 0}
          onClick={() => void run()}
        >
          <Film />
          Export video
        </Button>
      )}
    </div>
  )
}

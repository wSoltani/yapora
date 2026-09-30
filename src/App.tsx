import * as React from "react"
import { MicOff } from "lucide-react"

import { analysisLink } from "@/audio/link"
import { useAudioSession } from "@/hooks/useAudioSession"
import { useAvatarImage } from "@/hooks/useAvatarImage"
import { inApp } from "@/lib/native"
import { Stage } from "@/stage/Stage"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"

/**
 * The editor is a separate chunk. An OBS Browser Source only ever loads Live
 * mode, and it has no business downloading and parsing the image cropper,
 * colour picker and settings panel to draw a circle.
 */
const EditMode = React.lazy(() => import("@/edit/EditMode"))

/**
 * Live mode is styled with inline CSS, not Tailwind classes.
 *
 * OBS 30 and earlier ship CEF 103 (Chrome 103), and Tailwind v4 requires
 * Chrome 111 — it leans on `@property` and `color-mix()` internally. `svh`
 * units need Chrome 108. A Tailwind-styled live root therefore collapses to
 * zero height in OBS and renders a black screen. Everything below uses plain
 * CSS that has worked for a decade, which is also why the SVG stage itself
 * survives untouched: it was already inline attributes.
 */
const LIVE_ROOT: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
}

const BADGE_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  borderRadius: 6,
  // rgba() rather than a `/85` opacity modifier, which compiles to color-mix().
  background: "rgba(69, 10, 10, 0.85)",
  color: "rgb(254, 202, 202)",
  font: "500 11px/1.4 system-ui, sans-serif",
  pointerEvents: "none",
}

function LiveErrorBadge() {
  const micStatus = useAppStore((s) => s.micStatus)
  const showBadge = useProfileStore((s) => s.profile.ui.showErrorBadge)

  const label =
    micStatus === "denied"
      ? "Mic permission denied"
      : micStatus === "error"
        ? "Mic unavailable"
        : micStatus === "offline"
          ? "Yapora app not running"
          : null
  if (!showBadge || !label) return null

  return (
    <div style={BADGE_STYLE}>
      <MicOff width={12} height={12} />
      {label}
    </div>
  )
}

function LiveMode() {
  return (
    <div style={LIVE_ROOT}>
      <Stage />
      <LiveErrorBadge />
    </div>
  )
}

export function App() {
  const mode = useAppStore((s) => s.mode)
  const toggleMode = useAppStore((s) => s.toggleMode)
  const setMode = useAppStore((s) => s.setMode)
  const load = useProfileStore((s) => s.load)
  const loaded = useProfileStore((s) => s.loaded)

  React.useEffect(() => {
    void load()
  }, [load])

  // OBS renders a read-only copy of the app's profile, so it follows each
  // save as it lands — tuning in the editor shows up on stream immediately.
  React.useEffect(() => {
    if (inApp) return
    return analysisLink.onProfile(() => void load())
  }, [load])

  useAvatarImage()
  useAudioSession(loaded)

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.isContentEditable ||
        target?.closest("input, textarea, select")
      ) {
        return
      }

      if (event.key === "Escape" && mode === "live") {
        setMode("edit")
        return
      }
      // Ctrl/Cmd+E is the only global chord, so Live mode stays escapable
      // without any visible chrome to click.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
        event.preventDefault()
        toggleMode()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [mode, setMode, toggleMode])

  if (!loaded) {
    return <div style={LIVE_ROOT} />
  }

  return (
    <>
      {mode === "live" ? (
        <LiveMode />
      ) : (
        <React.Suspense fallback={<div style={LIVE_ROOT} />}>
          <EditMode />
        </React.Suspense>
      )}
    </>
  )
}

export default App

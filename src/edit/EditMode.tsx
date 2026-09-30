import * as React from "react"
import { Eye, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { MouthGizmo } from "@/edit/MouthGizmo"
import { ProfileSwitcher } from "@/edit/ProfileSwitcher"
import { SettingsPanel } from "@/edit/SettingsPanel"
import { useViewport } from "@/hooks/useViewport"
import { Stage } from "@/stage/Stage"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"

export function EditMode() {
  const stageRef = React.useRef<HTMLDivElement>(null)
  const viewport = useViewport(stageRef)

  const mouth = useProfileStore((s) => s.profile.mouth)
  const showCheckerboard = useProfileStore((s) => s.profile.ui.showCheckerboard)
  const setMouth = useProfileStore((s) => s.setMouth)
  const selection = useAppStore((s) => s.selection)
  const setSelection = useAppStore((s) => s.setSelection)
  const setMode = useAppStore((s) => s.setMode)

  return (
    <div className="flex h-full w-full flex-col gap-3 bg-background p-3 lg:flex-row">
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
      >
        <Stage showCheckerboard={showCheckerboard} />

        {selection === "mouth" && (
          <MouthGizmo
            mouth={mouth}
            viewport={viewport}
            onChange={setMouth}
            onDismiss={() => setSelection(null)}
          />
        )}

        <div className="absolute top-3 left-3">
          <ProfileSwitcher />
        </div>

        <div className="absolute right-3 bottom-3 flex items-center gap-2">
          <span className="pointer-events-none hidden text-[10px] whitespace-nowrap text-muted-foreground/70 sm:inline">
            <Pencil className="mr-1 inline size-2.5" />
            Ctrl/⌘ + E
          </span>
          <Button
            size="sm"
            className="shadow-lg"
            onClick={() => setMode("live")}
          >
            <Eye />
            Go live
          </Button>
        </div>
      </div>

      <aside className="flex min-h-0 w-full shrink-0 flex-col gap-3 lg:w-80">
        <div className="min-h-0 flex-1">
          <SettingsPanel />
        </div>
      </aside>

      <Toaster position="bottom-left" />
    </div>
  )
}

export default EditMode

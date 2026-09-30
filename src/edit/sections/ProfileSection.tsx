import * as React from "react"
import { Copy, Download, RotateCcw, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Field, SectionGroup } from "@/edit/controls"
import {
  downloadProfile,
  exportProfile,
  importProfile,
  ProfileImportError,
} from "@/edit/profileIO"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"

export function ProfileSection() {
  const profile = useProfileStore((s) => s.profile)
  const setName = useProfileStore((s) => s.setName)
  const replace = useProfileStore((s) => s.replace)
  const reset = useProfileStore((s) => s.reset)
  const micStatus = useAppStore((s) => s.micStatus)
  const micError = useAppStore((s) => s.micError)

  const inputRef = React.useRef<HTMLInputElement>(null)

  const liveUrl = React.useMemo(() => {
    const url = new URL(window.location.href)
    url.searchParams.set("mode", "live")
    url.hash = ""
    return url.toString()
  }, [])

  const handleExport = async () => {
    const bundle = await exportProfile(profile)
    downloadProfile(bundle, profile.name || "yapora")
    toast.success("Profile exported")
  }

  const handleImport = async (file: File) => {
    try {
      const imported = await importProfile(await file.text())
      replace(imported)
      toast.success("Profile imported")
    } catch (error) {
      toast.error(
        error instanceof ProfileImportError
          ? error.message
          : "Could not import that file."
      )
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionGroup title="Profile">
        <Field label="Name">
          <Input
            value={profile.name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 text-xs"
          />
        </Field>

        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleImport(file)
            event.target.value = ""
          }}
        />

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void handleExport()}
          >
            <Download />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => inputRef.current?.click()}
          >
            <Upload />
            Import
          </Button>
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          OBS runs its own browser storage, so settings saved here don't exist
          inside OBS. Export a profile, then import it through OBS's{" "}
          <span className="font-medium text-foreground">Interact</span> window.
        </p>
      </SectionGroup>

      <Separator />

      <SectionGroup title="OBS source">
        <Field label="Browser source URL">
          <div className="flex gap-2">
            <Input
              readOnly
              value={liveUrl}
              className="h-8 font-mono text-[10px]"
              onFocus={(event) => event.target.select()}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(liveUrl)
                toast.success("URL copied")
              }}
              aria-label="Copy URL"
            >
              <Copy />
            </Button>
          </div>
        </Field>

        <div className="rounded-md bg-muted/50 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">
            Microphone access in OBS
          </p>
          <p className="mb-1.5">
            OBS never shows a permission prompt, so a Browser Source is refused
            by default. Close OBS and relaunch it with both flags:
          </p>
          <code className="mb-1.5 block rounded bg-background/80 p-1.5 break-all text-foreground">
            obs64.exe --enable-media-stream --use-fake-ui-for-media-stream
          </code>
          <p className="mb-1.5">
            On Windows: right-click your OBS shortcut, Properties, and append
            both flags to the end of the Target field.
          </p>
          <p>
            The flags only bypass the browser prompt. Windows still needs{" "}
            <span className="font-medium text-foreground">
              Settings &rsaquo; Privacy &amp; security &rsaquo; Microphone
            </span>{" "}
            to allow desktop apps, and the source must be served over localhost
            or https &mdash; a <code>file://</code> path is blocked outright.
          </p>
        </div>

        {micStatus !== "running" && (
          <div className="rounded-md bg-destructive/10 p-2.5 text-[10px] leading-relaxed text-destructive">
            Microphone status: <strong>{micStatus}</strong>
            {micError && (
              <span className="mt-1 block opacity-90">{micError}</span>
            )}
          </div>
        )}
      </SectionGroup>

      <Separator />

      <SectionGroup title="Reset">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            reset()
            toast.success("Settings reset")
          }}
        >
          <RotateCcw />
          Reset all settings
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Your uploaded image is kept.
        </p>
      </SectionGroup>
    </div>
  )
}

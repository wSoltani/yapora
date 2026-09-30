import * as React from "react"
import { Download, RotateCcw, Upload } from "lucide-react"
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
import { useProfileStore } from "@/store/profile"

export function ProfileSection() {
  const profile = useProfileStore((s) => s.profile)
  const setName = useProfileStore((s) => s.setName)
  const replace = useProfileStore((s) => s.replace)
  const reset = useProfileStore((s) => s.reset)

  const inputRef = React.useRef<HTMLInputElement>(null)

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
          OBS always shows what's saved here, so there's nothing to copy across.
          Export to back up your look &mdash; settings and image in one file
          &mdash; or move it to another machine.
        </p>
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

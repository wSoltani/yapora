import * as React from "react"
import {
  Check,
  Copy,
  Download,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react"
import { cn } from "@/lib/utils"
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
  const profiles = useProfileStore((s) => s.profiles)
  const switchTo = useProfileStore((s) => s.switchTo)
  const profileCount = profiles.length
  const add = useProfileStore((s) => s.add)
  const createBlank = useProfileStore((s) => s.createBlank)
  const duplicate = useProfileStore((s) => s.duplicate)
  const remove = useProfileStore((s) => s.remove)
  const reset = useProfileStore((s) => s.reset)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)

  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    const bundle = await exportProfile(profile)
    downloadProfile(bundle, profile.name || "yapora")
    toast.success("Profile exported")
  }

  const handleImport = async (file: File) => {
    try {
      const imported = await importProfile(await file.text())
      await add(imported)
      toast.success(`Imported "${imported.name}" as a new profile`)
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
      <SectionGroup title="Profiles">
        <div className="flex flex-col gap-0.5 rounded-lg border border-border p-1">
          {profiles.map((p) => {
            const active = p.id === profile.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => void switchTo(p.id)}
                aria-current={active}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                  active && "bg-accent font-medium"
                )}
              >
                <span className="truncate">{p.name}</span>
                {active && (
                  <Check className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            )
          })}
        </div>

        <Field label="Name">
          <Input
            value={profile.name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 text-xs"
          />
        </Field>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void createBlank()}
          >
            <Plus />
            New
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void duplicate()}
          >
            <Copy />
            Duplicate
          </Button>
          {confirmingDelete ? (
            <Button
              variant="destructive"
              size="sm"
              className="flex-1"
              // Focused on appear, so clicking anywhere else cancels.
              autoFocus
              onBlur={() => setConfirmingDelete(false)}
              onClick={() => {
                setConfirmingDelete(false)
                void remove(profile.id).then(() =>
                  toast.success(`Deleted "${profile.name}"`)
                )
              }}
            >
              Confirm
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={profileCount < 2}
              onClick={() => setConfirmingDelete(true)}
              aria-label="Delete profile"
            >
              <Trash2 />
            </Button>
          )}
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          New, Duplicate and Delete act on the selected profile. OBS always
          shows the selected one.
        </p>
      </SectionGroup>

      <Separator />

      <SectionGroup title="Share">
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
          Export saves this profile &mdash; settings and image &mdash; as one
          file, to back it up or move it to another machine. Importing adds it
          as a new profile. Your microphone choice isn&apos;t included.
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

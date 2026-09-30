import * as React from "react"
import { Crop, ImageUp, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { CropDialog } from "@/edit/CropDialog"
import { ColorField, SectionGroup, SliderField } from "@/edit/controls"
import { readImageSize } from "@/edit/profileIO"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"
import { deleteImage, putImage } from "@/store/storage"
import { STAGE_SIZE } from "@/store/schema"

/** Largest centred square of the source, so a fresh upload renders immediately. */
function centeredSquare(width: number, height: number) {
  const size = Math.min(width, height)
  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    width: size,
    height: size,
  }
}

export function AvatarSection() {
  const avatar = useProfileStore((s) => s.profile.avatar)
  const setAvatar = useProfileStore((s) => s.setAvatar)
  const avatarUrl = useAppStore((s) => s.avatarUrl)

  const inputRef = React.useRef<HTMLInputElement>(null)
  const [cropOpen, setCropOpen] = React.useState(false)

  const handleFile = async (file: File) => {
    try {
      const natural = await readImageSize(file)
      const previous = avatar.imageKey
      const key = await putImage(file)

      setAvatar({
        imageKey: key,
        natural,
        cropRect: centeredSquare(natural.width, natural.height),
        editor: { crop: { x: 0, y: 0 }, zoom: 1 },
      })

      if (previous) void deleteImage(previous)
      setCropOpen(true)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load that image."
      )
    }
  }

  const handleRemove = () => {
    if (avatar.imageKey) void deleteImage(avatar.imageKey)
    setAvatar({ imageKey: null, natural: null, cropRect: null })
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionGroup title="Image">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
            event.target.value = ""
          }}
        />

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => inputRef.current?.click()}
          >
            <ImageUp />
            {avatar.imageKey ? "Replace" : "Upload"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!avatar.imageKey}
            onClick={() => setCropOpen(true)}
          >
            <Crop />
            Crop
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!avatar.imageKey}
            onClick={handleRemove}
            aria-label="Remove avatar"
          >
            <Trash2 />
          </Button>
        </div>

        {avatar.natural && (
          <p className="font-mono text-[10px] text-muted-foreground">
            {avatar.natural.width} × {avatar.natural.height} source
          </p>
        )}
      </SectionGroup>

      <Separator />

      <SectionGroup title="Placement">
        <SliderField
          label="Size"
          value={avatar.radius}
          onChange={(radius) => setAvatar({ radius })}
          min={50}
          max={440}
        />
        <SliderField
          label="Horizontal"
          value={avatar.center.x}
          onChange={(x) => setAvatar({ center: { ...avatar.center, x } })}
          min={0}
          max={STAGE_SIZE}
        />
        <SliderField
          label="Vertical"
          value={avatar.center.y}
          onChange={(y) => setAvatar({ center: { ...avatar.center, y } })}
          min={0}
          max={STAGE_SIZE}
        />
      </SectionGroup>

      <Separator />

      <SectionGroup title="Border">
        <SliderField
          label="Thickness"
          value={avatar.ringWidth}
          onChange={(ringWidth) => setAvatar({ ringWidth })}
          min={0}
          max={40}
        />
        {avatar.ringWidth > 0 && (
          <ColorField
            label="Colour"
            value={avatar.ringColor}
            onChange={(ringColor) => setAvatar({ ringColor })}
          />
        )}
      </SectionGroup>

      {avatarUrl && (
        <CropDialog
          open={cropOpen}
          onOpenChange={setCropOpen}
          url={avatarUrl}
          editor={avatar.editor}
          onApply={(editor, cropRect) => setAvatar({ editor, cropRect })}
        />
      )}
    </div>
  )
}

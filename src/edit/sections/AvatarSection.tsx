import * as React from "react"
import {
  Circle,
  Crop,
  ImageUp,
  RectangleHorizontal,
  Square,
  Trash2,
  Triangle,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CropDialog } from "@/edit/CropDialog"
import { ColorField, SectionGroup, SliderField } from "@/edit/controls"
import { readImageSize } from "@/edit/profileIO"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"
import { putImage } from "@/store/storage"
import { avatarBox } from "@/stage/shape"
import { AvatarShape, STAGE_SIZE } from "@/store/schema"

const SHAPES = [
  { value: "circle", label: "Circle", icon: Circle },
  { value: "square", label: "Square", icon: Square },
  { value: "rectangle", label: "Rectangle", icon: RectangleHorizontal },
  { value: "triangle", label: "Triangle", icon: Triangle },
] as const

/**
 * Largest centred crop of the source at the shape's proportions, so a fresh
 * upload renders immediately.
 */
function centeredCrop(width: number, height: number, aspect: number) {
  const cropWidth = Math.min(width, height * aspect)
  const cropHeight = cropWidth / aspect
  return {
    x: Math.round((width - cropWidth) / 2),
    y: Math.round((height - cropHeight) / 2),
    width: Math.round(cropWidth),
    height: Math.round(cropHeight),
  }
}

export function AvatarSection() {
  const avatar = useProfileStore((s) => s.profile.avatar)
  const setAvatar = useProfileStore((s) => s.setAvatar)
  const avatarUrl = useAppStore((s) => s.avatarUrl)

  const inputRef = React.useRef<HTMLInputElement>(null)
  const [cropOpen, setCropOpen] = React.useState(false)

  const box = avatarBox(avatar)
  const locked = avatar.shape === "circle" || avatar.shape === "square"

  const handleFile = async (file: File) => {
    try {
      const natural = await readImageSize(file)
      const key = await putImage(file)

      setAvatar({
        imageKey: key,
        natural,
        cropRect: centeredCrop(
          natural.width,
          natural.height,
          box.width / box.height
        ),
        editor: { crop: { x: 0, y: 0 }, zoom: 1 },
      })

      setCropOpen(true)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load that image."
      )
    }
  }

  const handleRemove = () => {
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

      <SectionGroup title="Shape">
        <ToggleGroup
          value={[avatar.shape]}
          onValueChange={(value) => {
            const parsed = AvatarShape.safeParse(value[0])
            if (parsed.success) setAvatar({ shape: parsed.data })
          }}
          className="w-full"
        >
          {SHAPES.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={label}
              className="flex-1"
            >
              <Icon />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {locked ? (
          <SliderField
            label="Size"
            value={avatar.width}
            onChange={(width) => setAvatar({ width })}
            min={100}
            max={960}
          />
        ) : (
          <>
            <SliderField
              label="Width"
              value={avatar.width}
              onChange={(width) => setAvatar({ width })}
              min={100}
              max={960}
            />
            <SliderField
              label="Height"
              value={avatar.height}
              onChange={(height) => setAvatar({ height })}
              min={100}
              max={960}
            />
          </>
        )}

        {avatar.shape !== "circle" && (
          <SliderField
            label="Corner radius"
            value={avatar.cornerRadius}
            onChange={(cornerRadius) => setAvatar({ cornerRadius })}
            min={0}
            max={1}
            step={0.01}
            precision={2}
          />
        )}

        {avatar.imageKey && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Changing proportions trims the image to fit. Crop again to reframe
            it for the new shape.
          </p>
        )}
      </SectionGroup>

      <Separator />

      <SectionGroup title="Placement">
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
          avatar={avatar}
          editor={avatar.editor}
          onApply={(editor, cropRect) => setAvatar({ editor, cropRect })}
        />
      )}
    </div>
  )
}

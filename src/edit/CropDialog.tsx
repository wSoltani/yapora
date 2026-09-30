import * as React from "react"
import Cropper, { type Area, type Point } from "react-easy-crop"
import "react-easy-crop/react-easy-crop.css"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { avatarBox, ShapeOutline } from "@/stage/shape"
import type { AvatarConfig } from "@/store/schema"

interface CropDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  /** The frame is cut to this avatar's shape and proportions. */
  avatar: AvatarConfig
  editor: AvatarConfig["editor"]
  onApply: (
    editor: AvatarConfig["editor"],
    cropRect: NonNullable<AvatarConfig["cropRect"]>
  ) => void
}

export function CropDialog({ open, onOpenChange, ...rest }: CropDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        The editor's state is seeded from props on mount, so rendering the body
        only while open means reopening always restores the saved framing
        without an effect syncing props into state.
      */}
      {open && <CropDialogBody onOpenChange={onOpenChange} {...rest} />}
    </Dialog>
  )
}

function CropDialogBody({
  onOpenChange,
  url,
  avatar,
  editor,
  onApply,
}: Omit<CropDialogProps, "open">) {
  const [crop, setCrop] = React.useState<Point>(editor.crop)
  const [zoom, setZoom] = React.useState(editor.zoom)
  const [frame, setFrame] = React.useState<{ width: number; height: number }>()
  const areaRef = React.useRef<Area | null>(null)

  const box = avatarBox(avatar)
  const round = avatar.shape === "circle"

  const handleApply = () => {
    const area = areaRef.current
    if (!area) return

    onApply(
      { crop, zoom },
      {
        x: Math.max(0, Math.round(area.x)),
        y: Math.max(0, Math.round(area.y)),
        width: Math.max(1, Math.round(area.width)),
        height: Math.max(1, Math.round(area.height)),
      }
    )
    onOpenChange(false)
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Frame your avatar</DialogTitle>
        <DialogDescription>
          Drag to pan, scroll or use the slider to zoom. The outlined shape is
          exactly what will be shown.
        </DialogDescription>
      </DialogHeader>

      <div className="relative h-72 w-full overflow-hidden rounded-md bg-neutral-900">
        <Cropper
          image={url}
          crop={crop}
          zoom={zoom}
          aspect={box.width / box.height}
          cropShape={round ? "round" : "rect"}
          onCropSizeChange={setFrame}
          showGrid={false}
          restrictPosition
          onCropChange={setCrop}
          onZoomChange={setZoom}
          /*
           * croppedAreaPixels is a rectangle in the source image's own
           * pixels, which is exactly what the stage consumes as a viewBox.
           * Nothing is ever resampled: the crop stays lossless and editable.
           */
          onCropComplete={(_area, areaPixels) => {
            areaRef.current = areaPixels
          }}
        />
        {!round && frame && <ShapeMask avatar={avatar} frame={frame} />}
      </div>

      <div className="flex items-center gap-3 px-1">
        <span className="text-xs text-muted-foreground">Zoom</span>
        <Slider
          value={zoom}
          min={1}
          max={5}
          step={0.01}
          onValueChange={(next) =>
            setZoom(Array.isArray(next) ? next[0] : next)
          }
        />
        <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">
          {zoom.toFixed(2)}×
        </span>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleApply}>Apply</Button>
      </DialogFooter>
    </DialogContent>
  )
}

/**
 * The cropper only knows rectangles and circles, so other shapes are drawn on
 * top of its rectangular frame: everything outside the shape is dimmed, the
 * same way the cropper dims everything outside the frame.
 */
function ShapeMask({
  avatar,
  frame,
}: {
  avatar: AvatarConfig
  frame: { width: number; height: number }
}) {
  const outline = new ShapeOutline(
    avatar.shape,
    { cx: frame.width / 2, cy: frame.height / 2, ...frame },
    avatar.cornerRadius
  )
  const shape = outline.path()

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <svg
        width={frame.width}
        height={frame.height}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        overflow="visible"
      >
        <path
          d={`M0 0H${frame.width}V${frame.height}H0Z${shape}`}
          fill="black"
          fillOpacity={0.5}
          fillRule="evenodd"
        />
        <path
          d={shape}
          fill="none"
          stroke="white"
          strokeOpacity={0.8}
          strokeDasharray="4 4"
        />
      </svg>
    </div>
  )
}

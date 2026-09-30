import { Move } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ColorField,
  Field,
  NumberField,
  SectionGroup,
  SliderField,
  SwitchField,
} from "@/edit/controls"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"
import { STAGE_SIZE } from "@/store/schema"

export function MouthSection() {
  const mouth = useProfileStore((s) => s.profile.mouth)
  const setMouth = useProfileStore((s) => s.setMouth)
  const selection = useAppStore((s) => s.selection)
  const setSelection = useAppStore((s) => s.setSelection)

  return (
    <div className="flex flex-col gap-5">
      <SwitchField
        label="Show mouth"
        checked={mouth.enabled}
        onChange={(enabled) => setMouth({ enabled })}
      />

      <Separator />

      <SectionGroup title="Position">
        <Button
          variant={selection === "mouth" ? "default" : "outline"}
          size="sm"
          onClick={() => setSelection(selection === "mouth" ? null : "mouth")}
        >
          <Move />
          {selection === "mouth" ? "Done positioning" : "Drag on canvas"}
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={mouth.center.x}
            onChange={(x) => setMouth({ center: { ...mouth.center, x } })}
            min={0}
            max={STAGE_SIZE}
          />
          <NumberField
            label="Y"
            value={mouth.center.y}
            onChange={(y) => setMouth({ center: { ...mouth.center, y } })}
            min={0}
            max={STAGE_SIZE}
          />
          <NumberField
            label="Width"
            value={mouth.width}
            onChange={(width) => setMouth({ width })}
            min={20}
            max={STAGE_SIZE}
          />
          <NumberField
            label="Height"
            value={mouth.height}
            onChange={(height) => setMouth({ height })}
            min={10}
            max={STAGE_SIZE}
          />
        </div>
      </SectionGroup>

      <Separator />

      <SectionGroup title="Bars">
        <SliderField
          label="Count"
          value={mouth.barCount}
          onChange={(barCount) => setMouth({ barCount })}
          min={3}
          max={96}
        />
        <SliderField
          label="Spacing"
          value={mouth.gapRatio}
          onChange={(gapRatio) => setMouth({ gapRatio })}
          min={0}
          max={0.9}
          step={0.01}
          precision={2}
        />
        <SliderField
          label="Cap rounding"
          value={mouth.capRadius}
          onChange={(capRadius) => setMouth({ capRadius })}
          min={0}
          max={1}
          step={0.01}
          precision={2}
        />
        <SliderField
          label="Resting height"
          value={mouth.minHeight}
          onChange={(minHeight) => setMouth({ minHeight })}
          min={0}
          max={0.5}
          step={0.01}
          precision={2}
        />

        <Field label="Grows from">
          <ToggleGroup
            value={[mouth.symmetry]}
            onValueChange={(value) => {
              const next = value[0]
              if (next === "mirror" || next === "baseline") {
                setMouth({ symmetry: next })
              }
            }}
            className="w-full"
          >
            <ToggleGroupItem value="mirror" className="flex-1 text-xs">
              Centre
            </ToggleGroupItem>
            <ToggleGroupItem value="baseline" className="flex-1 text-xs">
              Baseline
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <SwitchField
          label="Mirror spectrum"
          description="Low frequencies in the middle, fanning out symmetrically."
          checked={mouth.mirrorSpectrum}
          onChange={(mirrorSpectrum) => setMouth({ mirrorSpectrum })}
        />
      </SectionGroup>

      <Separator />

      <SectionGroup title="Appearance">
        <ColorField
          label="Colour"
          value={mouth.color}
          onChange={(color) => setMouth({ color })}
        />
        <SliderField
          label="Opacity"
          value={mouth.opacity}
          onChange={(opacity) => setMouth({ opacity })}
          min={0}
          max={1}
          step={0.01}
          precision={2}
        />
      </SectionGroup>

      <Separator />

      <SectionGroup title="Backdrop">
        <SwitchField
          label="Show backdrop"
          description="Keeps the bars legible over a busy part of the avatar."
          checked={mouth.backdrop.enabled}
          onChange={(enabled) =>
            setMouth({ backdrop: { ...mouth.backdrop, enabled } })
          }
        />

        {mouth.backdrop.enabled && (
          <>
            <ColorField
              label="Colour"
              value={mouth.backdrop.color}
              onChange={(color) =>
                setMouth({ backdrop: { ...mouth.backdrop, color } })
              }
            />
            <SliderField
              label="Dimming"
              value={mouth.backdrop.opacity}
              onChange={(opacity) =>
                setMouth({ backdrop: { ...mouth.backdrop, opacity } })
              }
              min={0}
              max={1}
              step={0.01}
              precision={2}
            />
            <SliderField
              label="Padding"
              value={mouth.backdrop.padding}
              onChange={(padding) =>
                setMouth({ backdrop: { ...mouth.backdrop, padding } })
              }
              min={0}
              max={120}
            />
            <SliderField
              label="Corner radius"
              value={mouth.backdrop.radius}
              onChange={(radius) =>
                setMouth({ backdrop: { ...mouth.backdrop, radius } })
              }
              min={0}
              max={1}
              step={0.01}
              precision={2}
            />
            <SliderField
              label="Edge softness"
              value={mouth.backdrop.feather}
              onChange={(feather) =>
                setMouth({ backdrop: { ...mouth.backdrop, feather } })
              }
              min={0}
              max={1}
              step={0.01}
              precision={2}
            />
          </>
        )}
      </SectionGroup>
    </div>
  )
}

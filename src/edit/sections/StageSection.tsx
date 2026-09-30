import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ColorField,
  Field,
  SectionGroup,
  SliderField,
  SwitchField,
} from "@/edit/controls"
import { useProfileStore } from "@/store/profile"
import { BackgroundMode } from "@/store/schema"

type FpsOption = "off" | "30" | "60"

export function StageSection() {
  const stage = useProfileStore((s) => s.profile.stage)
  const ui = useProfileStore((s) => s.profile.ui)
  const setStage = useProfileStore((s) => s.setStage)
  const setUi = useProfileStore((s) => s.setUi)

  return (
    <div className="flex flex-col gap-5">
      <SectionGroup title="Background">
        <Field
          label="Mode"
          hint={stage.background === "transparent" ? "OBS-ready" : undefined}
        >
          <ToggleGroup
            value={[stage.background]}
            onValueChange={(value) => {
              const parsed = BackgroundMode.safeParse(value[0])
              if (parsed.success) setStage({ background: parsed.data })
            }}
            className="w-full"
          >
            <ToggleGroupItem value="transparent" className="flex-1 text-[11px]">
              None
            </ToggleGroupItem>
            <ToggleGroupItem value="black" className="flex-1 text-[11px]">
              Black
            </ToggleGroupItem>
            <ToggleGroupItem value="green" className="flex-1 text-[11px]">
              Green
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" className="flex-1 text-[11px]">
              Custom
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        {stage.background === "custom" && (
          <ColorField
            label="Colour"
            value={stage.customColor}
            onChange={(customColor) => setStage({ customColor })}
          />
        )}

        {stage.background === "transparent" && (
          <SwitchField
            label="Checkerboard"
            description="Edit mode only — never rendered in Live."
            checked={ui.showCheckerboard}
            onChange={(showCheckerboard) => setUi({ showCheckerboard })}
          />
        )}
      </SectionGroup>

      <Separator />

      <SectionGroup title="Composition">
        <SliderField
          label="Overall scale"
          value={stage.scale}
          onChange={(scale) => setStage({ scale })}
          min={0.2}
          max={2}
          step={0.01}
          precision={2}
          unit="×"
        />
      </SectionGroup>

      <Separator />

      <SectionGroup title="Avatar motion">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Voice-driven movement of the avatar itself. All off by default.
        </p>
        <SliderField
          label="Bounce"
          value={stage.motion.bounce}
          onChange={(bounce) =>
            setStage({ motion: { ...stage.motion, bounce } })
          }
          min={0}
          max={100}
        />
        <SliderField
          label="Sway"
          value={stage.motion.tilt}
          onChange={(tilt) => setStage({ motion: { ...stage.motion, tilt } })}
          min={0}
          max={30}
          unit="°"
        />
        <SliderField
          label="Pop"
          value={stage.motion.pop}
          onChange={(pop) => setStage({ motion: { ...stage.motion, pop } })}
          min={0}
          max={0.5}
          step={0.01}
          precision={2}
        />
      </SectionGroup>

      <Separator />

      <SectionGroup title="Performance">
        <Field
          label="Frame cap"
          hint={ui.fpsCap ? `${ui.fpsCap} fps` : "uncapped"}
        >
          <ToggleGroup
            value={[ui.fpsCap ? String(ui.fpsCap) : "off"]}
            onValueChange={(value) => {
              const next = value[0] as FpsOption | undefined
              if (!next) return
              setUi({ fpsCap: next === "off" ? null : Number(next) })
            }}
            className="w-full"
          >
            <ToggleGroupItem value="off" className="flex-1 text-[11px]">
              Uncapped
            </ToggleGroupItem>
            <ToggleGroupItem value="60" className="flex-1 text-[11px]">
              60
            </ToggleGroupItem>
            <ToggleGroupItem value="30" className="flex-1 text-[11px]">
              30
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Rendering follows your display's refresh rate. Cap it if OBS only
          captures at 60fps and you want the headroom back.
        </p>
      </SectionGroup>

      <Separator />

      <SectionGroup title="Live mode">
        <SwitchField
          label="Show error badge"
          description="Warns you if the mic fails inside OBS, instead of a silent avatar."
          checked={ui.showErrorBadge}
          onChange={(showErrorBadge) => setUi({ showErrorBadge })}
        />
      </SectionGroup>
    </div>
  )
}

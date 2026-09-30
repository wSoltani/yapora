import { Separator } from "@/components/ui/separator"
import {
  ColorField,
  SectionGroup,
  SliderField,
  SwitchField,
} from "@/edit/controls"
import { useProfileStore } from "@/store/profile"

export function HaloSection() {
  const halo = useProfileStore((s) => s.profile.halo)
  const setHalo = useProfileStore((s) => s.setHalo)

  return (
    <div className="flex flex-col gap-5">
      <SwitchField
        label="Show halo"
        checked={halo.enabled}
        onChange={(enabled) => setHalo({ enabled })}
      />

      <Separator />

      <SectionGroup title="Shape">
        <SliderField
          label="Gap from avatar"
          value={halo.gap}
          onChange={(gap) => setHalo({ gap })}
          min={0}
          max={200}
        />
        <SliderField
          label="Thickness"
          value={halo.thickness}
          onChange={(thickness) => setHalo({ thickness })}
          min={1}
          max={80}
        />
      </SectionGroup>

      <Separator />

      <SectionGroup title="Reaction">
        <SliderField
          label="Amount"
          value={halo.reactivity}
          onChange={(reactivity) => setHalo({ reactivity })}
          min={0}
          max={200}
        />
        <SliderField
          label="Resting size"
          value={halo.floor}
          onChange={(floor) => setHalo({ floor })}
          min={0}
          max={1}
          step={0.01}
          precision={2}
        />
        <SliderField
          label="Resting opacity"
          value={halo.opacityMin}
          onChange={(opacityMin) =>
            setHalo({
              opacityMin,
              opacityMax: Math.max(opacityMin, halo.opacityMax),
            })
          }
          min={0}
          max={1}
          step={0.01}
          precision={2}
        />
        <SliderField
          label="Peak opacity"
          value={halo.opacityMax}
          onChange={(opacityMax) =>
            setHalo({
              opacityMax,
              opacityMin: Math.min(opacityMax, halo.opacityMin),
            })
          }
          min={0}
          max={1}
          step={0.01}
          precision={2}
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          The ring fades between these as you speak. Set them equal for a
          constant opacity.
        </p>
      </SectionGroup>

      <Separator />

      <SectionGroup title="Appearance">
        <ColorField
          label="Colour"
          value={halo.color}
          onChange={(color) => setHalo({ color })}
        />
        <SliderField
          label="Glow"
          value={halo.glow}
          onChange={(glow) => setHalo({ glow })}
          min={0}
          max={40}
        />
      </SectionGroup>
    </div>
  )
}

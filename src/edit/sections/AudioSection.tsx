import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field, SectionGroup, SliderField, SwitchField } from "@/edit/controls"
import { LevelMeter } from "@/edit/LevelMeter"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"

const FFT_SIZES = [512, 1024, 2048, 4096] as const

export function AudioSection() {
  const audio = useProfileStore((s) => s.profile.audio)
  const setAudio = useProfileStore((s) => s.setAudio)
  const devices = useAppStore((s) => s.devices)
  const micDevice = useAppStore((s) => s.micDevice)
  const setMicDevice = useAppStore((s) => s.setMicDevice)
  const synthetic = useAppStore((s) => s.synthetic)
  const setSynthetic = useAppStore((s) => s.setSynthetic)
  const micStatus = useAppStore((s) => s.micStatus)
  const micError = useAppStore((s) => s.micError)

  const failed =
    micStatus === "denied" || micStatus === "error" || micStatus === "offline"

  return (
    <div className="flex flex-col gap-5">
      <LevelMeter gateThreshold={audio.gateThreshold} ceiling={audio.ceiling} />

      {failed && (
        <div className="rounded-md bg-destructive/10 p-2.5 text-[10px] leading-relaxed text-destructive">
          Microphone status: <strong>{micStatus}</strong>
          {micError && (
            <span className="mt-1 block opacity-90">{micError}</span>
          )}
        </div>
      )}

      <Separator />

      <SectionGroup title="Input">
        <Field label="Microphone">
          <Select
            value={micDevice ?? "default"}
            onValueChange={(value) =>
              setMicDevice(value === "default" ? null : String(value))
            }
            items={[
              { label: "System default", value: "default" },
              ...devices.map((device) => ({
                label: device.label,
                value: device.deviceId,
              })),
            ]}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">System default</SelectItem>
              {devices
                .filter((device) => device.deviceId !== "default")
                .map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>

        <SliderField
          label="Gain"
          value={audio.gain}
          onChange={(gain) => setAudio({ gain })}
          min={-24}
          max={24}
          unit=" dB"
        />

        <SwitchField
          label="Test signal"
          description="Speech-shaped tone instead of the mic, for tuning without talking."
          checked={synthetic}
          onChange={setSynthetic}
        />
      </SectionGroup>

      <Separator />

      <SectionGroup title="Sensitivity">
        <SliderField
          label="Noise gate"
          value={audio.gateThreshold}
          onChange={(gateThreshold) => setAudio({ gateThreshold })}
          min={-90}
          max={0}
          unit=" dB"
        />
        <SliderField
          label="Ceiling"
          value={audio.ceiling}
          onChange={(ceiling) => setAudio({ ceiling })}
          min={-60}
          max={0}
          unit=" dB"
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Set the gate just above where the meter sits when you're silent, and
          the ceiling near your normal speaking peaks.
        </p>
      </SectionGroup>

      <Separator />

      <SectionGroup title="Response">
        <SliderField
          label="Halo attack"
          value={audio.attackMs}
          onChange={(attackMs) => setAudio({ attackMs })}
          min={0}
          max={500}
          unit=" ms"
        />
        <SliderField
          label="Halo release"
          value={audio.releaseMs}
          onChange={(releaseMs) => setAudio({ releaseMs })}
          min={0}
          max={2000}
          unit=" ms"
        />
        <SliderField
          label="Mouth attack"
          value={audio.barAttackMs}
          onChange={(barAttackMs) => setAudio({ barAttackMs })}
          min={0}
          max={500}
          unit=" ms"
        />
        <SliderField
          label="Mouth release"
          value={audio.barReleaseMs}
          onChange={(barReleaseMs) => setAudio({ barReleaseMs })}
          min={0}
          max={2000}
          unit=" ms"
        />
      </SectionGroup>

      <Separator />

      <SectionGroup title="Spectrum">
        <SliderField
          label="Low cut"
          value={audio.freqMin}
          onChange={(freqMin) => setAudio({ freqMin })}
          min={20}
          max={2000}
          unit=" Hz"
        />
        <SliderField
          label="High cut"
          value={audio.freqMax}
          onChange={(freqMax) => setAudio({ freqMax })}
          min={1000}
          max={20000}
          unit=" Hz"
        />
        <SliderField
          label="High-frequency lift"
          value={audio.tilt}
          onChange={(tilt) => setAudio({ tilt })}
          min={0}
          max={1}
          step={0.01}
          precision={2}
        />
        <SliderField
          label="Smoothing"
          value={audio.smoothing}
          onChange={(smoothing) => setAudio({ smoothing })}
          min={0}
          max={0.95}
          step={0.01}
          precision={2}
        />

        <Field label="FFT size" hint="detail vs. latency">
          <Select
            value={String(audio.fftSize)}
            onValueChange={(value) =>
              setAudio({
                fftSize: Number(value) as (typeof FFT_SIZES)[number],
              })
            }
            items={FFT_SIZES.map((size) => ({
              label: String(size),
              value: String(size),
            }))}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FFT_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </SectionGroup>
    </div>
  )
}

import * as React from "react"
import { AudioWaveform, FileAudio, Mic } from "lucide-react"
import { toast } from "sonner"

import { chooseAudioFile, formatTime } from "@/audio/player"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Field, SectionGroup, SliderField } from "@/edit/controls"
import { LevelMeter } from "@/edit/LevelMeter"
import { useAppStore, type AudioSource, type MicDevice } from "@/store/app"
import { useProfileStore } from "@/store/profile"

const FFT_SIZES = [512, 1024, 2048, 4096] as const

const SOURCES = [
  { value: "mic", label: "Microphone", icon: Mic },
  { value: "test", label: "Test signal", icon: AudioWaveform },
  { value: "file", label: "Audio file", icon: FileAudio },
] as const

function FileSource() {
  const track = useAppStore((s) => s.track)
  const setTrack = useAppStore((s) => s.setTrack)
  const outputDevices = useAppStore((s) => s.outputDevices)
  const outputDevice = useAppStore((s) => s.outputDevice)
  const setOutputDevice = useAppStore((s) => s.setOutputDevice)
  const [loading, setLoading] = React.useState(false)

  const choose = async () => {
    setLoading(true)
    try {
      const loaded = await chooseAudioFile()
      if (loaded) setTrack(loaded)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {track && (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-medium">{track.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {formatTime(track.duration)}
          </span>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={() => void choose()}
      >
        <FileAudio />
        {loading
          ? "Loading…"
          : track
            ? "Choose another file"
            : "Choose audio file"}
      </Button>
      <DeviceSelect
        label="Playback device"
        devices={outputDevices}
        value={outputDevice}
        onChange={setOutputDevice}
      />
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Plays through the device above and drives the avatar as if you were
        talking. Use the player on the stage to play, pause and scrub. To bring
        the sound into OBS, play it to a virtual cable and capture that.
      </p>
    </div>
  )
}

/** A device picker whose first entry follows the system default. */
function DeviceSelect({
  label,
  devices,
  value,
  onChange,
}: {
  label: string
  devices: MicDevice[]
  value: string | null
  onChange: (deviceId: string | null) => void
}) {
  return (
    <Field label={label}>
      <Select
        value={value ?? "default"}
        onValueChange={(next) =>
          onChange(next === "default" ? null : String(next))
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
  )
}

export function AudioSection() {
  const audio = useProfileStore((s) => s.profile.audio)
  const setAudio = useProfileStore((s) => s.setAudio)
  const devices = useAppStore((s) => s.devices)
  const micDevice = useAppStore((s) => s.micDevice)
  const setMicDevice = useAppStore((s) => s.setMicDevice)
  const source = useAppStore((s) => s.source)
  const setSource = useAppStore((s) => s.setSource)
  const micStatus = useAppStore((s) => s.micStatus)
  const micError = useAppStore((s) => s.micError)

  const failed =
    micStatus === "denied" || micStatus === "error" || micStatus === "offline"

  return (
    <div className="flex flex-col gap-5">
      <LevelMeter gateThreshold={audio.gateThreshold} ceiling={audio.ceiling} />

      {failed && (
        <div className="rounded-md bg-destructive/10 p-2.5 text-[10px] leading-relaxed text-destructive">
          Audio status: <strong>{micStatus}</strong>
          {micError && (
            <span className="mt-1 block whitespace-pre-line opacity-90">
              {micError}
            </span>
          )}
        </div>
      )}

      <Separator />

      <SectionGroup title="Source">
        <ToggleGroup
          value={[source]}
          onValueChange={(value) => {
            const next = value[0] as AudioSource | undefined
            if (next) setSource(next)
          }}
          className="w-full"
        >
          {SOURCES.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="flex-1 gap-1 text-[11px]"
            >
              <Icon />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {source === "test" && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            A speech-shaped tone, for tuning the look without talking.
          </p>
        )}

        {source === "file" && <FileSource />}

        {source === "mic" && (
          <DeviceSelect
            label="Microphone"
            devices={devices}
            value={micDevice ?? null}
            onChange={setMicDevice}
          />
        )}

        <SliderField
          label="Gain"
          value={audio.gain}
          onChange={(gain) => setAudio({ gain })}
          min={-24}
          max={24}
          unit=" dB"
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

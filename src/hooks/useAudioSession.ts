import * as React from "react"

import { audioEngine } from "@/audio/AudioEngine"
import { listMicDevices, onDeviceChange } from "@/audio/devices"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"

/**
 * Owns the audio session lifecycle: starts the engine, keeps it in sync with
 * settings, mirrors its status into the app store, and keeps the device list
 * current.
 */
export function useAudioSession(enabled: boolean) {
  const audio = useProfileStore((s) => s.profile.audio)
  const loaded = useProfileStore((s) => s.loaded)
  const synthetic = useAppStore((s) => s.synthetic)
  const setMicStatus = useAppStore((s) => s.setMicStatus)
  const setDevices = useAppStore((s) => s.setDevices)

  React.useEffect(() => {
    return audioEngine.subscribe((status, error) => {
      setMicStatus(status, error)
    })
  }, [setMicStatus])

  // Restarting the stream is only necessary when the source itself changes.
  // Every other setting is applied in place.
  const deviceId = audio.deviceId

  React.useEffect(() => {
    if (!enabled || !loaded) return
    void audioEngine.start(useProfileStore.getState().profile.audio, synthetic)
  }, [enabled, loaded, synthetic, deviceId])

  React.useEffect(() => {
    if (!enabled) return
    audioEngine.applyConfig(audio)
  }, [enabled, audio])

  React.useEffect(() => {
    if (!enabled) return
    const refresh = () => void listMicDevices().then(setDevices)
    refresh()
    return onDeviceChange(refresh)
  }, [enabled, setDevices])

  React.useEffect(() => {
    return () => {
      audioEngine.stop()
    }
  }, [])
}

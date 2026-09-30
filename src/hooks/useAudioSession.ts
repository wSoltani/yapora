import * as React from "react"

import { audioEngine } from "@/audio/AudioEngine"
import { listMicDevices, onDeviceChange } from "@/audio/devices"
import { loadedTrack } from "@/audio/player"
import { inApp } from "@/lib/native"
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
  const source = useAppStore((s) => s.source)
  const setTrack = useAppStore((s) => s.setTrack)
  const micDevice = useAppStore((s) => s.micDevice)
  const loadSettings = useAppStore((s) => s.loadSettings)
  const setMicStatus = useAppStore((s) => s.setMicStatus)
  const setDevices = useAppStore((s) => s.setDevices)

  React.useEffect(() => {
    return audioEngine.subscribe((status, error) => {
      setMicStatus(status, error)
    })
  }, [setMicStatus])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // The app keeps a loaded file across page reloads; pick it back up.
  React.useEffect(() => {
    if (inApp) void loadedTrack().then(setTrack)
  }, [setTrack])

  // Restarting the stream is only necessary when the source itself changes.
  // Every other setting is applied in place.
  React.useEffect(() => {
    if (!enabled || !loaded || micDevice === undefined) return
    void audioEngine.start(
      useProfileStore.getState().profile.audio,
      source,
      micDevice
    )
  }, [enabled, loaded, source, micDevice])

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

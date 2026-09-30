import * as React from "react"

import { audioEngine } from "@/audio/AudioEngine"
import { listMicDevices, onDeviceChange } from "@/audio/devices"
import { useAppStore } from "@/store/app"
import { useProfileStore } from "@/store/profile"

/**
 * Owns the audio session lifecycle: starts the engine, keeps it in sync with
 * settings, mirrors its status into the app store, and works around the
 * autoplay policy.
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
  // Every other setting is applied to the live graph in place.
  const deviceId = audio.deviceId

  React.useEffect(() => {
    if (!enabled || !loaded) return

    let cancelled = false
    void audioEngine
      .start(useProfileStore.getState().profile.audio, synthetic)
      .then(() => {
        if (cancelled) return
        // Labels are hidden until permission has been granted once, so this
        // only produces a useful device list after a successful start.
        void listMicDevices().then(setDevices)
      })

    return () => {
      cancelled = true
    }
  }, [enabled, loaded, synthetic, deviceId, setDevices])

  React.useEffect(() => {
    if (!enabled) return
    audioEngine.applyConfig(audio)
  }, [enabled, audio])

  React.useEffect(() => {
    if (!enabled) return
    return onDeviceChange(() => {
      void listMicDevices().then(setDevices)
    })
  }, [enabled, setDevices])

  /**
   * An AudioContext created without a user gesture starts suspended. The first
   * interaction unblocks it; in OBS there may never be one, so the loop also
   * retries on visibility change and this timer covers a source that was
   * hidden when it started.
   */
  React.useEffect(() => {
    if (!enabled) return

    const resume = () => void audioEngine.resume()

    window.addEventListener("pointerdown", resume)
    window.addEventListener("keydown", resume)
    const timer = setInterval(() => {
      if (audioEngine.contextState === "suspended") resume()
    }, 2000)

    return () => {
      window.removeEventListener("pointerdown", resume)
      window.removeEventListener("keydown", resume)
      clearInterval(timer)
    }
  }, [enabled])

  React.useEffect(() => {
    return () => {
      audioEngine.stop()
    }
  }, [])
}

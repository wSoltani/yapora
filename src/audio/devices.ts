import { invoke, inApp } from "@/lib/native"
import type { MicDevice } from "@/store/app"

/** Only the app can see the hardware; OBS has no device to pick. */
export async function listMicDevices(): Promise<MicDevice[]> {
  if (!inApp) return []
  try {
    return await invoke<MicDevice[]>("audio_devices")
  } catch {
    return []
  }
}

const POLL_MS = 3000

/**
 * The native audio APIs have no portable hotplug event, so the list is polled
 * instead. Enumerating a handful of devices every few seconds is negligible.
 */
export function onDeviceChange(handler: () => void): () => void {
  if (!inApp) return () => {}
  const timer = setInterval(handler, POLL_MS)
  return () => clearInterval(timer)
}

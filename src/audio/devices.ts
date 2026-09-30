import type { MicDevice } from "@/store/app"

/**
 * Device labels are empty until the user has granted mic permission at least
 * once — the browser will not reveal hardware names to an unprivileged page.
 * Falling back to a truncated id keeps the picker usable in that state.
 */
export async function listMicDevices(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []

  const devices = await navigator.mediaDevices.enumerateDevices()

  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label:
        device.label ||
        (device.deviceId === "default"
          ? "System default"
          : `Microphone ${index + 1}`),
    }))
}

export function onDeviceChange(handler: () => void): () => void {
  if (!navigator.mediaDevices) return () => {}
  navigator.mediaDevices.addEventListener("devicechange", handler)
  return () =>
    navigator.mediaDevices.removeEventListener("devicechange", handler)
}

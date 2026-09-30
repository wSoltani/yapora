import { create } from "zustand"

import type { EngineStatus } from "@/audio/AudioEngine"
import type { TrackInfo } from "@/audio/player"

import { getSettings, setMicDevice } from "./storage"

export type AppMode = "edit" | "live"

export type MicStatus = EngineStatus

/**
 * What drives the avatar: the microphone, the speech-shaped test signal (for
 * tuning without talking), or an audio file played through the speakers.
 */
export type AudioSource = "mic" | "test" | "file"

export interface MicDevice {
  deviceId: string
  label: string
}

/**
 * Ephemeral session state. Nothing here is persisted except by way of the
 * profile store.
 */
interface AppState {
  mode: AppMode
  micStatus: MicStatus
  micError: string | null
  devices: MicDevice[]
  /**
   * The chosen microphone, an app setting shared by every profile. `null` is
   * the system default; `undefined` means settings have not loaded yet, so
   * the engine waits rather than opening the wrong device first.
   */
  micDevice: string | null | undefined
  source: AudioSource
  /** The file loaded for the "file" source, if any. */
  track: TrackInfo | null
  /** Which element the edit-mode gizmo is attached to. */
  selection: "mouth" | null
  avatarUrl: string | null

  setMode: (mode: AppMode) => void
  toggleMode: () => void
  setMicStatus: (status: MicStatus, error?: string | null) => void
  setDevices: (devices: MicDevice[]) => void
  setMicDevice: (deviceId: string | null) => void
  loadSettings: () => Promise<void>
  setSource: (source: AudioSource) => void
  setTrack: (track: TrackInfo | null) => void
  setSelection: (selection: "mouth" | null) => void
  setAvatarUrl: (url: string | null) => void
}

/**
 * OBS points at `?mode=live`; the desktop browser tab stays in edit mode. Read
 * once at startup so the live source never flashes the editor chrome.
 */
function initialMode(): AppMode {
  if (typeof window === "undefined") return "edit"
  const params = new URLSearchParams(window.location.search)
  const value = params.get("mode") ?? window.location.hash.replace("#", "")
  return value === "live" ? "live" : "edit"
}

export const useAppStore = create<AppState>((set, get) => ({
  mode: initialMode(),
  micStatus: "idle",
  micError: null,
  devices: [],
  micDevice: undefined,
  source: "mic",
  track: null,
  selection: null,
  avatarUrl: null,

  setMode: (mode) => {
    set({ mode, selection: mode === "live" ? null : get().selection })
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      if (mode === "live") {
        url.searchParams.set("mode", "live")
      } else {
        url.searchParams.delete("mode")
      }
      window.history.replaceState(null, "", url)
    }
  },

  toggleMode: () => get().setMode(get().mode === "live" ? "edit" : "live"),
  setMicStatus: (micStatus, micError = null) => set({ micStatus, micError }),
  setDevices: (devices) => set({ devices }),
  setMicDevice: (micDevice) => {
    set({ micDevice })
    void setMicDevice(micDevice)
  },
  loadSettings: async () => {
    const settings = await getSettings()
    set({ micDevice: settings?.micDevice ?? null })
  },
  setSource: (source) => set({ source }),
  setTrack: (track) => set({ track }),
  setSelection: (selection) => set({ selection }),
  setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
}))

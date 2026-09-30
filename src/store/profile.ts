import { create } from "zustand"

import {
  createDefaultProfile,
  migrateProfile,
  type AudioConfig,
  type AvatarConfig,
  type HaloConfig,
  type MouthConfig,
  type Profile,
  type StageConfig,
  type UiConfig,
} from "./schema"
import { loadProfile, saveProfile } from "./storage"

/**
 * Config only. Audio levels never enter this store — a 60fps store update would
 * re-render the whole stage sixty times a second and OBS would show it.
 */
interface ProfileState {
  profile: Profile
  loaded: boolean

  load: () => Promise<void>
  replace: (profile: Profile) => void
  reset: () => void

  setAvatar: (patch: Partial<AvatarConfig>) => void
  setHalo: (patch: Partial<HaloConfig>) => void
  setMouth: (patch: Partial<MouthConfig>) => void
  setAudio: (patch: Partial<AudioConfig>) => void
  setStage: (patch: Partial<StageConfig>) => void
  setUi: (patch: Partial<UiConfig>) => void
  setName: (name: string) => void
}

let persistTimer: ReturnType<typeof setTimeout> | undefined

/** Dragging a slider fires continuously; write to disk at rest instead. */
function schedulePersist(profile: Profile) {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void saveProfile(profile)
  }, 250)
}

export const useProfileStore = create<ProfileState>((set, get) => {
  const patch = <K extends keyof Profile>(
    section: K,
    value: Partial<Profile[K]>
  ) => {
    const next = {
      ...get().profile,
      [section]: { ...(get().profile[section] as object), ...value },
    } as Profile
    set({ profile: next })
    schedulePersist(next)
  }

  return {
    profile: createDefaultProfile(),
    loaded: false,

    load: async () => {
      let stored: unknown
      try {
        stored = await loadProfile()
      } catch {
        // OBS started before the app: render defaults for now. The profile
        // arrives once the app is up and the stream announces a revision.
        stored = undefined
      }
      set({
        profile: stored ? migrateProfile(stored) : createDefaultProfile(),
        loaded: true,
      })
    },

    replace: (profile) => {
      set({ profile })
      schedulePersist(profile)
    },

    /**
     * Resets settings but keeps the uploaded image and its framing — someone
     * undoing a tuning session almost never means "and make me upload and crop
     * my avatar again".
     */
    reset: () => {
      const { avatar } = get().profile
      const fresh = createDefaultProfile()
      const next: Profile = {
        ...fresh,
        avatar: {
          ...fresh.avatar,
          imageKey: avatar.imageKey,
          natural: avatar.natural,
          cropRect: avatar.cropRect,
          editor: avatar.editor,
        },
      }
      set({ profile: next })
      schedulePersist(next)
    },

    setAvatar: (value) => patch("avatar", value),
    setHalo: (value) => patch("halo", value),
    setMouth: (value) => patch("mouth", value),
    setAudio: (value) => patch("audio", value),
    setStage: (value) => patch("stage", value),
    setUi: (value) => patch("ui", value),
    setName: (name) => {
      const next = { ...get().profile, name }
      set({ profile: next })
      schedulePersist(next)
    },
  }
})

export const selectAvatar = (s: ProfileState) => s.profile.avatar
export const selectHalo = (s: ProfileState) => s.profile.halo
export const selectMouth = (s: ProfileState) => s.profile.mouth
export const selectAudio = (s: ProfileState) => s.profile.audio
export const selectStage = (s: ProfileState) => s.profile.stage
export const selectUi = (s: ProfileState) => s.profile.ui

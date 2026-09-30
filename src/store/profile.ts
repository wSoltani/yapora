import { create } from "zustand"

import { inApp } from "@/lib/native"

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
import {
  deleteProfile,
  listProfiles,
  loadProfile,
  saveProfile,
  setActiveProfile,
  type ProfileSummary,
} from "./storage"

/**
 * Config only. Audio levels never enter this store — a 60fps store update would
 * re-render the whole stage sixty times a second and OBS would show it.
 */
interface ProfileState {
  /** The active profile, which is also what OBS renders. */
  profile: Profile
  loaded: boolean
  /** Every saved profile, for the switcher. Empty outside the app. */
  profiles: ProfileSummary[]

  load: () => Promise<void>
  replace: (profile: Profile) => void
  reset: () => void

  switchTo: (id: string) => Promise<void>
  /** Saves `profile` as a new profile and switches to it. */
  add: (profile: Profile) => Promise<void>
  createBlank: () => Promise<void>
  duplicate: () => Promise<void>
  remove: (id: string) => Promise<void>

  setAvatar: (patch: Partial<AvatarConfig>) => void
  setHalo: (patch: Partial<HaloConfig>) => void
  setMouth: (patch: Partial<MouthConfig>) => void
  setAudio: (patch: Partial<AudioConfig>) => void
  setStage: (patch: Partial<StageConfig>) => void
  setUi: (patch: Partial<UiConfig>) => void
  setName: (name: string) => void
}

let persistTimer: ReturnType<typeof setTimeout> | undefined
let pending: Profile | null = null

/** Dragging a slider fires continuously; write to disk at rest instead. */
function schedulePersist(profile: Profile) {
  clearTimeout(persistTimer)
  pending = profile
  persistTimer = setTimeout(() => void flushPersist(), 250)
}

/** Writes any debounced change now, so switching never drops the last edit. */
async function flushPersist() {
  clearTimeout(persistTimer)
  const profile = pending
  pending = null
  if (profile) await saveProfile(profile)
}

function newProfileId(): string {
  return `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** "Profile 2", "Profile 3"… — the first name not already taken. */
function nextName(base: string, taken: ProfileSummary[]): string {
  const names = new Set(taken.map((p) => p.name))
  if (!names.has(base)) return base
  for (let n = 2; ; n++) {
    if (!names.has(`${base} ${n}`)) return `${base} ${n}`
  }
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

  const refreshList = async () => {
    set({ profiles: (await listProfiles()).profiles })
  }

  return {
    profile: createDefaultProfile(),
    loaded: false,
    profiles: [],

    load: async () => {
      let stored: unknown
      try {
        stored = await loadProfile()
      } catch {
        // OBS started before the app: render defaults for now. The profile
        // arrives once the app is up and the stream announces a revision.
        stored = undefined
      }
      const profile = stored ? migrateProfile(stored) : createDefaultProfile()
      set({ profile, loaded: true })

      if (!inApp) return
      // First launch: save the defaults so there is a profile to list.
      if (!stored) await saveProfile(profile)
      await refreshList()
    },

    replace: (profile) => {
      set({ profile })
      schedulePersist(profile)
    },

    /**
     * Resets settings but keeps the profile's identity, the uploaded image and
     * its framing — someone undoing a tuning session almost never means "and
     * make me upload and crop my avatar again".
     */
    reset: () => {
      const { id, name, avatar } = get().profile
      const fresh = createDefaultProfile()
      const next: Profile = {
        ...fresh,
        id,
        name,
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

    switchTo: async (id) => {
      if (id === get().profile.id) return
      await flushPersist()
      await setActiveProfile(id)
      await get().load()
    },

    add: async (profile) => {
      await flushPersist()
      const next = { ...profile, id: newProfileId() }
      await saveProfile(next)
      await setActiveProfile(next.id)
      await get().load()
    },

    createBlank: async () => {
      const profile = createDefaultProfile()
      profile.name = nextName("New profile", get().profiles)
      await get().add(profile)
    },

    duplicate: async () => {
      const current = get().profile
      // The copy shares the image file; the app only deletes images that no
      // profile refers to any more.
      await get().add({
        ...structuredClone(current),
        name: nextName(`${current.name} copy`, get().profiles),
      })
    },

    remove: async (id) => {
      if (id === get().profile.id) {
        // Its pending edit must not resurrect the file after deletion.
        clearTimeout(persistTimer)
        pending = null
      }
      const { profiles } = await deleteProfile(id)
      if (profiles.length === 0) {
        // Never leave the editor without a profile to edit.
        const fresh = createDefaultProfile()
        fresh.id = newProfileId()
        await saveProfile(fresh)
        await setActiveProfile(fresh.id)
      }
      await get().load()
    },

    setAvatar: (value) => patch("avatar", value),
    setHalo: (value) => patch("halo", value),
    setMouth: (value) => patch("mouth", value),
    setAudio: (value) => patch("audio", value),
    setStage: (value) => patch("stage", value),
    setUi: (value) => patch("ui", value),
    setName: (name) => {
      const next = { ...get().profile, name }
      set({
        profile: next,
        profiles: get().profiles.map((p) =>
          p.id === next.id ? { ...p, name } : p
        ),
      })
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

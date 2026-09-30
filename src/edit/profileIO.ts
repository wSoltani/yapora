import { migrateProfile, PROFILE_VERSION, type Profile } from "@/store/schema"
import { getImage, putImage } from "@/store/storage"

/**
 * A profile bundle is the whole look in one file: settings plus the avatar
 * image inlined as a data URL.
 *
 * OBS reads the app's saved profile directly, so this is for backups and for
 * moving a look to another machine rather than for getting it into OBS.
 */
export interface ProfileBundle {
  kind: "yapora-profile"
  version: number
  profile: Profile
  image: string | null
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function exportProfile(profile: Profile): Promise<ProfileBundle> {
  let image: string | null = null

  if (profile.avatar.imageKey) {
    const blob = await getImage(profile.avatar.imageKey)
    if (blob) image = await blobToDataUrl(blob)
  }

  return {
    kind: "yapora-profile",
    version: PROFILE_VERSION,
    profile,
    image,
  }
}

export function downloadProfile(bundle: ProfileBundle, name: string) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${name.replace(/[^\w-]+/g, "-").toLowerCase()}.yapora.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export class ProfileImportError extends Error {}

/**
 * Parses a bundle and rehydrates its image into local storage.
 * The profile itself goes through the schema's migration path, so an older
 * export still opens rather than failing outright.
 */
export async function importProfile(text: string): Promise<Profile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ProfileImportError("That file isn't valid JSON.")
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    (parsed as ProfileBundle).kind !== "yapora-profile"
  ) {
    throw new ProfileImportError("That doesn't look like a Yapora profile.")
  }

  const bundle = parsed as ProfileBundle
  const profile = migrateProfile(bundle.profile)

  if (bundle.image) {
    try {
      const response = await fetch(bundle.image)
      const blob = await response.blob()
      const key = await putImage(blob)
      profile.avatar.imageKey = key
    } catch {
      // Keep the settings even if the image fails to decode — losing the
      // avatar is recoverable, losing an hour of tuning is not.
      profile.avatar.imageKey = null
    }
  } else {
    profile.avatar.imageKey = null
  }

  return profile
}

/** Reads the natural dimensions of an image blob without decoding it twice. */
export async function readImageSize(
  blob: Blob
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("Could not read that image."))
      image.src = url
    })
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

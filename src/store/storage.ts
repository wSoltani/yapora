import { inApp, invoke, serverBase } from "@/lib/native"

/**
 * Everything persistent lives on disk, owned by the app — one copy of the look
 * that the editor and OBS both read, rather than one per browser profile.
 *
 * The editor reads and writes through Tauri commands. OBS reads the same files
 * over the app's local server and never writes: an overlay has no business
 * changing the settings it renders.
 */

export async function loadProfile(): Promise<unknown> {
  if (inApp) return invoke<unknown>("get_profile")

  const response = await fetch(`${serverBase}/api/profile`)
  if (response.status === 404) return undefined
  if (!response.ok)
    throw new Error(`Profile request failed: ${response.status}`)
  return response.json()
}

export async function saveProfile(profile: unknown): Promise<void> {
  if (!inApp) return
  await invoke("set_profile", { profile })
}

/**
 * Stores an image and returns its id. The id carries the file type as its
 * extension, so it can be served with the right MIME type later.
 */
export async function putImage(blob: Blob): Promise<string> {
  if (!inApp) throw new Error("Images can only be changed in the Yapora app.")
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return invoke<string>("put_image", bytes, {
    headers: { "x-mime": blob.type },
  })
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
}

export async function getImage(id: string): Promise<Blob | undefined> {
  try {
    if (inApp) {
      const bytes = await invoke<ArrayBuffer>("get_image", { id })
      const ext = id.split(".").pop() ?? ""
      return new Blob([bytes], { type: MIME_BY_EXT[ext] ?? "" })
    }

    const response = await fetch(
      `${serverBase}/api/image/${encodeURIComponent(id)}`
    )
    return response.ok ? await response.blob() : undefined
  } catch {
    return undefined
  }
}

export async function deleteImage(id: string): Promise<void> {
  if (!inApp) return
  await invoke("delete_image", { id })
}

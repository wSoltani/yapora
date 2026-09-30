import { createStore, del, get, set } from "idb-keyval"

/**
 * Everything persistent goes through this port. Swapping IndexedDB for Tauri's
 * filesystem plugin later means reimplementing these four functions and nothing
 * else.
 */
export interface StoragePort {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

const store = createStore("yapora", "kv")

export const storage: StoragePort = {
  get: (key) => get(key, store),
  set: (key, value) => set(key, value, store),
  del: (key) => del(key, store),
}

export const PROFILE_KEY = "profile"
const IMAGE_PREFIX = "image:"

const imageKeyFor = (id: string) => `${IMAGE_PREFIX}${id}`

/**
 * Avatar images are stored as Blobs under their own keys, never inside the
 * profile JSON. An 8MB PNG base64-encoded into localStorage would blow its ~5MB
 * quota; IndexedDB takes the binary directly.
 */
export async function putImage(blob: Blob): Promise<string> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await storage.set(imageKeyFor(id), blob)
  return id
}

export async function getImage(id: string): Promise<Blob | undefined> {
  return storage.get<Blob>(imageKeyFor(id))
}

export async function deleteImage(id: string): Promise<void> {
  await storage.del(imageKeyFor(id))
}

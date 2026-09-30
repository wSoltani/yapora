import { invoke, isTauri } from "@tauri-apps/api/core"

/**
 * The same bundle runs in two places: the Tauri window (the editor, which owns
 * the microphone and the files on disk, and talks to the app over IPC) and
 * OBS's Browser Source (a read-only view fed by the app's local server). This
 * is the one place that knows which.
 */
export const inApp = isTauri()

/**
 * The analysis stream for OBS. The page is served by the app's own server, so
 * it lives on the same origin — and under `pnpm dev` Vite proxies it there.
 */
export function streamUrl(): string {
  return `${window.location.origin.replace(/^http/, "ws")}/ws`
}

export { invoke }

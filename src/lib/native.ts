import { invoke, isTauri } from "@tauri-apps/api/core"

/**
 * The same bundle runs in two places: the Tauri window (the editor, which owns
 * the microphone and the files on disk) and OBS's Browser Source (a read-only
 * view fed by the app's local server). This is the one place that knows which.
 */
export const inApp = isTauri()

/** Port of the app's local server; must match `server::PORT` in Rust. */
const SERVER_PORT = 4173

/**
 * Where the API and stream live. OBS is served by that server, so relative
 * URLs work — and under `pnpm dev` Vite proxies them there. The app window is
 * served from its own origin and has to name the server explicitly.
 */
export const serverBase = inApp ? `http://127.0.0.1:${SERVER_PORT}` : ""

export function streamUrl(): string {
  const base = serverBase || window.location.origin
  return `${base.replace(/^http/, "ws")}/ws`
}

export { invoke }

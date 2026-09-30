import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so one build works from localhost, a deployed
  // subpath, or the Tauri window without rebuilding.
  base: "./",
  // Keep Rust compile errors from `tauri dev` visible instead of wiping them.
  clearScreen: false,
  server: {
    port: 5173,
    // `tauri.conf.json` points the window at a fixed devUrl, so a silent move
    // to 5174 would open a blank window.
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // The API and analysis stream live in the running app. Proxying them keeps
    // a dev page same-origin with them, exactly as OBS is in production.
    proxy: {
      "/api": "http://127.0.0.1:4173",
      "/ws": { target: "ws://127.0.0.1:4173", ws: true },
    },
  },
  build: {
    /*
     * The app serves this same bundle to OBS, and OBS 30 and earlier embed
     * CEF 103 (Chrome 103). Vite's default target is
     * newer than that, and a single unsupported syntax feature is a parse
     * error, which means no render at all — a black Browser Source with
     * nothing in the log to explain it.
     */
    target: "chrome103",
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

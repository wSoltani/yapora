import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so one build works from localhost, a deployed
  // subpath, or a future Tauri window without rebuilding.
  base: "./",
  build: {
    /*
     * OBS 30 and earlier embed CEF 103 (Chrome 103). Vite's default target is
     * newer than that, and a single unsupported syntax feature is a parse
     * error, which means no render at all — a black Browser Source with
     * nothing in the log to explain it.
     */
    target: "chrome103",
  },
  plugins: [react(), tailwindcss()],
  preview: {
    port: 4173,
    /*
     * Fail loudly if 4173 is busy rather than silently moving to 4174. The
     * OBS Browser Source URL is saved with a fixed port, so a quiet reassign
     * shows up as a dead source mid-stream with nothing explaining it.
     */
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

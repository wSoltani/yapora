# Yapora

*yap + aura* — a reactive avatar (PNGTuber) for streams and videos, as a
desktop app.

An image masked into a shape — circle, square, rectangle or triangle, with
rounded corners if you like — a halo ring that breathes and brightens with your
voice, and a symmetrical spectrum-analyser "mouth" you drag onto your avatar's
face. Stream it into OBS live, or render it to a video from an audio file.

---

## Install

Run the installer from
`src-tauri/target/release/bundle/` — build it with `pnpm app:build` (see
[Development](#development)):

- `nsis/Yapora_<version>_x64-setup.exe` — per-user install with a Start menu
  entry and an uninstaller. The one to use.
- `msi/Yapora_<version>_x64_en-US.msi` — the same app as an MSI, for managed
  deployment.

The installer is not code-signed, so Windows SmartScreen shows *"Windows
protected your PC"* the first time: **More info → Run anyway**. Yapora runs on
Microsoft Edge WebView2, which Windows 10 and 11 already include.

Settings, profiles and images live in `%APPDATA%\com.yapora`.

---

## Quick start

Open Yapora, upload an image, crop it, and position the mouth. Settings save as
you go.

Then set up OBS once:

1. **Add a Browser Source** pointed at `http://localhost:4173/?mode=live` —
   **Output → OBS** has a copy button.
2. **Set width and height to a square** — 1000 × 1000 works well.
3. **Leave the background transparent** so it composites over your scene.

That is all. OBS needs no launch flags and no microphone permission: Yapora
reads the microphone itself and streams the analysis to the Browser Source.

---

## Everyday use

Open Yapora and leave it running while you stream. The Browser Source picks it
up on its own — OBS can start before or after the app, and the source
reconnects if you restart it. Close the app and the avatar eases to rest, with
a "Yapora app not running" badge so a still avatar is never a mystery.

Edits in the app show up in OBS as you make them. There is one copy of your
settings, on disk, and OBS reads it directly.

Only making videos? Switch **Output → OBS → Stream to OBS** off and the local
server stops holding the port.

### Profiles

Keep several looks — a stream setup, a green-screen video setup, an alt
character — and switch between them from the dropdown in the corner of the
stage or the list in the **Profile** tab. OBS always shows the active profile,
so switching there switches the stream. Create, duplicate, rename and delete
them in the **Profile** tab.

The microphone and playback device are shared by every profile, since they
name hardware on this machine. Gate, gain, the rest of the tuning, and the
video export settings are per profile.

### Keyboard

| Key | Action |
| --- | --- |
| `Ctrl` / `⌘` + `E` | Toggle Live mode |
| `Esc` | Leave Live mode |
| `Space` | Play / pause the audio file |
| Arrow keys | Nudge the mouth by 1 unit (click the gizmo first) |
| `Shift` + arrows | Nudge by 10 |
| `Shift` + drag a corner | Resize the mouth with locked aspect ratio |

---

## Tuning

The **Audio** tab has a live input meter with the noise gate (blue) and ceiling
(red) drawn on it. This is the single most valuable control:

- **Noise gate** — set it just above where the meter sits when you are silent.
  Below this level, the avatar reads as quiet.
- **Ceiling** — set it near your normal speaking peaks. This is the level that
  produces a full-scale reaction.

Get those two right and everything else is taste:

- **Attack / release** — fast attack with slow release is what reads as alive
  rather than twitchy. Separate pairs for the halo and the mouth.
- **High-frequency lift** — speech rolls off at the top, so without this the
  upper bars stay flat. Applied as a dB offset, not a multiplier.
- **Low / high cut** — the frequency range spread across the bars,
  logarithmically. Defaults to 85 Hz – 8 kHz, roughly what speech occupies.

### Sources

**Source** picks what drives the avatar, and OBS sees all three:

- **Microphone** — pick the device, or follow the system default.
- **Test signal** — a speech-shaped tone, for tuning without talking, or
  without a mic at all.
- **Audio file** — a voiceover, say (WAV, MP3, FLAC, OGG, M4A/AAC, AIFF, CAF).
  It plays through the chosen **playback device** with a player on the stage:
  play/pause (or Space), and click or drag the waveform to seek. Pausing
  freezes the avatar at that moment, and seeking while paused shows it as it
  looks there. To bring the sound itself into OBS, play it to a virtual audio
  cable and capture that.

---

## Making videos

Load an audio file (**Audio → Source → Audio file**), tune the look against it
with the player, then **Output → Video → Export video**. Pick a size (square,
16:9 or 9:16), 30 or 60 fps, and MP4 (H.264 + AAC) or WebM (VP9 + Opus) —
only formats this machine can encode are offered. The choices are saved with
the profile.

Export renders frame by frame rather than recording the screen, so it never
drops frames, keeps audio and video exactly in sync, and runs faster than real
time. It replays the preview's analysis on the same 60 Hz grid, so the video
moves the way the preview did. Video has no transparency: a transparent
background exports as green screen (`#00b140`) for keying. Cancelling deletes
the partial file.

---

## Troubleshooting

### The avatar renders but never moves

The **Audio** tab (audio problems) and **Output → OBS** (server problems) name
the exact failure:

| Message | Cause |
| --- | --- |
| Microphone access is blocked | Windows *Settings › Privacy & security › Microphone* does not allow desktop apps |
| No microphone found | Nothing plugged in, or Windows cannot see it |
| The microphone is in use | Another application has exclusive access |
| The microphone was disconnected | Unplugged mid-session — plug it back in or pick another |
| Couldn't open your speakers | No output device, or another app has exclusive control — press play to retry |
| Could not serve OBS on port 4173 | Another copy of Yapora (or something else) holds the port |

A saved microphone or playback device that is not present falls back to the
system default rather than failing.

### The mouth barely moves, or is a flat wall of bars

Tune the noise gate — see [Tuning](#tuning). A gate set too high silences
everything; a ceiling set too low pins every bar at maximum.

### The OBS source is black

Almost always a browser-compatibility problem, because **OBS 30 and earlier
embed CEF 103 (Chrome 103)**. Two things break there, and either one collapses
the page to nothing:

- **`svh` viewport units** need Chrome 108.
- **Tailwind v4** [requires Chrome 111](https://tailwindcss.com/docs/compatibility)
  and depends on `@property` and `color-mix()` internally.

Live mode is therefore styled with **inline CSS and plain SVG only** — no
Tailwind — and the build targets `chrome103`. If you still see black:

- Confirm the Browser Source URL includes `?mode=live`.
- Under `pnpm app` the source is served by Vite's dev server, which ignores
  the `chrome103` target — see [Development](#development). The installed app
  does not have this problem.

---

## Settings reference

| Tab | What's in it |
| --- | --- |
| **Avatar** | Upload, crop, remove; shape, size, corner radius, position; border |
| **Halo** | Gap, thickness, reaction amount, resting/peak opacity, colour, glow |
| **Mouth** | Position and size, bar count, spacing, cap rounding, symmetry, colour, backdrop |
| **Audio** | Source (mic, test signal, audio file), devices, gain, gate, ceiling, attack/release, spectrum |
| **Stage** | Background, overall scale, avatar motion, frame cap, error badge |
| **Output** | Stream to OBS on/off, Browser Source URL, video export |
| **Profile** | Profile list, name, new/duplicate/delete, export/import, reset |

**Backgrounds:** transparent (default, for OBS), black, green (`#00b140`, for
keying), or a custom colour. The checkerboard behind transparent is edit-mode
only and never renders in Live.

**Frame cap:** rendering follows your display's refresh rate, so a 144 Hz
monitor drives 144 fps for a 60 fps capture. Cap it to 60 or 30 to reclaim the
headroom on a weak machine.

**Export / import** bundles one profile's settings and image into one file —
for backups, or moving a look to another machine. Importing always adds a new
profile rather than overwriting one.

---

## How it's built

A Tauri 2 app. The frontend is React 19 + Vite + Tailwind v4 + shadcn/ui (Base
UI), Zustand for config, Zod for profile validation and migration, mediabunny
for video muxing. The Rust side captures and plays audio with `cpal`, decodes
files with `symphonia`, analyses with `rustfft`, and serves OBS with `axum`.

```
┌──────────────────── Yapora app (Rust) ────────────────────┐
│ mic / test signal / file ─► analyser (60 Hz) ─► hub ──┐    │
│ profiles/ + images/ + settings.json ◄─ commands       │    │
│                                   │                   ▼    │
│                                   └─► axum on 127.0.0.1:4173 (optional)
└──────────────┬────────────────────────────────┬───────────┘
   Tauri IPC: commands + frames    HTTP + WebSocket, read-only
               │                                │
      app window (editor)            OBS Browser Source (?mode=live)
```

The same frontend bundle runs in both places. `src/lib/native.ts` is the one
spot that knows which: the app window reads, writes and receives its frames
over IPC, so it works with OBS output off; OBS only reads, over the local
server.

**The Rust side does capture and FFT; the page does everything you tune.** The
analyser reimplements the Web Audio `AnalyserNode` exactly (Blackman window,
smoothing, dB) and streams a pre-gain dB spectrum. Gain, gate, ceiling,
envelopes and the band plan are applied by `Reaction` (`src/audio/reaction.ts`)
— one instance in the live `AudioEngine`, and one per video export — so the
editor, OBS and exported videos all react identically.

The architectural rule everything else follows: **audio never drives React
state**. The reaction writes into preallocated `Float32Array`s, and a single
`requestAnimationFrame` loop (`useStageRenderer`) reads them and writes SVG
attributes through refs — and only the ones whose values changed, so a settled
avatar costs no repaints (`src/render/dom.ts`). React re-renders only when
settings change.

```
src/audio/        AudioEngine, Reaction, analysis link, band plan, envelopes, file player
src/render/       the single rAF loop, its subscription bus, change-only DOM writes
src/stage/        the SVG stage, its three layers, shapes and per-frame maths
src/store/        Zod schema, profile store (persisted), app store (ephemeral)
src/edit/         editor UI: settings panel, crop dialog, mouth gizmo, player, export
src/export/       canvas stage renderer and the WebCodecs/mediabunny export loop
src-tauri/src/    audio sources + analyser, offline export analysis, OBS server, store
```

A few decisions worth knowing before changing things:

- **All coordinates persist in a fixed 1000 × 1000 stage space**, so a profile
  is resolution-independent and portable between machines.
- **The crop is a nested `<svg>` viewBox** over the source image's natural
  pixels. The image is never resampled, so crops stay lossless and re-editable.
- **Mouth bars animate `y`/`height`, not `scaleY`** — scaling squashes the
  rounded caps into ellipses.
- **Every avatar shape is a convex polygon with rounded corners**
  (`src/stage/shape.ts`). Growing one by d is its core polygon swept by
  radius + d, so the halo regenerates an exact outline each frame with a fixed
  `stroke-width` — constant thickness, no stretched corners — rather than
  scaling a shape. A circle is a square rounded all the way.
- **Frequency bands are bucketed logarithmically.** A linear split would put
  nearly all speech energy in the bottom two or three bars.
- **Export draws with Canvas 2D, not the SVG.** An SVG cannot be handed to a
  video encoder frame by frame, so `StageCanvas` redraws the stage from the
  same shapes, layout and per-frame maths (`src/stage/motion.ts`). Change a
  layer and change it there too.
- **The editor is a lazily-loaded chunk**, so a Browser Source in Live mode
  never downloads the cropper, colour picker or settings panel.
- **The local server binds to loopback only** and refuses WebSocket
  connections from origins other than its own page and the dev server — the
  frames are derived from your microphone.

### Development

```bash
pnpm install
pnpm app
```

`pnpm app` runs Vite on 5173 and the app against it, with HMR; Rust changes
rebuild and restart the window. The first run compiles the Rust side, which
takes a few minutes. The app's server on 4173 redirects page requests to Vite,
and Vite proxies `/api` and `/ws` back to the app, so
`http://localhost:4173/?mode=live` works in dev too — in a normal browser.
OBS 30 and earlier may render it black, because Vite's dev server transforms at
a modern target regardless of `build.target`.

The dev app and an installed Yapora share `%APPDATA%\com.yapora` and port
4173. Run one at a time.

`cargo test` in `src-tauri/` covers the analyser against known signals, file
decoding and playback, and the offline export analysis.

**Releasing:** bump the version in `package.json` and
`src-tauri/tauri.conf.json`, then `pnpm app:build`.

**The logo** is `src-tauri/app-icon.svg`, with a copy as the favicon in
`public/icon.svg`. After changing it, run `pnpm tauri icon src-tauri/app-icon.svg`
to regenerate `src-tauri/icons/`, and delete the `android/` and `ios/` folders
it also creates.

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm app` | Desktop app with HMR — for working on Yapora |
| `pnpm app:build` | Release build and installers into `src-tauri/target/release/bundle/` |
| `pnpm dev` | Vite alone on 5173 — needs the app running for data and audio |
| `pnpm build` | Typecheck and build the frontend to `dist/` |
| `pnpm typecheck` | `tsc -b` |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |

### Notes for future work

- **Avatar motion** (bounce, sway, loudness pop) is already wired through the
  render loop and the exporter and ships at `0`. Turning it on is a settings
  change, not a refactor — see **Stage → Avatar motion**.
- **Profiles are files in `profiles/`**, named by id; `settings.json` holds
  the active id, the microphone, the playback device and the OBS switch. Images
  are shared between duplicated profiles, so they are never deleted on replace
  — the app sweeps unreferenced ones at startup and after a delete
  (`Store::collect_images`).
- **Recording** the mic to a WAV would slot straight into the export: the
  recording becomes the audio file.
- **Closing the window quits the app**, which stops OBS's audio. A tray icon
  would let it keep running in the background.
- **Crop rotation is deliberately unimplemented**; it complicates deriving the
  crop rectangle that the stage consumes as a viewBox.
- **The profile schema is at version 3.** `migrateProfile` in
  `src/store/schema.ts` fills missing fields from defaults rather than failing,
  so a stale profile still opens. Add a step there when changing the shape.

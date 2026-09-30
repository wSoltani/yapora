# Yapora

*yap + aura* — a reactive avatar (PNGTuber) for OBS, as a desktop app.

An image masked into a shape — circle, square, rectangle or triangle, with
rounded corners if you like — a halo ring that breathes and brightens with
your microphone, and a symmetrical spectrum-analyser "mouth" you drag onto your
avatar's face. The whole composition is one resolution-independent SVG, so it
stays crisp at any Browser Source size.

---

## Quick start

```bash
pnpm install
pnpm app
```

The first run compiles the Rust side, which takes a few minutes. Upload an
image, crop it, and position the mouth. Settings save as you go.

Then set up OBS once:

1. **Add a Browser Source** pointed at `http://localhost:4173/?mode=live` —
   **Output → OBS** has a copy button. (Stream to OBS is on by default; it can
   be switched off when you are only making videos.)
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

### Profiles

Keep several looks — a stream setup, a green-screen video setup, an alt
character — and switch between them from the dropdown at the top of the
editor. OBS always shows the active profile, so switching there switches the
stream. Create, duplicate, rename and delete them in the **Profile** tab.

The microphone choice is shared by every profile, since it names hardware on
this machine. Gate, gain and the rest of the tuning are per profile.

### Keyboard

| Key | Action |
| --- | --- |
| `Ctrl` / `⌘` + `E` | Toggle Live mode |
| `Esc` | Leave Live mode |
| Arrow keys | Nudge the mouth by 1 unit (click the gizmo first) |
| `Shift` + arrows | Nudge by 10 |
| `Shift` + drag a corner | Resize the mouth with locked aspect ratio |

---

## Troubleshooting

### The source is black

Almost always a browser-compatibility problem, because **OBS 30 and earlier
embed CEF 103 (Chrome 103)** — CEF has been stuck there because newer Chromium
dropped features OBS depends on.

Two things break on Chrome 103, and either one collapses the page to nothing:

- **`svh` viewport units** need Chrome 108.
- **Tailwind v4** [requires Chrome 111](https://tailwindcss.com/docs/compatibility)
  and depends on `@property` and `color-mix()` internally.

Live mode is therefore styled with **inline CSS and plain SVG only** — no
Tailwind — and the build targets `chrome103`. If you are still seeing black:

- Confirm the Browser Source URL includes `?mode=live`.
- Under `pnpm app` the source is served by Vite's dev server, which ignores
  the `chrome103` target — see [Development](#development). An installed build
  (`pnpm app:build`) does not have this problem.

### The avatar renders but never moves

Check the **Audio** tab (microphone problems) and **Output → OBS** (server
problems) in the app, which name the exact failure:

| Message | Cause |
| --- | --- |
| Microphone access is blocked | Windows *Settings › Privacy & security › Microphone* does not allow desktop apps |
| No microphone found | Nothing plugged in, or Windows cannot see it |
| The microphone is in use | Another application has exclusive access |
| The microphone was disconnected | Unplugged mid-session — plug it back in or pick another |
| Could not serve OBS on port 4173 | Another copy of Yapora (or something else) holds the port |

A saved microphone that is not present falls back to the system default rather
than failing.

### The mouth barely moves, or is a flat wall of bars

Tune the noise gate — see [Tuning](#tuning). A gate set too high silences
everything; a ceiling set too low pins every bar at maximum.

---

## Tuning

The **Audio** tab has a live input meter with the noise gate (blue) and ceiling
(red) drawn on it. This is the single most valuable control:

- **Noise gate** — set it just above where the meter sits when you are silent.
  Below this level, the avatar reads as quiet.
- **Ceiling** — set it near your normal speaking peaks. This is the level that
  produces a full-scale reaction.

Get those two right and everything else is taste.

**Source** picks what drives the avatar: the **microphone**, a speech-shaped
**test signal** (tune without talking, or without a mic at all), or an **audio
file** — a voiceover, say. A file plays through your speakers with a player on
the stage: play/pause (or Space), and click or drag the waveform to seek.
Pausing freezes the avatar at that moment, and seeking while paused shows the
avatar as it looks there. OBS sees all three.

---

## Making videos

Load an audio file (**Audio → Source → Audio file**), tune the look against it
with the player, then **Output → Video → Export video**. Pick a size (square,
16:9 or 9:16), 30 or 60 fps, and MP4 (H.264 + AAC) or WebM (VP9 + Opus) —
only formats this machine can encode are offered.

Export renders frame by frame rather than recording the screen, so it never
drops frames, keeps audio and video exactly in sync, and runs faster than real
time. It replays the preview's analysis on the same 60 Hz grid, so the video
moves the way the preview did. Video has no transparency: a transparent
background exports as green screen (`#00b140`) for keying.

Other controls worth knowing:

- **Attack / release** — fast attack with slow release is what reads as alive
  rather than twitchy. Separate pairs for the halo and the mouth.
- **High-frequency lift** — speech rolls off at the top, so without this the
  upper bars stay flat. Applied as a dB offset, not a multiplier.
- **Low / high cut** — the frequency range spread across the bars,
  logarithmically. Defaults to 85 Hz – 8 kHz, roughly what speech occupies.

---

## Settings reference

| Tab | What's in it |
| --- | --- |
| **Avatar** | Upload, crop, remove; shape, size, corner radius, position; border |
| **Halo** | Gap, thickness, reaction amount, resting/peak opacity, colour, glow |
| **Mouth** | Position and size, bar count, spacing, cap rounding, symmetry, colour, backdrop |
| **Audio** | Source (mic, test signal, audio file), device, gain, gate, ceiling, attack/release, spectrum |
| **Stage** | Background, overall scale, avatar motion, frame cap, error badge |
| **Output** | Stream to OBS on/off, Browser Source URL, video export |
| **Profile** | Name, new/duplicate/delete, export/import, reset |

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
UI), Zustand for config, Zod for profile validation and migration. The Rust
side captures and plays audio with `cpal`, decodes files with `symphonia`,
analyses with `rustfft`, and serves OBS with `axum`.

```
┌──────────── Yapora app (Rust) ────────────┐
│ cpal mic ─► analyser (60 Hz) ─► hub ─┐    │
│ profiles/ + images/ ◄─ commands      │    │
│                  │                   ▼    │
│                  └──► axum on 127.0.0.1:4173
└──────────────────────────────┬────────────┘
        Tauri IPC (read/write) │ HTTP + WebSocket (read-only)
        ┌──────────────────────┴───────────┐
   app window (editor)          OBS Browser Source (?mode=live)
```

The same frontend bundle runs in both places. `src/lib/native.ts` is the one
spot that knows which: the app window writes through Tauri commands, OBS only
reads, over the local server.

**The Rust side does capture and FFT; the page does everything you tune.** The
analyser reimplements the Web Audio `AnalyserNode` exactly (Blackman window,
smoothing, dB) and streams a pre-gain dB spectrum. Gain, gate, ceiling,
envelopes and the band plan are applied in `AudioEngine`, so the editor and OBS
react identically and profiles tuned against the old browser version behave the
same.

The architectural rule everything else follows: **audio never drives React
state**. `AudioEngine` writes into preallocated `Float32Array`s, and a single
`requestAnimationFrame` loop (`useStageRenderer`) reads them and writes SVG
attributes through refs. React re-renders only when settings change — a frame
costs a handful of attribute writes rather than a render pass.

```
src/audio/        AudioEngine, analysis link, band plan, envelope followers, gate
src/render/       the single rAF loop and its subscription bus
src/stage/        the SVG stage and its three layers
src/store/        Zod schema, profile store (persisted), app store (ephemeral)
src/edit/         crop dialog, mouth gizmo, settings panel, profile import/export
src/export/       canvas stage renderer and the WebCodecs/mediabunny export loop
src-tauri/src/    audio capture + analyser, local server, on-disk store
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
- **The editor is a lazily-loaded chunk**, so a Browser Source in Live mode
  never downloads the cropper, colour picker or settings panel.
- **The local server binds to loopback only** and refuses WebSocket
  connections from origins other than OBS, the app, and the dev server — the
  frames are derived from your microphone.

### Development

`pnpm app` runs Vite on 5173 and the app against it, with HMR. The app's server
on 4173 redirects page requests to Vite, and Vite proxies `/api` and `/ws` back
to the app, so `http://localhost:4173/?mode=live` works in dev too — in a
normal browser. OBS 30 and earlier may render it black, because Vite's dev
server transforms at a modern target regardless of `build.target`.

Rust changes restart the app automatically. `cargo test` in `src-tauri/` covers
the analyser against known signals.

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm app` | Desktop app with HMR — **use this to run Yapora** |
| `pnpm app:build` | Build the installer into `src-tauri/target/release/bundle/` |
| `pnpm dev` | Vite alone on 5173 — needs the app running for data and audio |
| `pnpm build` | Typecheck and build the frontend to `dist/` |
| `pnpm typecheck` | `tsc -b` |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |

### Notes for future work

- **Avatar motion** (bounce, sway, loudness pop) is already wired through the
  render loop and ships at `0`. Turning it on is a settings change, not a
  refactor — see **Stage → Avatar motion**.
- **Profiles are files in `profiles/`**, named by id; `settings.json` holds
  the active id, the microphone and the OBS switch. Images are shared between
  duplicated profiles, so they are never deleted on replace — the app sweeps
  unreferenced ones at startup and after a delete (`Store::collect_images`).
- **Closing the window quits the app**, which stops OBS's audio. A tray icon
  would let it keep running in the background.
- **Crop rotation is deliberately unimplemented**; it complicates deriving the
  crop rectangle that the stage consumes as a viewBox.
- **The profile schema is at version 3.** `migrateProfile` in
  `src/store/schema.ts` fills missing fields from defaults rather than failing,
  so a stale profile still opens. Add a step there when changing the shape.

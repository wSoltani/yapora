# Yapora

*yap + aura* — a reactive avatar (PNGTuber) for OBS, in the browser.

An image masked into a circle, a halo ring that breathes and brightens with
your microphone, and a symmetrical spectrum-analyser "mouth" you drag onto your
avatar's face. The whole composition is one resolution-independent SVG, so it
stays crisp at any Browser Source size.

---

## Quick start

```bash
pnpm install
pnpm stream
```

Open <http://localhost:4173>, upload an image, crop it, and position the mouth.
Settings save as you go.

Then set up OBS once:

1. **Launch OBS with microphone flags** — see
   [Microphone access in OBS](#microphone-access-in-obs). Without this the
   avatar renders but never moves.
2. **Add a Browser Source** pointed at `http://localhost:4173/?mode=live`.
3. **Set width and height to a square** — 1000 × 1000 works well.
4. **Leave the background transparent** so it composites over your scene.

After that, streaming is one command.

---

## Everyday use

```bash
pnpm stream
```

Leave the terminal running while you stream. That is the whole routine — your
settings live in OBS's own storage and persist between sessions.

> **Use `pnpm stream`, not `pnpm dev`.**
>
> `pnpm dev` serves on port **5173** instead of 4173, so a saved Browser Source
> URL will not match it. More importantly, `build.target: "chrome103"` only
> applies to `vite build` — Vite's dev server transforms at a modern target
> regardless, so on OBS 30 and earlier the dev server can ship JavaScript that
> CEF 103 cannot parse, which renders as a black screen with nothing in the log
> to explain it.
>
> `pnpm dev` is for working on Yapora itself. `pnpm stream` is for using it.

The preview server uses `strictPort`, so if 4173 is already taken it fails
loudly at launch rather than quietly moving to 4174 and leaving OBS pointed at
a dead URL mid-stream.

### Keyboard

| Key | Action |
| --- | --- |
| `Ctrl` / `⌘` + `E` | Toggle Live mode |
| `Esc` | Leave Live mode |
| Arrow keys | Nudge the mouth by 1 unit (click the gizmo first) |
| `Shift` + arrows | Nudge by 10 |
| `Shift` + drag a corner | Resize the mouth with locked aspect ratio |

---

## Microphone access in OBS

This is the one genuinely fiddly part, and it is an OBS limitation rather than
something Yapora can fix from inside the page.

**OBS never shows a permission prompt**, so a Browser Source's `getUserMedia`
call is refused by default. Close OBS and relaunch it with both flags:

```
obs64.exe --enable-media-stream --use-fake-ui-for-media-stream
```

On Windows: right-click your OBS shortcut → Properties → append both flags to
the end of the Target field.

Three things the flags do **not** cover:

1. **OS-level permission.** The flags bypass the *browser* prompt only. Windows
   still needs *Settings › Privacy & security › Microphone* to allow desktop
   apps.
2. **The origin.** Browser Sources on a local `file://` path are blocked from
   user media outright
   ([obs-studio#6329](https://github.com/obsproject/obs-studio/issues/6329)).
   Serve over `localhost` or https — which `pnpm stream` does.
3. **Exclusive access.** If another application holds the microphone you get
   `NotReadableError` regardless of permissions.

The **Profile** tab reports live microphone status and names the specific
failure, so you can tell a permission refusal apart from a missing device
without guessing.

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

- Confirm you ran `pnpm stream`, not `pnpm dev` (see above).
- Confirm the Browser Source URL includes `?mode=live`.
- Rebuild after pulling changes — OBS serves `dist/`, not your source tree.

### The avatar renders but never moves

The microphone is not reaching the page. Open the Browser Source's **Interact**
window and check the **Profile** tab, which names the exact failure. Each error
means something different:

| Error | Cause |
| --- | --- |
| `NotAllowedError` | Permission refused — OBS launch flags missing |
| `NotFoundError` | No microphone — OBS lacks OS-level access |
| `NotReadableError` | Another application holds the microphone |
| `OverconstrainedError` | Saved device does not exist here — pick one again |
| `SecurityError` | Blocked origin — serving from `file://` |

Live mode also shows a small badge when the microphone fails, so a silent
avatar is never a mystery. Switch it off in **Stage → Live mode**.

### The mouth barely moves, or is a flat wall of bars

Tune the noise gate — see [Tuning](#tuning). A gate set too high silences
everything; a ceiling set too low pins every bar at maximum.

### The editor looks broken inside OBS

Expected on OBS 30 and earlier. The **editor** uses Tailwind, which needs
Chrome 111, so the Interact window will look wrong even though Live mode
renders correctly. Configure in a real browser and import the profile instead,
or upgrade to OBS 31+ (CEF 127).

### Settings I saved in Chrome are missing in OBS

OBS runs its own browser storage, so nothing saved in your desktop browser
exists inside it. Use **Profile → Export**, then import the file through the
Browser Source's **Interact** window. The export bundles your image, so it is
the whole look in one file.

The saved microphone choice is deliberately *not* exported: device IDs are
salted per browser profile, so one picked in Chrome cannot exist in OBS. The
importing machine falls back to its own default.

---

## Tuning

The **Audio** tab has a live input meter with the noise gate (blue) and ceiling
(red) drawn on it. This is the single most valuable control:

- **Noise gate** — set it just above where the meter sits when you are silent.
  Below this level, the avatar reads as quiet.
- **Ceiling** — set it near your normal speaking peaks. This is the level that
  produces a full-scale reaction.

Get those two right and everything else is taste.

**Test signal** swaps the microphone for a speech-shaped tone, so you can tune
the look without talking — or without a microphone at all.

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
| **Avatar** | Upload, crop, remove; circle size and position; border |
| **Halo** | Gap, thickness, reaction amount, resting/peak opacity, colour, glow |
| **Mouth** | Position and size, bar count, spacing, cap rounding, symmetry, colour, backdrop |
| **Audio** | Device, gain, test signal, gate, ceiling, attack/release, spectrum |
| **Stage** | Background, overall scale, avatar motion, frame cap, error badge |
| **Profile** | Name, export/import, Browser Source URL, microphone status, reset |

**Backgrounds:** transparent (default, for OBS), black, green (`#00b140`, for
keying), or a custom colour. The checkerboard behind transparent is edit-mode
only and never renders in Live.

**Frame cap:** rendering follows your display's refresh rate, so a 144 Hz
monitor drives 144 fps for a 60 fps capture. Cap it to 60 or 30 to reclaim the
headroom on a weak machine.

---

## How it's built

React 19 + Vite + Tailwind v4 + shadcn/ui (Base UI), Zustand for config, Zod
for profile validation and migration, IndexedDB for persistence.

The architectural rule everything else follows: **audio never drives React
state**. `AudioEngine` writes into preallocated `Float32Array`s, and a single
`requestAnimationFrame` loop (`useStageRenderer`) reads them and writes SVG
attributes through refs. React re-renders only when settings change — a frame
costs a handful of attribute writes rather than a render pass.

```
src/audio/    AudioEngine, log-frequency band plan, envelope followers, gate
src/render/   the single rAF loop and its subscription bus
src/stage/    the SVG stage and its three layers
src/store/    Zod schema, profile store (persisted), app store (ephemeral)
src/edit/     crop dialog, mouth gizmo, settings panel, profile import/export
```

A few decisions worth knowing before changing things:

- **All coordinates persist in a fixed 1000 × 1000 stage space**, so a profile
  is resolution-independent and portable between machines.
- **The crop is a nested `<svg>` viewBox** over the source image's natural
  pixels. The image is never resampled, so crops stay lossless and re-editable.
- **Mouth bars animate `y`/`height`, not `scaleY`** — scaling squashes the
  rounded caps into ellipses.
- **The halo animates `r` with a fixed `stroke-width`**, so the ring keeps
  constant thickness as it breathes rather than changing weight.
- **Frequency bands are bucketed logarithmically.** A linear split would put
  nearly all speech energy in the bottom two or three bars.
- **The editor is a lazily-loaded chunk**, so a Browser Source in Live mode
  never downloads the cropper, colour picker or settings panel.

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm stream` | Build and serve for OBS on 4173 — **use this to stream** |
| `pnpm dev` | Dev server on 5173 with HMR — for working on Yapora |
| `pnpm build` | Typecheck and build to `dist/` |
| `pnpm typecheck` | `tsc -b` |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |

### Notes for future work

- **Avatar motion** (bounce, sway, loudness pop) is already wired through the
  render loop and ships at `0`. Turning it on is a settings change, not a
  refactor — see **Stage → Avatar motion**.
- **`Profile` is shaped for multiple named profiles**; adding a switcher is
  additive rather than a schema migration.
- **`src/store/storage.ts` is a four-function port** around IndexedDB — the
  swap point for Tauri's filesystem plugin. Everything else is origin-agnostic
  (`base: "./"`), so a Tauri build would mainly mean replacing that file and
  dropping the terminal step from the everyday routine.
- **Crop rotation is deliberately unimplemented**; it complicates deriving the
  crop rectangle that the stage consumes as a viewBox.
- **The profile schema is at version 2.** `migrateProfile` in
  `src/store/schema.ts` fills missing fields from defaults rather than failing,
  so a stale profile still opens. Add a step there when changing the shape.

import { z } from "zod"

/**
 * The stage is a fixed abstract coordinate space. Every persisted coordinate is
 * expressed in these units, so a profile is resolution-independent: the same
 * config renders identically in a 400px browser tab and a 1920px OBS source.
 */
export const STAGE_SIZE = 1000
export const STAGE_CENTER = STAGE_SIZE / 2

export const PROFILE_VERSION = 3

const hexColor = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)

const Vec2 = z.object({
  x: z.number(),
  y: z.number(),
})

/** A rectangle in the source image's natural pixel space. */
const CropRect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
})

export const AvatarShape = z.enum(["circle", "square", "rectangle", "triangle"])
export type AvatarShape = z.infer<typeof AvatarShape>

export const AvatarSchema = z.object({
  /** Key into the blob store. The image itself never lives in this JSON. */
  imageKey: z.string().nullable().default(null),
  natural: z
    .object({ width: z.number().positive(), height: z.number().positive() })
    .nullable()
    .default(null),
  /**
   * react-easy-crop's controlled state. Persisted so reopening the crop dialog
   * restores the exact editing position, not an approximation of it.
   */
  editor: z
    .object({
      crop: Vec2.default({ x: 0, y: 0 }),
      zoom: z.number().min(1).max(10).default(1),
    })
    .default({ crop: { x: 0, y: 0 }, zoom: 1 }),
  /** Derived from the editor state; consumed directly as the nested <svg> viewBox. */
  cropRect: CropRect.nullable().default(null),
  shape: AvatarShape.default("circle"),
  /**
   * Bounding box in stage units. Circle and square are 1:1 and use `width`
   * alone; `height` is kept for when the shape is switched back.
   */
  width: z.number().min(100).max(960).default(600),
  height: z.number().min(100).max(960).default(600),
  /** Fraction of the largest radius the shape can take. Unused by circle. */
  cornerRadius: z.number().min(0).max(1).default(0.15),
  center: Vec2.default({ x: STAGE_CENTER, y: STAGE_CENTER }),
  /** Ring drawn at the avatar's own edge, independent of the reactive halo. */
  ringWidth: z.number().min(0).max(40).default(0),
  ringColor: hexColor.default("#ffffff"),
})

export const HaloSchema = z.object({
  enabled: z.boolean().default(true),
  /** Distance from the avatar's edge to the ring's inner edge at rest. */
  gap: z.number().min(0).max(200).default(24),
  thickness: z.number().min(1).max(80).default(10),
  color: hexColor.default("#7c5cff"),
  /**
   * Opacity is voice-reactive between these two, the same way the radius is:
   * the ring fades up as you speak and settles back when you stop.
   * Setting them equal makes it constant.
   */
  opacityMin: z.number().min(0).max(1).default(0.45),
  opacityMax: z.number().min(0).max(1).default(1),
  /** How far the ring grows outward at full level, in stage units. */
  reactivity: z.number().min(0).max(200).default(60),
  /** Floor keeps a little life in the ring during silence. */
  floor: z.number().min(0).max(1).default(0.04),
  glow: z.number().min(0).max(40).default(8),
})

export const MouthBackdropSchema = z.object({
  enabled: z.boolean().default(true),
  color: hexColor.default("#000000"),
  opacity: z.number().min(0).max(1).default(0.45),
  /** Corner radius as a fraction of half the backdrop's height. */
  radius: z.number().min(0).max(1).default(1),
  padding: z.number().min(0).max(120).default(18),
  /** Softens the backdrop's edge with a radial mask. */
  feather: z.number().min(0).max(1).default(0.35),
})

export const MouthSchema = z.object({
  enabled: z.boolean().default(true),
  /** Center point and extents, all in stage units. */
  center: Vec2.default({ x: STAGE_CENTER, y: STAGE_CENTER + 140 }),
  width: z.number().min(20).max(STAGE_SIZE).default(260),
  height: z.number().min(10).max(STAGE_SIZE).default(120),
  barCount: z.number().int().min(3).max(96).default(21),
  /** Fraction of each slot taken by the gap rather than the bar. */
  gapRatio: z.number().min(0).max(0.9).default(0.38),
  /** Cap rounding as a fraction of half the bar width. 1 = fully round. */
  capRadius: z.number().min(0).max(1).default(1),
  color: hexColor.default("#ffffff"),
  opacity: z.number().min(0).max(1).default(1),
  /** Bar height during silence, as a fraction of the full height. */
  minHeight: z.number().min(0).max(0.5).default(0.06),
  symmetry: z.enum(["mirror", "baseline"]).default("mirror"),
  /** Mirror the spectrum left-to-right so both halves match. */
  mirrorSpectrum: z.boolean().default(true),
  backdrop: MouthBackdropSchema.prefault({}),
})

// The microphone is not here: it names hardware on this machine, so it is an
// app setting rather than part of a look. Older profiles' `deviceId` is dropped
// on parse.
export const AudioSchema = z.object({
  /** Input trim in dB, applied before analysis. */
  gain: z.number().min(-24).max(24).default(0),
  /** Below this level the signal reads as silence. */
  gateThreshold: z.number().min(-90).max(0).default(-55),
  /** The level that maps to a full-scale response. */
  ceiling: z.number().min(-60).max(0).default(-12),
  /** Fast attack, slow release is what reads as "alive" rather than twitchy. */
  attackMs: z.number().min(0).max(500).default(18),
  releaseMs: z.number().min(0).max(2000).default(180),
  barAttackMs: z.number().min(0).max(500).default(10),
  barReleaseMs: z.number().min(0).max(2000).default(120),
  fftSize: z
    .union([z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)])
    .default(2048),
  smoothing: z.number().min(0).max(0.95).default(0.6),
  /** Speech-relevant range. Bins are bucketed logarithmically across it. */
  freqMin: z.number().min(20).max(2000).default(85),
  freqMax: z.number().min(1000).max(20000).default(8000),
  /**
   * Compensates for speech rolling off at high frequencies, so the upper bars
   * are not permanently flat. 0 = raw spectrum, 1 = strong tilt.
   */
  tilt: z.number().min(0).max(1).default(0.4),
})

export const BackgroundMode = z.enum([
  "transparent",
  "black",
  "green",
  "custom",
])
export type BackgroundMode = z.infer<typeof BackgroundMode>

export const StageSchema = z.object({
  background: BackgroundMode.default("transparent"),
  customColor: hexColor.default("#101014"),
  /** Uniform scale applied to the whole composition. */
  scale: z.number().min(0.2).max(2).default(1),
  /**
   * Avatar motion hooks. The render loop already drives these transforms; they
   * ship at 0 so v1 renders a still avatar. Enabling motion is a settings
   * change, not a refactor.
   */
  motion: z
    .object({
      bounce: z.number().min(0).max(100).default(0),
      tilt: z.number().min(0).max(30).default(0),
      pop: z.number().min(0).max(0.5).default(0),
    })
    .prefault({}),
})

export const UiSchema = z.object({
  /**
   * A mic failure inside OBS otherwise renders a silent, motionless avatar with
   * no explanation. This badge is the only thing Live mode draws besides the
   * avatar, and it can be switched off.
   */
  showErrorBadge: z.boolean().default(true),
  /** rAF follows monitor refresh; cap it on weak machines. null = uncapped. */
  fpsCap: z.number().min(15).max(240).nullable().default(null),
  showCheckerboard: z.boolean().default(true),
})

export const ExportSize = z.enum(["square", "landscape", "portrait"])
export const VideoFormat = z.enum(["mp4", "webm"])

/**
 * Video export settings. Per profile, since profiles are looks for different
 * purposes — a vertical-video profile keeps 9:16 while the stream one doesn't.
 */
export const ExportSchema = z.object({
  size: ExportSize.default("square"),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  /** Preferred; falls back to what this machine can encode. */
  format: VideoFormat.default("mp4"),
})

export const ProfileSchema = z.object({
  version: z.number().int().default(PROFILE_VERSION),
  id: z.string().default("default"),
  name: z.string().default("Default"),
  avatar: AvatarSchema.prefault({}),
  halo: HaloSchema.prefault({}),
  mouth: MouthSchema.prefault({}),
  audio: AudioSchema.prefault({}),
  stage: StageSchema.prefault({}),
  ui: UiSchema.prefault({}),
  export: ExportSchema.prefault({}),
})

export type Profile = z.infer<typeof ProfileSchema>
export type AvatarConfig = z.infer<typeof AvatarSchema>
export type HaloConfig = z.infer<typeof HaloSchema>
export type MouthConfig = z.infer<typeof MouthSchema>
export type AudioConfig = z.infer<typeof AudioSchema>
export type StageConfig = z.infer<typeof StageSchema>
export type UiConfig = z.infer<typeof UiSchema>
export type ExportConfig = z.infer<typeof ExportSchema>

export function createDefaultProfile(): Profile {
  return ProfileSchema.parse({})
}

/**
 * Brings a stored or imported profile up to the current version. Unknown or
 * missing fields fall back to their defaults rather than failing the load —
 * a partially stale profile should still open.
 */
export function migrateProfile(input: unknown): Profile {
  if (input === null || typeof input !== "object") {
    return createDefaultProfile()
  }

  const raw = input as Record<string, unknown>

  // v1 -> v2: the halo's single `opacity` became a reactive min/max pair.
  // The old value was the ring at full voice, so it becomes the maximum.
  const version = typeof raw.version === "number" ? raw.version : 1
  if (version < 2 && raw.halo !== null && typeof raw.halo === "object") {
    const halo = raw.halo as Record<string, unknown>
    if (typeof halo.opacity === "number") {
      raw.halo = {
        ...halo,
        opacityMax: halo.opacity,
        opacityMin: Math.min(halo.opacity, 0.45),
      }
    }
  }

  // v2 -> v3: avatars gained shapes. The circle's radius becomes its box.
  if (version < 3 && raw.avatar !== null && typeof raw.avatar === "object") {
    const { radius, ...avatar } = raw.avatar as Record<string, unknown>
    if (typeof radius === "number") {
      raw.avatar = { ...avatar, width: radius * 2, height: radius * 2 }
    }
  }

  const result = ProfileSchema.safeParse({ ...raw, version: PROFILE_VERSION })
  if (!result.success) {
    return createDefaultProfile()
  }

  return result.data
}

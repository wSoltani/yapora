import {
  computeBackdropRect,
  computeBarGeometry,
  computeBarLayout,
} from "@/stage/geometry"
import { avatarMotion, haloFrame } from "@/stage/motion"
import { avatarBox, ShapeOutline } from "@/stage/shape"
import { backgroundCss, CHROMA_GREEN } from "@/stage/background"
import { STAGE_CENTER, STAGE_SIZE, type Profile } from "@/store/schema"

type Ctx = OffscreenCanvasRenderingContext2D

export interface CanvasFrame {
  level: number
  bands: Float32Array
  /** Seconds since the start, for time-based motion. */
  time: number
}

/**
 * Draws the stage to a canvas, for video export.
 *
 * The live stage is SVG, which cannot be handed to a video encoder frame by
 * frame. This reproduces it with Canvas 2D from the same geometry — the same
 * shape outlines, bar layout and per-frame maths — so an export matches the
 * preview. Groups that SVG fades as a whole (the halo, the mouth) are drawn
 * to a layer first, so overlapping parts don't double up their opacity.
 */
export class StageCanvas {
  readonly width: number
  readonly height: number
  /** Whether the encoder keeps alpha, so a transparent stage stays clear. */
  readonly alpha: boolean
  readonly canvas: OffscreenCanvas
  private ctx: Ctx
  private layer: OffscreenCanvas
  private layerCtx: Ctx
  private scratch: OffscreenCanvas
  private scratchCtx: Ctx

  constructor(width: number, height: number, alpha: boolean) {
    this.width = width
    this.height = height
    this.alpha = alpha
    const make = () => {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Canvas 2D is not available.")
      return [canvas, ctx] as const
    }
    ;[this.canvas, this.ctx] = make()
    ;[this.layer, this.layerCtx] = make()
    ;[this.scratch, this.scratchCtx] = make()
  }

  /** Stage units to pixels: the square stage fitted and centred, like OBS. */
  private stageTransform(ctx: Ctx, profile: Profile) {
    const fit = Math.min(this.width, this.height) / STAGE_SIZE
    const k = profile.stage.scale
    ctx.setTransform(
      fit,
      0,
      0,
      fit,
      (this.width - STAGE_SIZE * fit) / 2,
      (this.height - STAGE_SIZE * fit) / 2
    )
    if (k !== 1) {
      ctx.translate(STAGE_CENTER, STAGE_CENTER)
      ctx.scale(k, k)
      ctx.translate(-STAGE_CENTER, -STAGE_CENTER)
    }
    return fit * k
  }

  private clear(ctx: Ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = "source-over"
    ctx.filter = "none"
    ctx.clearRect(0, 0, this.width, this.height)
  }

  /** Composites a layer onto the frame at the group's opacity. */
  private composite(layer: OffscreenCanvas, opacity: number) {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = opacity
    ctx.drawImage(layer, 0, 0)
    ctx.globalAlpha = 1
  }

  draw(profile: Profile, image: CanvasImageSource | null, frame: CanvasFrame) {
    const ctx = this.ctx
    this.clear(ctx)
    const background = backgroundCss(profile.stage)
    // Without alpha, transparent becomes the keying green.
    if (background || !this.alpha) {
      ctx.fillStyle = background ?? CHROMA_GREEN
      ctx.fillRect(0, 0, this.width, this.height)
    }

    const outline = new ShapeOutline(
      profile.avatar.shape,
      avatarBox(profile.avatar),
      profile.avatar.cornerRadius
    )

    // Halo first so its glow sits behind the avatar, as in the SVG.
    if (profile.halo.enabled) this.drawHalo(profile, outline, frame)
    this.drawAvatar(profile, outline, image, frame)
    if (profile.mouth.enabled) this.drawMouth(profile, frame)
  }

  private drawHalo(
    profile: Profile,
    outline: ShapeOutline,
    frame: CanvasFrame
  ) {
    const { halo } = profile
    const ctx = this.layerCtx
    this.clear(ctx)
    const pixelsPerUnit = this.stageTransform(ctx, profile)

    const { offset, opacity } = haloFrame(halo, frame.level)
    const ring = new Path2D(outline.path(offset))
    ctx.strokeStyle = halo.color
    ctx.lineWidth = halo.thickness

    if (halo.glow > 0) {
      // The SVG blurs in stage units; canvas blur is in pixels.
      ctx.filter = `blur(${halo.glow * pixelsPerUnit}px)`
      ctx.globalAlpha = 0.75
      ctx.stroke(ring)
      ctx.filter = "none"
      ctx.globalAlpha = 1
    }

    ctx.lineJoin = "round"
    ctx.stroke(ring)
    ctx.lineJoin = "miter"

    this.composite(this.layer, opacity)
  }

  private drawAvatar(
    profile: Profile,
    outline: ShapeOutline,
    image: CanvasImageSource | null,
    frame: CanvasFrame
  ) {
    const { avatar } = profile
    const ctx = this.ctx
    ctx.save()
    this.stageTransform(ctx, profile)

    const moved = avatarMotion(profile.stage.motion, frame.level, frame.time)
    if (moved) {
      const { x, y } = avatar.center
      ctx.translate(x, y + moved.dy)
      ctx.rotate((moved.angle * Math.PI) / 180)
      ctx.scale(moved.scale, moved.scale)
      ctx.translate(-x, -y)
    }

    const box = avatarBox(avatar)
    const shape = new Path2D(outline.path())
    ctx.save()
    ctx.clip(shape)
    const crop = avatar.cropRect
    if (image && crop) {
      // The SVG's nested viewBox with "xMidYMid slice": scale the crop to
      // cover the box, centred, and let the shape clip the overflow.
      const k = Math.max(box.width / crop.width, box.height / crop.height)
      const w = crop.width * k
      const h = crop.height * k
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        box.cx - w / 2,
        box.cy - h / 2,
        w,
        h
      )
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)"
      ctx.fill(shape)
    }
    ctx.restore()

    if (avatar.ringWidth > 0) {
      ctx.strokeStyle = avatar.ringColor
      ctx.lineWidth = avatar.ringWidth
      ctx.stroke(new Path2D(outline.path(-avatar.ringWidth / 2)))
    }
    ctx.restore()
  }

  private drawMouth(profile: Profile, frame: CanvasFrame) {
    const { mouth } = profile
    const ctx = this.layerCtx
    this.clear(ctx)
    this.stageTransform(ctx, profile)

    if (mouth.backdrop.enabled) {
      this.drawBackdrop(profile)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(this.scratch, 0, 0)
      this.stageTransform(ctx, profile)
    }

    const layout = computeBarLayout(mouth)
    ctx.fillStyle = mouth.color
    for (let i = 0; i < mouth.barCount; i++) {
      const { y, height } = computeBarGeometry(
        frame.bands[i] ?? 0,
        mouth,
        layout
      )
      // SVG clamps rx to half the width and ry (= rx) to half the height.
      const radius = Math.min(layout.rx, layout.barWidth / 2, height / 2)
      ctx.beginPath()
      ctx.roundRect(layout.x(i), y, layout.barWidth, height, radius)
      ctx.fill()
    }

    this.composite(this.layer, mouth.opacity)
  }

  /** The backdrop plate, feathered by an elliptical fade like the SVG mask. */
  private drawBackdrop(profile: Profile) {
    const { backdrop } = profile.mouth
    const ctx = this.scratchCtx
    this.clear(ctx)
    this.stageTransform(ctx, profile)

    const rect = computeBackdropRect(profile.mouth)
    ctx.globalAlpha = backdrop.opacity
    ctx.fillStyle = backdrop.color
    ctx.beginPath()
    ctx.roundRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      Math.min(rect.rx, rect.width / 2, rect.height / 2)
    )
    ctx.fill()
    ctx.globalAlpha = 1

    if (backdrop.feather > 0) {
      // objectBoundingBox radial gradient: a unit circle stretched over the
      // rect, fully opaque out to 1 - feather and clear at its edge.
      ctx.globalCompositeOperation = "destination-in"
      ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
      ctx.scale(rect.width / 2, rect.height / 2)
      const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      fade.addColorStop(0, "#000")
      fade.addColorStop(Math.max(0, 1 - backdrop.feather), "#000")
      fade.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = fade
      ctx.fillRect(-1, -1, 2, 2)
      ctx.globalCompositeOperation = "source-over"
    }
  }
}

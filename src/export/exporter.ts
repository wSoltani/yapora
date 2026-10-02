import { save } from "@tauri-apps/plugin-dialog"
import {
  AudioSample,
  AudioSampleSource,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  WebMOutputFormat,
  type StreamTargetChunk,
} from "mediabunny"

import { Reaction } from "@/audio/reaction"
import { invoke } from "@/lib/native"
import type { Profile } from "@/store/schema"

import { StageCanvas } from "./StageCanvas"

export type VideoFormat = "mp4" | "webm"

export interface ExportSettings {
  width: number
  height: number
  fps: number
  format: VideoFormat
}

interface ExportInfo {
  channels: number
  sampleRate: number
  frames: number
  duration: number
}

const CODECS = {
  mp4: { video: "avc", audio: "aac" },
  webm: { video: "vp9", audio: "opus" },
} as const

/**
 * Whether an export comes out transparent: only a transparent stage, and only
 * WebM — VP9 carries alpha, H.264 in MP4 can't.
 */
export function keepsAlpha(profile: Profile, format: VideoFormat) {
  return format === "webm" && profile.stage.background === "transparent"
}

/** Analysis frames fetched per IPC round trip. */
const ANALYSIS_BATCH = 60
/** Audio is kept about this far ahead of the video, in seconds. */
const AUDIO_LEAD = 1

/**
 * Which formats this machine can encode at a size. The WebView's encoders
 * vary by hardware and Windows build, so this is asked, never assumed.
 */
export async function supportedFormats(
  width: number,
  height: number
): Promise<VideoFormat[]> {
  const formats: VideoFormat[] = []
  for (const format of ["mp4", "webm"] as const) {
    const { video, audio } = CODECS[format]
    const ok =
      (await canEncodeVideo(video, { width, height })) &&
      (await canEncodeAudio(audio, { numberOfChannels: 2, sampleRate: 48_000 }))
    if (ok) formats.push(format)
  }
  return formats
}

/** Asks where to save; `null` if cancelled. */
export async function chooseExportPath(
  name: string,
  format: VideoFormat
): Promise<string | null> {
  const base = name.replace(/\.[^.]+$/, "") || "yapora"
  return save({
    title: "Export video",
    defaultPath: `${base}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  })
}

/**
 * Renders the loaded audio file to a video at `path`.
 *
 * Frame by frame and faster than real time: each frame's analysis comes from
 * the app on the live tick grid, goes through the same {@link Reaction} as the
 * preview, is drawn by {@link StageCanvas} and encoded with WebCodecs. The
 * muxer's output streams straight to disk. On failure or cancel, the partial
 * file is deleted.
 */
export async function exportVideo({
  path,
  profile,
  image,
  settings,
  onProgress,
  signal,
}: {
  path: string
  profile: Profile
  image: CanvasImageSource | null
  settings: ExportSettings
  onProgress: (fraction: number) => void
  signal: AbortSignal
}): Promise<void> {
  const { width, height, fps, format } = settings
  const { fftSize, smoothing } = profile.audio

  const info = await invoke<ExportInfo>("export_begin", {
    path,
    fftSize,
    smoothing,
  })

  let output: Output | null = null
  try {
    const writable = new WritableStream<StreamTargetChunk>({
      write: (chunk) =>
        invoke("export_write", chunk.data, {
          headers: { "x-position": String(chunk.position) },
        }),
    })
    output = new Output({
      format:
        format === "mp4"
          ? // Written progressively with the index at the end, so nothing
            // has to be held in memory until the file is complete.
            new Mp4OutputFormat({ fastStart: false })
          : new WebMOutputFormat(),
      // Batching writes keeps IPC round trips to a handful per second.
      target: new StreamTarget(writable, {
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
      }),
    })

    const alpha = keepsAlpha(profile, format)
    const stage = new StageCanvas(width, height, alpha)
    const video = new CanvasSource(stage.canvas, {
      codec: CODECS[format].video,
      bitrate: QUALITY_HIGH,
      keyFrameInterval: 2,
      // VP9 alpha is a second stream stored beside the colour, as OBS and
      // Chromium read it.
      alpha: alpha ? "keep" : "discard",
    })
    const audio = new AudioSampleSource({
      codec: CODECS[format].audio,
      bitrate: QUALITY_HIGH,
      // Opus only encodes at 48 kHz, and 44.1 kHz files are common.
      transform: { sampleRate: 48_000 },
    })
    output.addVideoTrack(video, { frameRate: fps, canBeTransparent: alpha })
    output.addAudioTrack(audio)
    await output.start()

    const reaction = new Reaction()
    reaction.configure(profile.audio)
    const { barCount, mirrorSpectrum } = profile.mouth
    const frameLength = 2 + fftSize / 2
    const total = Math.max(1, Math.ceil(info.duration * fps))
    let audioCursor = 0

    const addAudioUntil = async (seconds: number) => {
      const until = Math.min(info.frames, Math.ceil(seconds * info.sampleRate))
      while (audioCursor < until) {
        const count = Math.min(info.sampleRate, until - audioCursor)
        const pcm = await invoke<ArrayBuffer>("export_pcm", {
          start: audioCursor,
          count,
        })
        await audio.add(
          new AudioSample({
            data: new Float32Array(pcm),
            format: "f32",
            numberOfChannels: info.channels,
            sampleRate: info.sampleRate,
            timestamp: audioCursor / info.sampleRate,
          })
        )
        audioCursor += count
      }
    }

    for (let start = 0; start < total; start += ANALYSIS_BATCH) {
      const count = Math.min(ANALYSIS_BATCH, total - start)
      const batch = new Float32Array(
        await invoke<ArrayBuffer>("export_analysis", { fps, start, count })
      )

      for (let j = 0; j < count; j++) {
        signal.throwIfAborted()
        const index = start + j
        const time = index / fps

        reaction.process(
          batch.subarray(j * frameLength, (j + 1) * frameLength),
          1 / fps,
          barCount,
          mirrorSpectrum
        )
        stage.draw(profile, image, {
          level: reaction.level,
          bands: reaction.bands,
          time,
        })
        await video.add(time, 1 / fps)
        await addAudioUntil(time + AUDIO_LEAD)
      }

      onProgress(Math.min(1, (start + count) / total))
    }

    await addAudioUntil(info.duration)
    await output.finalize()
    await invoke("export_finish")
  } catch (error) {
    try {
      await output?.cancel()
    } catch {
      // Already failed; the abort below still removes the file.
    }
    await invoke("export_abort")
    throw error
  }
}

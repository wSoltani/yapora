import type { StageConfig } from "@/store/schema"

/** A dark, neutral green that keys cleanly and is far from most skin tones. */
export const CHROMA_GREEN = "#00b140"

/** The stage background as a CSS colour; `undefined` is transparent. */
export function backgroundCss(stage: StageConfig): string | undefined {
  switch (stage.background) {
    case "black":
      return "#000000"
    case "green":
      return CHROMA_GREEN
    case "custom":
      return stage.customColor
    case "transparent":
    default:
      return undefined
  }
}

/**
 * Frame-loop DOM writes that skip values which have not changed.
 *
 * The loop runs at the display's refresh rate even while the avatar is at
 * rest. Chromium repaints on every attribute or style write, equal value or
 * not, and a repaint of the stage re-runs the halo's blur — so blind writes
 * kept an idle window busy at 144 fps. Once the envelopes settle, the values
 * formatted here stop changing and a quiet frame costs nothing.
 */

export function setAttr(el: Element | null, name: string, value: string) {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value)
}

export function setStyle(
  el: HTMLElement | null,
  name: "width" | "left",
  value: string
) {
  if (el && el.style[name] !== value) el.style[name] = value
}

export function setText(el: HTMLElement | null, value: string) {
  if (el && el.textContent !== value) el.textContent = value
}

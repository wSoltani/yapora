import type { AvatarConfig, AvatarShape } from "@/store/schema"

interface Point {
  x: number
  y: number
}

/** The avatar's bounding box in stage units. */
export interface ShapeBox {
  cx: number
  cy: number
  width: number
  height: number
}

/**
 * Circle and square are locked to 1:1 and take their size from `width` alone.
 * `height` is left as it was, so switching back to a rectangle restores it.
 */
export function avatarBox(avatar: AvatarConfig): ShapeBox {
  const locked = avatar.shape === "circle" || avatar.shape === "square"
  return {
    cx: avatar.center.x,
    cy: avatar.center.y,
    width: avatar.width,
    height: locked ? avatar.width : avatar.height,
  }
}

/**
 * Every shape is a convex polygon with rounded corners, which is what makes
 * outlines exact at any offset.
 *
 * Such a shape is its "core" polygon (the original pulled in by the corner
 * radius r) swept by a disk of radius r. Growing it by d is the same core
 * swept by r + d — so the halo, pushed out by gap and reactivity, keeps the
 * shape's proportions and a constant ring thickness instead of distorting the
 * way a scale transform would. A circle is just a square whose corner radius
 * is half its side.
 */
export class ShapeOutline {
  /** Unit outward normal of each edge, clockwise from the top. */
  private normals: Point[]
  /** The polygon with every edge moved `t` inward. */
  private inset: (t: number) => Point[]
  /** Corner radius in stage units. */
  readonly radius: number

  constructor(shape: AvatarShape, box: ShapeBox, cornerRadius: number) {
    if (shape === "triangle") {
      const triangle = isoscelesTriangle(box)
      this.normals = triangle.normals
      this.inset = triangle.inset
      this.radius = cornerRadius * triangle.inradius
    } else {
      this.normals = RECT_NORMALS
      this.inset = (t) => rectInset(box, t)
      const maxRadius = Math.min(box.width, box.height) / 2
      this.radius = shape === "circle" ? maxRadius : cornerRadius * maxRadius
    }
  }

  /**
   * SVG path for the outline grown by `offset` (negative shrinks it). Past
   * the corner radius, shrinking falls back to sharp corners — the true
   * inner offset of a rounded shape.
   */
  path(offset = 0): string {
    const rho = Math.max(0, this.radius + offset)
    const core = this.inset(Math.max(this.radius, -offset))
    const normals = this.normals
    const count = core.length
    let d = ""

    for (let i = 0; i < count; i++) {
      const vertex = core[i]
      const incoming = normals[(i + count - 1) % count]
      const outgoing = normals[i]
      const start = `${fmt(vertex.x + rho * incoming.x)} ${fmt(vertex.y + rho * incoming.y)}`
      d += i === 0 ? `M${start}` : `L${start}`
      if (rho > 0) {
        // Convex corners always turn less than 180°, so the arc is the small
        // one, swept clockwise like the polygon itself.
        d += `A${fmt(rho)} ${fmt(rho)} 0 0 1 ${fmt(vertex.x + rho * outgoing.x)} ${fmt(vertex.y + rho * outgoing.y)}`
      }
    }

    return `${d}Z`
  }
}

const fmt = (value: number) => value.toFixed(2)

/** Top, right, bottom, left — clockwise in SVG's y-down space. */
const RECT_NORMALS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

/** Corners clockwise from top-left; collapses to a line or point, never inverts. */
function rectInset(box: ShapeBox, t: number): Point[] {
  const hw = Math.max(0, box.width / 2 - t)
  const hh = Math.max(0, box.height / 2 - t)
  return [
    { x: box.cx - hw, y: box.cy - hh },
    { x: box.cx + hw, y: box.cy - hh },
    { x: box.cx + hw, y: box.cy + hh },
    { x: box.cx - hw, y: box.cy + hh },
  ]
}

/**
 * Apex at the top centre, base along the bottom of the box, so the image
 * frame and the shape share one bounding box.
 *
 * A triangle's edges all touch its incircle, so moving every edge in by t is
 * a uniform scale about the incentre — which is also why the largest corner
 * radius is the inradius, at which the triangle rounds off into that circle.
 */
function isoscelesTriangle(box: ShapeBox) {
  const vertices: Point[] = [
    { x: box.cx, y: box.cy - box.height / 2 },
    { x: box.cx + box.width / 2, y: box.cy + box.height / 2 },
    { x: box.cx - box.width / 2, y: box.cy + box.height / 2 },
  ]

  const normals = vertices.map((from, i) => {
    const to = vertices[(i + 1) % 3]
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
    // Outward for a clockwise polygon in y-down space.
    return { x: (to.y - from.y) / length, y: -(to.x - from.x) / length }
  })

  // Incentre: vertices weighted by the length of the opposite side.
  const sides = vertices.map((_, i) => {
    const a = vertices[(i + 1) % 3]
    const b = vertices[(i + 2) % 3]
    return Math.hypot(b.x - a.x, b.y - a.y)
  })
  const perimeter = sides[0] + sides[1] + sides[2] || 1
  const incenter = {
    x: vertices.reduce((sum, v, i) => sum + v.x * sides[i], 0) / perimeter,
    y: vertices.reduce((sum, v, i) => sum + v.y * sides[i], 0) / perimeter,
  }
  const area = (box.width * box.height) / 2
  const inradius = (2 * area) / perimeter

  const inset = (t: number): Point[] => {
    const k = inradius > 0 ? Math.max(0, (inradius - t) / inradius) : 0
    return vertices.map((v) => ({
      x: incenter.x + (v.x - incenter.x) * k,
      y: incenter.y + (v.y - incenter.y) * k,
    }))
  }

  return { normals, inset, inradius }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voronoi engine primitives.
 *
 * Shared geometry helpers used by the Voronoi-based spice renderers
 * (Louro, Alho, Pimenta). Per the user's directive — "não quero
 * abstrações genéricas demais; cada spice ainda precisa manter
 * personalidade procedural própria" — this module does NOT impose
 * a uniform Voronoi pipeline. It just exposes the lower-level building
 * blocks that were previously copy-pasted across three renderers:
 *
 *  - clipPolygon: half-plane Sutherland-Hodgman clip by perpendicular
 *    bisector of two seeds
 *  - createAnisotropicTransform: produces the (toT, fromT) coordinate
 *    converters that implement the elongation/rotation anisotropy
 *  - polygonArea, polygonCentroid, isPointInPolygon: pure geometry
 *
 * Per-spice seed-placement strategies and per-spice Voronoi loops
 * remain in patternRenderer.ts where each spice's procedural identity
 * lives.
 */

export type Vec2 = [number, number];

// ─── Anisotropic coordinate transform ────────────────────────────────────────

/**
 * Build the (toT, fromT) coordinate-converter pair that implements
 * elongation along a rotated axis. Used by Voronoi spices to compute
 * tessellations in a deformed space where cells appear elongated and
 * rotated in the final output.
 *
 * Equivalent to:
 *   const alpha = (rotationDeg * Math.PI) / 180;
 *   const cos = Math.cos(alpha);
 *   const sin = Math.sin(alpha);
 *   toT  : (x, y) => ((x*cos + y*sin) / stretch, -x*sin + y*cos)
 *   fromT: (xt, yt) => (xt*stretch*cos - yt*sin, xt*stretch*sin + yt*cos)
 *
 * @param stretch     elongation factor (1.0 = isotropic; >1 elongates along the rotated x-axis)
 * @param rotationDeg axis rotation in degrees (0–180 from PARAMETERS.rotation)
 */
export function createAnisotropicTransform(stretch: number, rotationDeg: number): {
  toT: (x: number, y: number) => { x: number; y: number };
  fromT: (xt: number, yt: number) => Vec2;
} {
  const alpha = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(alpha);
  const sin = Math.sin(alpha);

  const toT = (x: number, y: number) => ({
    x: (x * cos + y * sin) / stretch,
    y: -x * sin + y * cos,
  });

  const fromT = (xt: number, yt: number): Vec2 => {
    const xs = xt * stretch;
    return [xs * cos - yt * sin, xs * sin + yt * cos];
  };

  return { toT, fromT };
}

// ─── Polygon clipping (Sutherland-Hodgman against perpendicular bisector) ────

/**
 * Clip `poly` against the half-plane on s0's side of the perpendicular
 * bisector of (s0, sj). Used to compute one Voronoi cell by iteratively
 * clipping against each neighbor.
 *
 * Algorithm: Sutherland-Hodgman. Returns the clipped polygon (possibly
 * empty if s0 was fully on the wrong side of every neighbor).
 *
 * Operates in whatever coordinate space the caller is in — typically
 * the anisotropically-transformed space when used with createAnisotropicTransform.
 */
export function clipPolygon(
  poly: Vec2[],
  s0: { x: number; y: number },
  sj: { x: number; y: number }
): Vec2[] {
  const mx = (s0.x + sj.x) / 2;
  const my = (s0.y + sj.y) / 2;
  const nx = sj.x - s0.x;
  const ny = sj.y - s0.y;

  const result: Vec2[] = [];
  if (poly.length === 0) return result;

  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];

    const d1 = (p1[0] - mx) * nx + (p1[1] - my) * ny;
    const d2 = (p2[0] - mx) * nx + (p2[1] - my) * ny;

    if (d1 <= 0) {
      if (d2 <= 0) {
        result.push(p2);
      } else {
        const t = d1 / (d1 - d2);
        const ix = p1[0] + t * (p2[0] - p1[0]);
        const iy = p1[1] + t * (p2[1] - p1[1]);
        result.push([ix, iy]);
      }
    } else {
      if (d2 <= 0) {
        const t = d1 / (d1 - d2);
        const ix = p1[0] + t * (p2[0] - p1[0]);
        const iy = p1[1] + t * (p2[1] - p1[1]);
        result.push([ix, iy]);
        result.push(p2);
      }
    }
  }
  return result;
}

// ─── Polygon geometry helpers ────────────────────────────────────────────────

/** Ray-casting point-in-polygon test. */
export function isPointInPolygon(px: number, py: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Shoelace polygon area (always positive). */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * Area-weighted polygon centroid (centroid of the actual filled region).
 *
 * Note: the degenerate-fallback threshold is 0.01 sq.px (NOT 1e-10) to
 * preserve byte-identical output with the prior inlined implementation
 * (`getPolygonCentroid` in patternRenderer.ts). Cells with area below
 * 0.01 are essentially zero-pixel slivers that should never be drawn.
 */
export function polygonCentroid(poly: Vec2[]): { x: number; y: number } {
  let cx = 0, cy = 0, area = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 0.01) {
    // Fallback to arithmetic-mean centroid for degenerate (near-zero-area) polygons
    let sx = 0, sy = 0;
    for (const [x, y] of poly) { sx += x; sy += y; }
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

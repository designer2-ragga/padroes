/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Seasoning, PatternConfig } from '../types';
import { PARAMETERS, SpiceId } from '../engine/parameters';
import { strokeWidth } from '../engine/scaling';
import {
  clipPolygon,
  isPointInPolygon,
  polygonArea,
  polygonCentroid,
  createAnisotropicTransform,
} from '../engine/voronoi';

// Deterministic pseudo-random number generator to prevent flickering patterns
export class SeededRandom {
  private h: number;

  constructor(seed: string) {
    this.h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      this.h = Math.imul(this.h ^ seed.charCodeAt(i), 3432918353);
      this.h = (this.h << 13) | (this.h >>> 19);
    }
  }

  next(): number {
    this.h = Math.imul(this.h ^ (this.h >>> 16), 2246822507);
    this.h = Math.imul(this.h ^ (this.h >>> 13), 3266489909);
    return ((this.h ^= this.h >>> 16) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

interface Particle {
  x: number;
  y: number;
  size: number;
  rotation: number;
  opacity: number;
  colorShift: number;
  extraValue: number;
}

// Generate deterministic particles for a specific seasoning and size
export function generateParticles(seasoningId: string, count: number, width: number, height: number, layoutSeed: number = 1): Particle[] {
  const rng = new SeededRandom(seasoningId + '_organic_v4_' + Math.round(layoutSeed));
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    particles.push({
      x: rng.range(0, width),
      y: rng.range(0, height),
      size: rng.range(16, 42),
      rotation: rng.range(0, Math.PI * 2),
      opacity: rng.range(0.8, 1.0), // High opacity like the flat image
      colorShift: rng.range(0, 1),
      extraValue: rng.range(0, 1),
    });
  }

  return particles;
}

// Draw a procedurally smooth closed organic blob/pebble using mid-point quadratic curves
function pathOrganicBlob(
  ctx: CanvasRenderingContext2D,
  radiusX: number,
  radiusY: number,
  pointsCount: number,
  seedStr: string,
  dentFactor: number = 0.15
) {
  const rng = new SeededRandom(seedStr);
  const angles: number[] = [];
  const radii: number[] = [];

  for (let i = 0; i < pointsCount; i++) {
    const angle = (i * Math.PI * 2) / pointsCount;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    // Ellipse radius equation base
    const baseR = Math.sqrt(1 / ((cos * cos) / (radiusX * radiusX) + (sin * sin) / (radiusY * radiusY)));
    
    // Apply organic indent waving
    const wave = rng.range(1 - dentFactor, 1 + dentFactor);
    radii.push(baseR * wave);
    angles.push(angle);
  }

  // Generate coordinate array
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < pointsCount; i++) {
    pts.push({
      x: radii[i] * Math.cos(angles[i]),
      y: radii[i] * Math.sin(angles[i]),
    });
  }

  // Trace with midpoints quadratic Bezier curves for perfect smoothness
  ctx.beginPath();
  const startPtX = (pts[pointsCount - 1].x + pts[0].x) / 2;
  const startPtY = (pts[pointsCount - 1].y + pts[0].y) / 2;
  ctx.moveTo(startPtX, startPtY);

  for (let i = 0; i < pointsCount; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % pointsCount];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
  }
  ctx.closePath();
}

// Organic vacuole blob — replaces ctx.arc for garlic nuclei.
// Consumes rng directly so canvas + SVG renderers stay in identical rng state.
// n=7 points, dent=0.07 gives subtle biological wobble while preserving circular identity.
function pathOrganicVacuole(ctx: CanvasRenderingContext2D, r: number, n: number, rng: SeededRandom, dent: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI * 2) / n;
    const w = rng.range(1 - dent, 1 + dent);
    pts.push({ x: Math.cos(a) * r * w, y: Math.sin(a) * r * w });
  }
  ctx.beginPath();
  ctx.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[j].x) / 2, (pts[i].y + pts[j].y) / 2);
  }
  ctx.closePath();
}

function svgOrganicVacuole(cx: number, cy: number, r: number, n: number, rng: SeededRandom, dent: number): string {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI * 2) / n;
    const w = rng.range(1 - dent, 1 + dent);
    pts.push({ x: cx + Math.cos(a) * r * w, y: cy + Math.sin(a) * r * w });
  }
  let d = `M ${((pts[n-1].x+pts[0].x)/2).toFixed(1)} ${((pts[n-1].y+pts[0].y)/2).toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${((pts[i].x+pts[j].x)/2).toFixed(1)} ${((pts[i].y+pts[j].y)/2).toFixed(1)}`;
  }
  return d + ' Z';
}

interface OKLCHColor {
  l: number;       // Lightness 0-1
  c: number;       // Chroma
  h: number;       // Hue 360
  fallback: string; // Hex color fallback
}

export const SEASONINGS_OKLCH: Record<string, OKLCHColor> = {
  sal: { l: 0.48, c: 0.22, h: 25, fallback: '#B81A20' },
  louro: { l: 0.38, c: 0.18, h: 250, fallback: '#1E40AF' },
  alho: { l: 0.72, c: 0.16, h: 85, fallback: '#D4A010' },
  pimenta: { l: 0.58, c: 0.21, h: 40, fallback: '#E86820' },
  manjericao: { l: 0.35, c: 0.16, h: 350, fallback: '#8A2040' },
  oregano: { l: 0.71, c: 0.17, h: 115, fallback: '#93B629' }
};

// Neutral cream pole used in all theme inversions
const CREAM = 'oklch(96% 0.008 88.75)';

// ─── Parameter scaling helpers ──────────────────────────────────────────────

// Convert linear zoom (40–1200x) to logarithmic scale for smooth magnification feel
function zoomToMagnificationFactor(zoom: number): number {
  // Logarithmic scaling: 40 → 0.5x, 100 → 1x, 340 → 3.4x, 1200 → 12x
  return zoom / 100;
}

// Easing function for smooth rounding interpolation (ease-in-cubic)
function easingRounding(t: number): number {
  // t: 0 to 100 (percentage)
  const normalized = t / 100;
  return normalized * normalized * normalized; // cubic ease-in
}

// Canonical theme rule: LIGHT = {bg:keyColor, fg:CREAM} | DARK = {bg:CREAM, fg:keyColor}
function getThemeColors(seasoningId: string, isDark: boolean): { bg: string; fg: string } {
  const ok = SEASONINGS_OKLCH[seasoningId] || { l: 0.5, c: 0.1, h: 0 };
  const key = `oklch(${ok.l * 100}% ${ok.c} ${ok.h})`;
  return isDark ? { bg: CREAM, fg: key } : { bg: key, fg: CREAM };
}

// Return the shape/particle color for the current theme
function getParticleColor(seasoningId: string, _p: Particle, config: PatternConfig): string {
  return getThemeColors(seasoningId, config.themeMode === 'dark').fg;
}

// Apply styling to shapes according to OKLCH tone modes, with per-particle color variation
function applyFillAndStroke(
  ctx: CanvasRenderingContext2D,
  seasoningId: string,
  p: Particle,
  config: PatternConfig
) {
  const particleColor = getParticleColor(seasoningId, p, config);
  ctx.fillStyle = particleColor;
  ctx.strokeStyle = particleColor;
  ctx.lineWidth = 0;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

// 1. Sal (Salt): Smooth varying round spheroids, ellipses, and extremely rounded cuboid pebbles matching the real microscopic image
function drawSaltCrystal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: Particle,
  config: PatternConfig,
  seasoningId: string
) {
  const size = p.size * (config.zoom / 100) * 1.15;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rotation);

  // Setup the solid fill color according to theme
  applyFillAndStroke(ctx, seasoningId, p, config);

  const rng = new SeededRandom(p.colorShift + '_salt_grain');
  const shapeType = rng.range(0, 1);

  ctx.beginPath();
  if (shapeType < 0.45) {
    // 45% round spheroids / slightly squashed ellipses
    const rx = size * rng.range(0.85, 1.15);
    const ry = size * rng.range(0.85, 1.15);
    ctx.ellipse(0, 0, rx, ry, rng.range(0, Math.PI * 2), 0, Math.PI * 2);
  } else if (shapeType < 0.8) {
    // 35% extremely smooth rounded organic pebble blobs (6-point with low denting factor)
    const rx = size * rng.range(0.95, 1.25);
    const ry = size * rng.range(0.8, 1.05);
    pathOrganicBlob(ctx, rx, ry, 6, p.colorShift + '_salt_pebble', 0.06);
  } else {
    // 20% very rounded smooth squares/quadrilaterals
    const rx = size * rng.range(0.9, 1.15);
    const ry = size * rng.range(0.9, 1.15);
    pathOrganicBlob(ctx, rx, ry, 4, p.colorShift + '_salt_quad', 0.08);
  }
  ctx.fill();

  ctx.restore();
}

// 2. Louro (Bay Leaf): Beautiful wavy anticlinal epidermis wall cells with stomata
function drawLouroCell(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: Particle,
  config: PatternConfig,
  seasoningId: string
) {
  const size = p.size * (config.zoom / 100) * 1.25;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rotation);

  // Epidermis anticlinal wavy cell wall (puzzle cells)
  pathOrganicBlob(ctx, size * 1.2, size * 0.9, 10, p.colorShift + '_louro_puzzle', 0.35);
  applyFillAndStroke(ctx, seasoningId, p, config);
  ctx.fill();

  // Draw central stomata aperture pore (cutout revealing the background)
  ctx.save();
  ctx.fillStyle = getThemeColors('louro', config.themeMode === 'dark').bg;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.25, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// 3. Alho (Garlic): Linear cell compartments with mitotic dividing nuclei matching Allium root-tip microscopes
function drawGarlicConcentric(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: Particle,
  config: PatternConfig,
  seasoningId: string
) {
  const size = p.size * (config.zoom / 100) * 1.15;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rotation);

  // Generate slightly rounded and irregular cell chamber (like paving stones) using pathOrganicBlob
  pathOrganicBlob(ctx, size * 1.25, size * 1.0, 5, p.colorShift + '_garlic_box', 0.08);
  applyFillAndStroke(ctx, seasoningId, p, config);
  ctx.fill();

  // Nucleus cutout reveals the background color
  ctx.save();
  ctx.fillStyle = getThemeColors('alho', config.themeMode === 'dark').bg;

  // Choose mitosis cell stage with SeededRandom for perfect deterministic distribution
  const rngCell = new SeededRandom(p.colorShift + '_mitosis');
  const randVal = rngCell.range(0, 1);

  if (randVal < 0.75) {
    // Standard Interphase: 1 prominent nucleus slightly offset for natural look
    const ox = rngCell.range(-size * 0.08, size * 0.08);
    const oy = rngCell.range(-size * 0.08, size * 0.08);
    const nr = size * rngCell.range(0.33, 0.40);
    ctx.beginPath();
    ctx.arc(ox, oy, nr, 0, Math.PI * 2);
    ctx.fill();
  } else if (randVal < 0.88) {
    // Metaphase/Anaphase: Condensed chromosome spindle plate separating in the center
    ctx.save();
    ctx.rotate(rngCell.range(-Math.PI / 4, Math.PI / 4));
    ctx.beginPath();
    ctx.rect(-size * 0.12, -size * 0.35, size * 0.24, size * 0.7);
    ctx.rect(-size * 0.3, -size * 0.12, size * 0.6, size * 0.24);
    ctx.fill();
    ctx.restore();
  } else {
    // Telophase: Two smaller daughter nuclei pulling apart
    const dist = size * rngCell.range(0.24, 0.32);
    const nr = size * rngCell.range(0.18, 0.23);
    ctx.beginPath();
    ctx.arc(-dist, 0, nr, 0, Math.PI * 2);
    ctx.arc(dist, 0, nr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.restore();
}

// 4. Pimenta (Pepper): TEM cell cross-section — irregular membrane, dense cytoplasm with organelles
function drawPimentaSpikes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: Particle,
  config: PatternConfig,
  seasoningId: string
) {
  const size = p.size * (config.zoom / 100) * 1.35;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rotation);

  const isDark = config.themeMode === 'dark';
  const bgColor = getThemeColors('pimenta', isDark).bg;

  // Outer cell membrane wall
  applyFillAndStroke(ctx, seasoningId, p, config);
  pathOrganicBlob(ctx, size * 1.05, size * 0.82, 9, p.colorShift + '_pc_outer', 0.18);
  ctx.fill();

  // Cell interior (cytoplasm background)
  ctx.fillStyle = bgColor;
  pathOrganicBlob(ctx, size * 0.88, size * 0.68, 8, p.colorShift + '_pc_inner', 0.15);
  ctx.fill();

  // Clip all organelles to the cell interior
  ctx.save();
  pathOrganicBlob(ctx, size * 0.88, size * 0.68, 8, p.colorShift + '_pc_inner', 0.15);
  ctx.clip();

  applyFillAndStroke(ctx, seasoningId, p, config);

  const rng = new SeededRandom(p.colorShift + '_pc_org_' + p.extraValue.toFixed(4));

  // Many small organelle dots (vacuoles, ribosomes)
  const smallCount = 18 + Math.floor(rng.range(0, 7));
  for (let i = 0; i < smallCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.range(0, 1));
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d * size * 0.7, Math.sin(a) * d * size * 0.56, rng.range(size * 0.03, size * 0.065), 0, Math.PI * 2);
    ctx.fill();
  }

  // 2–3 medium lipid/plastid bodies
  const medCount = 2 + Math.floor(rng.range(0, 2));
  for (let i = 0; i < medCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.range(0, 0.65));
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d * size * 0.6, Math.sin(a) * d * size * 0.48, rng.range(size * 0.1, size * 0.155), 0, Math.PI * 2);
    ctx.fill();
  }

  // One large vacuole (like "P" in TEM image)
  const la = rng.range(0, Math.PI * 2);
  const ld = Math.sqrt(rng.range(0.05, 0.45));
  ctx.beginPath();
  ctx.arc(Math.cos(la) * ld * size * 0.55, Math.sin(la) * ld * size * 0.44, rng.range(size * 0.18, size * 0.24), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore(); // end clip
  ctx.restore(); // end transform
}

// 5. Manjericão (Basil): Peltate glandular disc with 8 radial septa and inner concentric ring
function drawManjericaoGlandular(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: Particle,
  config: PatternConfig,
  seasoningId: string
) {
  const size = p.size * (config.zoom / 100) * 1.15;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rotation);

  applyFillAndStroke(ctx, seasoningId, p, config);

  // Outer glandular disc
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.88, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  const isDark = config.themeMode === 'dark';
  const bgColor = getThemeColors('manjericao', isDark).bg;

  ctx.strokeStyle = bgColor;
  ctx.lineCap = 'round';

  // 8 radial septa lines from inner ring outward
  const segments = 8;
  ctx.lineWidth = size * 0.08;
  ctx.beginPath();
  for (let i = 0; i < segments; i++) {
    const angle = (i * Math.PI * 2) / segments;
    ctx.moveTo(Math.cos(angle) * size * 0.21, Math.sin(angle) * size * 0.21);
    ctx.lineTo(Math.cos(angle) * size * 0.81, Math.sin(angle) * size * 0.81);
  }
  ctx.stroke();

  // Inner concentric ring separator
  ctx.lineWidth = size * 0.065;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  // Central secretory nucleus
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.restore();
}

// 6. Orégano (Oregano): Conical protector claw trichomes and oil pods
function drawOreganoPod(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: Particle,
  config: PatternConfig,
  seasoningId: string
) {
  const size = p.size * (config.zoom / 100) * 1.1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rotation);

  applyFillAndStroke(ctx, seasoningId, p, config);

  // Sharp hooked protection claw trichome path
  ctx.beginPath();
  ctx.moveTo(-size * 0.8, size * 0.4);
  ctx.quadraticCurveTo(0, -size * 0.6, size * 0.8, -size * 0.4);
  ctx.quadraticCurveTo(size * 0.15, size * 0.1, -size * 0.5, size * 0.65);
  ctx.closePath();
  ctx.fill();

  // Companion spherical oil gland pod
  ctx.beginPath();
  ctx.arc(size * 0.4, size * 0.4, size * 0.24, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// clipPolygon + isPointInPolygon now live in src/engine/voronoi.ts (shared with future migrations).

// Scale a polygon inward toward its centroid (factor < 1 shrinks, exposing background between cells)
function insetPoly(poly: [number, number][], factor: number): [number, number][] {
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as [number, number]);
}

// Inset a convex polygon by a fixed pixel distance from every edge.
// Each edge is offset inward by exactly insetPx pixels (perpendicular to the edge),
// then new vertices are computed as intersections of adjacent offset edges.
// This produces constant membrane thickness regardless of cell size or Voronoi depth.
function insetPolyPx(poly: [number, number][], insetPx: number): [number, number][] {
  const n = poly.length;
  if (n < 3 || insetPx <= 0) return poly;

  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= n; cy /= n;

  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[j];
    const edx = x1 - x0;
    const edy = y1 - y0;
    const len = Math.sqrt(edx * edx + edy * edy);
    if (len < 1e-10) {
      lines.push({ px: x0, py: y0, dx: 1, dy: 0 });
      continue;
    }
    let nx = -edy / len;
    let ny = edx / len;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; }
    lines.push({ px: x0 + nx * insetPx, py: y0 + ny * insetPx, dx: edx, dy: edy });
  }

  const result: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[i];
    const l2 = lines[(i + 1) % lines.length];
    const det = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(det) < 1e-10) continue;
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / det;
    result.push([l1.px + t * l1.dx, l1.py + t * l1.dy]);
  }

  return result.length >= 3 ? result : [];
}

// Draw a closed polygon with rounded corners based on control parameter
function drawRoundedPolygon(ctx: CanvasRenderingContext2D, poly: [number, number][], roundedness: number) {
  if (poly.length < 3) return;
  if (roundedness <= 1) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    return;
  }

  const n = poly.length;
  ctx.beginPath();
  
  for (let i = 0; i < n; i++) {
    const pCurr = poly[i];
    const pPrev = poly[(i - 1 + n) % n];
    const pNext = poly[(i + 1) % n];

    const vPrev = [pPrev[0] - pCurr[0], pPrev[1] - pCurr[1]];
    const vNext = [pNext[0] - pCurr[0], pNext[1] - pCurr[1]];

    const dPrev = Math.sqrt(vPrev[0] * vPrev[0] + vPrev[1] * vPrev[1]);
    const dNext = Math.sqrt(vNext[0] * vNext[0] + vNext[1] * vNext[1]);

    // Maximum rounding is 50% of the shortest edge adjacent to this corner
    // Use easing for smoother rounding transition (cubic ease-in)
    const easedRounding = easingRounding(roundedness);
    const rDist = Math.min(dPrev, dNext) * 0.5 * easedRounding;

    const ax = pCurr[0] + (vPrev[0] / dPrev) * rDist;
    const ay = pCurr[1] + (vPrev[1] / dPrev) * rDist;

    const bx = pCurr[0] + (vNext[0] / dNext) * rDist;
    const by = pCurr[1] + (vNext[1] / dNext) * rDist;

    if (i === 0) {
      ctx.moveTo(ax, ay);
    } else {
      ctx.lineTo(ax, ay);
    }
    ctx.quadraticCurveTo(pCurr[0], pCurr[1], bx, by);
  }
  ctx.closePath();
}

// Generate the SVG path with rounded corners for the polygon
function getRoundedPolygonSvgPath(poly: [number, number][], roundedness: number): string {
  if (poly.length < 3) return '';
  if (roundedness <= 1) {
    let d = `M ${poly[0][0].toFixed(1)} ${poly[0][1].toFixed(1)}`;
    for (let i = 1; i < poly.length; i++) {
      d += ` L ${poly[i][0].toFixed(1)} ${poly[i][1].toFixed(1)}`;
    }
    d += ' Z';
    return d;
  }

  const n = poly.length;
  let dPath = '';
  
  for (let i = 0; i < n; i++) {
    const pCurr = poly[i];
    const pPrev = poly[(i - 1 + n) % n];
    const pNext = poly[(i + 1) % n];

    const vPrev = [pPrev[0] - pCurr[0], pPrev[1] - pCurr[1]];
    const vNext = [pNext[0] - pCurr[0], pNext[1] - pCurr[1]];

    const dPrev = Math.sqrt(vPrev[0] * vPrev[0] + vPrev[1] * vPrev[1]);
    const dNext = Math.sqrt(vNext[0] * vNext[0] + vNext[1] * vNext[1]);

    // Use easing for smoother rounding transition (cubic ease-in)
    const easedRounding = easingRounding(roundedness);
    const rDist = Math.min(dPrev, dNext) * 0.5 * easedRounding;

    const ax = pCurr[0] + (vPrev[0] / dPrev) * rDist;
    const ay = pCurr[1] + (vPrev[1] / dPrev) * rDist;

    const bx = pCurr[0] + (vNext[0] / dNext) * rDist;
    const by = pCurr[1] + (vNext[1] / dNext) * rDist;

    if (i === 0) {
      dPath += `M ${ax.toFixed(1)} ${ay.toFixed(1)}`;
    } else {
      dPath += ` L ${ax.toFixed(1)} ${ay.toFixed(1)}`;
    }
    dPath += ` Q ${pCurr[0].toFixed(1)} ${pCurr[1].toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  
  dPath += ' Z';
  return dPath;
}

// Draw louro microscope grid (Voronoi + inside chloroplast stomata)
export function renderLouroMicroscopeGrid(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  config: PatternConfig
) {
  const isDark = config.themeMode === 'dark';
  const oklchConfig = SEASONINGS_OKLCH['louro'] || { l: 0.38, c: 0.18, h: 250, fallback: '#1E40AF' };

  const wallColor = `oklch(${oklchConfig.l * 100}% ${oklchConfig.c} ${oklchConfig.h})`;
  const cellBgColor = isDark ? wallColor : CREAM;

  // Fill canvas with background: light=keyColor, dark=CREAM
  ctx.fillStyle = isDark ? CREAM : wallColor;
  ctx.fillRect(0, 0, W, H);

  // Map cellular density (12 to 60) and zoom (100 to 320) smoothly to cell divisions M
  const density = config.density ?? 40;
  const zm = (config.zoom ?? 100) / 100;
  const M = Math.max(3, Math.min(22, Math.round((density / 3) / zm)));

  const rng = new SeededRandom('louro_microscope_voronoi_' + Math.round(config.layoutSeed ?? 1));
  const jittersX: number[] = [];
  const jittersY: number[] = [];
  for (let d = 0; d < M * M; d++) {
    jittersX.push(rng.range(-0.35, 0.35));
    jittersY.push(rng.range(-0.35, 0.35));
  }

  const getSeed = (gi: number, gj: number) => {
    const iWrap = (gi % M + M) % M;
    const jWrap = (gj % M + M) % M;
    const idx = jWrap * M + iWrap;
    
    const cellW = W / M;
    const cellH = H / M;
    
    const jx = jittersX[idx] * cellW;
    const jy = jittersY[idx] * cellH;
    
    const x = gi * cellW + cellW / 2 + jx;
    const y = gj * cellH + cellH / 2 + jy;
    
    return { x, y };
  };

  const roundedness = config.voronoiRoundedness ?? 35;
  const rotation = config.rotation ?? 0;

  // Anisotropic Voronoi: compute in deformed space, then map back to canvas.
  // Cellular elongation factor 1.6 = visible directional tension along the rotation axis.
  const { toT: toTransformed, fromT: fromTransformed } = createAnisotropicTransform(1.6, rotation);

  // Draw cells over an extended grid area to allow seamless wrapping
  for (let gi = -4; gi <= M + 3; gi++) {
    for (let gj = -4; gj <= M + 3; gj++) {
      const s0_orig = getSeed(gi, gj);
      const s0_t = toTransformed(s0_orig.x, s0_orig.y);

      let poly: [number, number][] = [
        [s0_t.x - W * 3.0, s0_t.y - H * 3.0],
        [s0_t.x + W * 3.0, s0_t.y - H * 3.0],
        [s0_t.x + W * 3.0, s0_t.y + H * 3.0],
        [s0_t.x - W * 3.0, s0_t.y + H * 3.0]
      ];

      for (let u = gi - 2; u <= gi + 2; u++) {
        for (let v = gj - 2; v <= gj + 2; v++) {
          if (u === gi && v === gj) continue;
          const sj_orig = getSeed(u, v);
          const sj_t = toTransformed(sj_orig.x, sj_orig.y);
          poly = clipPolygon(poly, s0_t, sj_t);
        }
      }

      if (poly.length < 3) continue;

      // Map back to original space using inverse transform to stretch and orient
      const finalPoly = poly.map(([px, py]) => fromTransformed(px, py));

      // Identical geometry for both modes — pure color inversion, no topology change
      ctx.save();
      drawRoundedPolygon(ctx, finalPoly, roundedness);
      ctx.fillStyle = cellBgColor;
      ctx.fill();
      ctx.strokeStyle = isDark ? CREAM : wallColor; // bg color as membrane line
      ctx.lineWidth = strokeWidth(config.lineWidth || 2); // absolute pixels, never scales with zoom
      ctx.stroke();
      ctx.restore();
    }
  }
}

// Generate louro SVG Pattern String function
function generateLouroSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchConfig = SEASONINGS_OKLCH['louro'] || { l: 0.38, c: 0.18, h: 250, fallback: '#1E40AF' };

  const keyColorStr = `oklch(${oklchConfig.l * 100}% ${oklchConfig.c} ${oklchConfig.h})`;
  const wallColor = isDark ? CREAM : keyColorStr;   // bg / membrane color
  const cellBgColor = isDark ? keyColorStr : CREAM; // cell fill

  const rotation = config.rotation ?? 0;

  let tileContent = `\n      <rect width="${width}" height="${height}" fill="${wallColor}" />\n  `;

  const density = config.density ?? 40;
  const zm = (config.zoom ?? 100) / 100;
  const M = Math.max(3, Math.min(22, Math.round((density / 3) / zm)));

  const rng = new SeededRandom('louro_microscope_voronoi_' + Math.round(config.layoutSeed ?? 1));
  const jittersX: number[] = [];
  const jittersY: number[] = [];
  for (let d = 0; d < M * M; d++) {
    jittersX.push(rng.range(-0.35, 0.35));
    jittersY.push(rng.range(-0.35, 0.35));
  }

  const getSeed = (gi: number, gj: number) => {
    const iWrap = (gi % M + M) % M;
    const jWrap = (gj % M + M) % M;
    const idx = jWrap * M + iWrap;
    
    const cellW = width / M;
    const cellH = height / M;
    
    const jx = jittersX[idx] * cellW;
    const jy = jittersY[idx] * cellH;
    
    const x = gi * cellW + cellW / 2 + jx;
    const y = gj * cellH + cellH / 2 + jy;
    
    return { x, y };
  };

  const wallWidth = strokeWidth(config.lineWidth || 2).toFixed(1); // absolute pixels, never scales with zoom
  const roundedness = config.voronoiRoundedness ?? 35;

  // Mirror the canvas anisotropy exactly (stretch 1.6).
  const { toT: toTransformed, fromT: fromTransformed } = createAnisotropicTransform(1.6, rotation);

  for (let gi = -4; gi <= M + 3; gi++) {
    for (let gj = -4; gj <= M + 3; gj++) {
      const s0_orig = getSeed(gi, gj);
      const s0_t = toTransformed(s0_orig.x, s0_orig.y);
      
      let poly: [number, number][] = [
        [s0_t.x - width * 3.0, s0_t.y - height * 3.0],
        [s0_t.x + width * 3.0, s0_t.y - height * 3.0],
        [s0_t.x + width * 3.0, s0_t.y + height * 3.0],
        [s0_t.x - width * 3.0, s0_t.y + height * 3.0]
      ];

      for (let u = gi - 2; u <= gi + 2; u++) {
        for (let v = gj - 2; v <= gj + 2; v++) {
          if (u === gi && v === gj) continue;
          const sj_orig = getSeed(u, v);
          const sj_t = toTransformed(sj_orig.x, sj_orig.y);
          poly = clipPolygon(poly, s0_t, sj_t);
        }
      }

      if (poly.length < 3) continue;

      const finalPoly = poly.map(([px, py]) => fromTransformed(px, py));

      const dRoundedPath = getRoundedPolygonSvgPath(finalPoly, roundedness);

      tileContent += `    <path d="${dRoundedPath}" fill="${cellBgColor}" stroke="${wallColor}" stroke-width="${wallWidth}" stroke-linejoin="round" />\n`;
    }
  }

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${tileContent}
</svg>`;

  return svgContent;
}

// Polygon centroid helper
function getPolygonCentroid(poly: [number, number][]): { x: number; y: number } {
  // Thin local alias preserved for now to keep call sites stable; canonical
  // implementation lives in src/engine/voronoi.ts as polygonCentroid.
  return polygonCentroid(poly);
}

// Draw mitosis nucleus inside a cell
function drawMitosisNucleus(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  randVal: number,
  rng: SeededRandom,
  color: string
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(cx, cy);

  if (randVal < 0.85) {
    // Interphase (85%): Organic vacuole nucleus, slightly offset
    const ox = rng.range(-size * 0.05, size * 0.05);
    const oy = rng.range(-size * 0.05, size * 0.05);
    const r = size * rng.range(0.18, 0.22);
    ctx.save();
    ctx.translate(ox, oy);
    pathOrganicVacuole(ctx, r, 7, rng, 0.07);
    ctx.fill();
    ctx.restore();
  } else {
    // Telophase (15%): Two organic daughter nuclei pulling apart
    const dist = size * rng.range(0.20, 0.24);
    const r = size * rng.range(0.11, 0.14);
    ctx.rotate(rng.range(-Math.PI / 6, Math.PI / 6));
    ctx.save(); ctx.translate(-dist, 0);
    pathOrganicVacuole(ctx, r, 7, rng, 0.07);
    ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(dist, 0);
    pathOrganicVacuole(ctx, r, 7, rng, 0.07);
    ctx.fill(); ctx.restore();
  }

  ctx.restore();
}

// Generate mitosis nucleus SVG path elements
function generateMitosisNucleusSvg(
  cx: number,
  cy: number,
  size: number,
  randVal: number,
  rng: SeededRandom,
  color: string
): string {
  let content = '';

  if (randVal < 0.85) {
    const ox = cx + rng.range(-size * 0.05, size * 0.05);
    const oy = cy + rng.range(-size * 0.05, size * 0.05);
    const r = size * rng.range(0.18, 0.22);
    content = `    <path d="${svgOrganicVacuole(ox, oy, r, 7, rng, 0.07)}" fill="${color}" />\n`;
  } else {
    const dist = size * rng.range(0.20, 0.24);
    const r = size * rng.range(0.11, 0.14);
    const tilt = rng.range(-Math.PI / 6, Math.PI / 6);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const x1 = cx - dist * cos;
    const y1 = cy - dist * sin;
    const x2 = cx + dist * cos;
    const y2 = cy + dist * sin;
    content = `    <path d="${svgOrganicVacuole(x1, y1, r, 7, rng, 0.07)}" fill="${color}" />\n`;
    content += `    <path d="${svgOrganicVacuole(x2, y2, r, 7, rng, 0.07)}" fill="${color}" />\n`;
  }

  return content;
}

// Draw garlic microscope grid (mitosis meristem)
export function renderGarlicMicroscopeGrid(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  config: PatternConfig
) {
  const isDark = config.themeMode === 'dark';
  const oklchConfig = SEASONINGS_OKLCH['alho'] || { l: 0.72, c: 0.16, h: 85, fallback: '#D4A010' };

  const wallColor = `oklch(${oklchConfig.l * 100}% ${oklchConfig.c} ${oklchConfig.h})`;
  const cellBgColor = isDark ? wallColor : CREAM;
  const nucleusColor = isDark ? CREAM : wallColor;

  // Fill canvas with background: light=keyColor, dark=CREAM
  ctx.fillStyle = isDark ? CREAM : wallColor;
  ctx.fillRect(0, 0, W, H);

  const density = config.density ?? 40;
  const zm = (config.zoom ?? 100) / 100;
  const M = Math.max(3, Math.min(22, Math.round((density / 3) / zm)));

  const rng = new SeededRandom('garlic_microscope_voronoi_' + Math.round(config.layoutSeed ?? 1));
  const jittersX: number[] = [];
  const jittersY: number[] = [];
  for (let d = 0; d < M * M; d++) {
    jittersX.push(rng.range(-0.32, 0.32));
    jittersY.push(rng.range(-0.32, 0.32));
  }

  const getSeed = (gi: number, gj: number) => {
    const iWrap = (gi % M + M) % M;
    const jWrap = (gj % M + M) % M;
    const idx = jWrap * M + iWrap;
    const cellW = W / M;
    const cellH = H / M;
    const jx = jittersX[idx] * cellW;
    const jy = jittersY[idx] * cellH;
    const x = gi * cellW + cellW / 2 + jx;
    const y = gj * cellH + cellH / 2 + jy;
    return { x, y };
  };

  const roundedness = config.voronoiRoundedness ?? 28;
  const rotation = config.rotation ?? 0;

  // Garlic anisotropy: stretch 1.35 (more isotropic than Louro to keep nuclei readable inside cells).
  const { toT: toTransformed, fromT: fromTransformed } = createAnisotropicTransform(1.35, rotation);

  for (let gi = -4; gi <= M + 3; gi++) {
    for (let gj = -4; gj <= M + 3; gj++) {
      const s0_orig = getSeed(gi, gj);
      const s0_t = toTransformed(s0_orig.x, s0_orig.y);
      let poly: [number, number][] = [
        [s0_t.x - W * 3.0, s0_t.y - H * 3.0],
        [s0_t.x + W * 3.0, s0_t.y - H * 3.0],
        [s0_t.x + W * 3.0, s0_t.y + H * 3.0],
        [s0_t.x - W * 3.0, s0_t.y + H * 3.0]
      ];

      for (let u = gi - 2; u <= gi + 2; u++) {
        for (let v = gj - 2; v <= gj + 2; v++) {
          if (u === gi && v === gj) continue;
          const sj_orig = getSeed(u, v);
          const sj_t = toTransformed(sj_orig.x, sj_orig.y);
          poly = clipPolygon(poly, s0_t, sj_t);
        }
      }

      if (poly.length < 3) continue;

      const finalPoly = poly.map(([px, py]) => fromTransformed(px, py));

      // Identical geometry for both modes — pure color inversion, no topology change
      ctx.save();
      drawRoundedPolygon(ctx, finalPoly, roundedness);
      ctx.fillStyle = cellBgColor;
      ctx.fill();
      ctx.strokeStyle = isDark ? CREAM : wallColor; // bg color as membrane line
      ctx.lineWidth = strokeWidth(config.lineWidth || 2); // absolute pixels, never scales with zoom
      ctx.stroke();
      ctx.restore();

      const centroid = getPolygonCentroid(finalPoly);
      const cellW = W / M;
      const cellH = H / M;
      const localSize = Math.min(cellW, cellH) * 0.95;

      const rngCell = new SeededRandom('garlic_cell_mitosis_' + gi + '_' + gj + '_' + Math.round(config.layoutSeed ?? 1));
      const randVal = rngCell.range(0, 1);

      drawMitosisNucleus(ctx, centroid.x, centroid.y, localSize, randVal, rngCell, nucleusColor);
    }
  }
}

// Generate garlic SVG pattern string
function generateGarlicSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchConfig = SEASONINGS_OKLCH['alho'] || { l: 0.72, c: 0.16, h: 85, fallback: '#D4A010' };

  const keyColorStr = `oklch(${oklchConfig.l * 100}% ${oklchConfig.c} ${oklchConfig.h})`;
  const wallColor = isDark ? CREAM : keyColorStr;   // bg / membrane / stroke color
  const cellBgColor = isDark ? keyColorStr : CREAM; // cell fill
  const nucleusColor = wallColor;                   // nucleus = bg (cutout through cell)
  const bgFillColor = wallColor;                    // canvas background
  const rotation = config.rotation ?? 0;

  let tileContent = `\n      <rect width="${width}" height="${height}" fill="${bgFillColor}" />\n  `;

  const density = config.density ?? 40;
  const zm = (config.zoom ?? 100) / 100;
  const M = Math.max(3, Math.min(22, Math.round((density / 3) / zm)));

  const rng = new SeededRandom('garlic_microscope_voronoi_' + Math.round(config.layoutSeed ?? 1));
  const jittersX: number[] = [];
  const jittersY: number[] = [];
  for (let d = 0; d < M * M; d++) {
    jittersX.push(rng.range(-0.32, 0.32));
    jittersY.push(rng.range(-0.32, 0.32));
  }

  const getSeed = (gi: number, gj: number) => {
    const iWrap = (gi % M + M) % M;
    const jWrap = (gj % M + M) % M;
    const idx = jWrap * M + iWrap;
    const cellW = width / M;
    const cellH = height / M;
    const jx = jittersX[idx] * cellW;
    const jy = jittersY[idx] * cellH;
    const x = gi * cellW + cellW / 2 + jx;
    const y = gj * cellH + cellH / 2 + jy;
    return { x, y };
  };

  const wallWidth = strokeWidth(config.lineWidth || 2).toFixed(1); // absolute pixels, never scales with zoom
  const roundedness = config.voronoiRoundedness ?? 28;

  // Garlic anisotropy: stretch 1.35 (more isotropic than Louro to keep nuclei readable inside cells).
  const { toT: toTransformed, fromT: fromTransformed } = createAnisotropicTransform(1.35, rotation);

  for (let gi = -4; gi <= M + 3; gi++) {
    for (let gj = -4; gj <= M + 3; gj++) {
      const s0_orig = getSeed(gi, gj);
      const s0_t = toTransformed(s0_orig.x, s0_orig.y);
      let poly: [number, number][] = [
        [s0_t.x - width * 3.0, s0_t.y - height * 3.0],
        [s0_t.x + width * 3.0, s0_t.y - height * 3.0],
        [s0_t.x + width * 3.0, s0_t.y + height * 3.0],
        [s0_t.x - width * 3.0, s0_t.y + height * 3.0]
      ];

      for (let u = gi - 2; u <= gi + 2; u++) {
        for (let v = gj - 2; v <= gj + 2; v++) {
          if (u === gi && v === gj) continue;
          const sj_orig = getSeed(u, v);
          const sj_t = toTransformed(sj_orig.x, sj_orig.y);
          poly = clipPolygon(poly, s0_t, sj_t);
        }
      }

      if (poly.length < 3) continue;

      const finalPoly = poly.map(([px, py]) => fromTransformed(px, py));
      const dRoundedPath = getRoundedPolygonSvgPath(finalPoly, roundedness);

      tileContent += `    <path d="${dRoundedPath}" fill="${cellBgColor}" stroke="${wallColor}" stroke-width="${wallWidth}" stroke-linejoin="round" />\n`;

      const centroid = getPolygonCentroid(finalPoly);
      const cellW = width / M;
      const cellH = height / M;
      const localSize = Math.min(cellW, cellH) * 0.95;

      const rngCell = new SeededRandom('garlic_cell_mitosis_' + gi + '_' + gj + '_' + Math.round(config.layoutSeed ?? 1));
      const randVal = rngCell.range(0, 1);

      tileContent += generateMitosisNucleusSvg(centroid.x, centroid.y, localSize, randVal, rngCell, nucleusColor);
    }
  }

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${tileContent}
</svg>`;

  return svgContent;
}

// ─── Pimenta micro-particles: organic granules inside cells ──────────────────

// calculatePolygonArea was identical to engine/voronoi.ts polygonArea —
// kept as a thin alias to preserve call-site stability during refactor.
const calculatePolygonArea = polygonArea;

// Inset a polygon inward toward its centroid (factor < 1 shrinks)
function insetPolygonForParticles(poly: [number, number][], factor: number): [number, number][] {
  if (poly.length < 3) return [];
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as [number, number]);
}

// Generate particles inside a polygon using rejection sampling with Poisson-disc spacing
function generateParticlesInPolygon(
  poly: [number, number][],
  cellArea: number,
  rng: SeededRandom
): { x: number; y: number; r: number }[] {
  // Determine particle count based on area
  let targetCount: number;
  if (cellArea < 200) {
    targetCount = rng.range(1, 4); // tiny cells: 1-3
  } else if (cellArea < 800) {
    targetCount = rng.range(4, 9); // medium cells: 4-8
  } else {
    targetCount = rng.range(9, 17); // large cells: 9-16
  }

  // Calculate inset factor based on cell size (~20% inward padding)
  // Larger cells get slightly less inset (more usable space for particles)
  const insetFactor = cellArea < 200 ? 0.75 : cellArea < 800 ? 0.80 : 0.82;

  // Create inset polygon (safe region for particle placement)
  const insetPoly = insetPolygonForParticles(poly, insetFactor);
  if (insetPoly.length < 3) return [];

  // Find bounding box of inset polygon
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of insetPoly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const particles: { x: number; y: number; r: number }[] = [];
  const minSpacing = 12; // Poisson-disc minimum spacing between particles (in pixels)
  const maxAttempts = targetCount * 100;
  let attempts = 0;

  while (particles.length < targetCount && attempts < maxAttempts) {
    attempts++;

    // Random point inside inset bounding box
    const x = rng.range(minX, maxX);
    const y = rng.range(minY, maxY);

    // Check if inside inset polygon
    if (!isPointInPolygon(x, y, insetPoly)) continue;

    // Determine particle size first
    let r: number;
    const sizeRoll = rng.range(0, 1);
    if (sizeRoll < 0.70) {
      r = rng.range(0.8, 2.0); // tiny: 70%
    } else if (sizeRoll < 0.95) {
      r = rng.range(2.0, 4.0); // medium: 25%
    } else {
      r = rng.range(4.0, 6.0); // large: 5%
    }

    // Check spacing from existing particles (including radius)
    let tooClose = false;
    for (const p of particles) {
      const dx = p.x - x;
      const dy = p.y - y;
      const minDist = minSpacing + r + p.r; // spacing + both radii
      if (dx * dx + dy * dy < minDist * minDist) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Check distance from inset polygon boundary (particle radius must not exceed boundary)
    let nearBoundary = false;
    const boundaryCheckDist = r + 2; // small buffer beyond radius
    for (let i = 0; i < insetPoly.length; i++) {
      const p1 = insetPoly[i];
      const p2 = insetPoly[(i + 1) % insetPoly.length];
      // Simple line-to-point distance check
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 0.01) continue; // skip degenerate edges
      const t = Math.max(0, Math.min(1, ((x - p1[0]) * dx + (y - p1[1]) * dy) / lenSq));
      const closestX = p1[0] + t * dx;
      const closestY = p1[1] + t * dy;
      const distSq = (x - closestX) ** 2 + (y - closestY) ** 2;
      if (distSq < boundaryCheckDist * boundaryCheckDist) {
        nearBoundary = true;
        break;
      }
    }
    if (nearBoundary) continue;

    particles.push({ x, y, r });
  }

  return particles;
}

// Pimenta microscope grid — variable-density Voronoi (optical cross-section: large + small cells mixed)
export function renderPimentaMicroscopeGrid(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  config: PatternConfig
) {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['pimenta'];

  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;

  // Light: key-color bg + cream cells. Dark: cream bg + key-color cells.
  ctx.fillStyle = isDark ? CREAM : keyColor;
  ctx.fillRect(0, 0, W, H);

  const density = config.density ?? 40;
  const zm = (config.zoom ?? 100) / 100;
  const M = Math.max(3, Math.min(11, Math.round((density * 0.45) / zm)));
  const roundedness = config.voronoiRoundedness ?? 42;
  const rng = new SeededRandom('pimenta_multiscale_v2_' + Math.round(config.layoutSeed ?? 1));

  // Pepper anisotropy: stretch 1.22 (subtle elongation — Voronoi distance metric only;
  // canvas and tile boundaries never rotate, mirroring Louro/Alho).
  const { toT, fromT } = createAnisotropicTransform(1.22, config.rotation ?? 0);

  // Seeds in canvas space with small padding to keep edge cells complete
  const pad = 0.12;
  const seeds: {x: number, y: number}[] = [];

  // Sparse layer: large bubble cells
  const sparseCount = Math.max(4, Math.round(M * M * 0.20));
  for (let i = 0; i < sparseCount; i++) {
    seeds.push({ x: rng.range(-pad, 1 + pad) * W, y: rng.range(-pad, 1 + pad) * H });
  }

  // Clustered layer: dense small-cell regions
  const clusterCount = Math.max(2, Math.round(M * 0.85));
  const clusterR = Math.min(W, H) / M * 0.5;
  for (let c = 0; c < clusterCount; c++) {
    const cx = rng.range(pad, 1 - pad) * W;
    const cy = rng.range(pad, 1 - pad) * H;
    const n = Math.round(rng.range(4, 11));
    const r = clusterR * rng.range(0.55, 1.15);
    for (let s = 0; s < n; s++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, r);
      seeds.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d });
    }
  }

  // Voronoi computed in anisotropic (transformed) coordinate space
  const N = seeds.length;
  const big = Math.max(W, H) * 4;
  const cellPolys: [number, number][][] = [];

  for (let i = 0; i < N; i++) {
    const s0_t = toT(seeds[i].x, seeds[i].y);
    let poly: [number, number][] = [
      [s0_t.x - big, s0_t.y - big],
      [s0_t.x + big, s0_t.y - big],
      [s0_t.x + big, s0_t.y + big],
      [s0_t.x - big, s0_t.y + big],
    ];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const sj_t = toT(seeds[j].x, seeds[j].y);
      poly = clipPolygon(poly, s0_t, sj_t);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;

    // Map polygon back to canvas coordinates
    const finalPoly = poly.map(([px, py]) => fromT(px, py));

    // Discard cells fully outside the canvas
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of finalPoly) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    if (maxX < 0 || minX > W || maxY < 0 || minY > H) continue;

    cellPolys.push(finalPoly);
  }

  const wallThick = strokeWidth(config.lineWidth || 2); // absolute pixels, never scales with zoom
  const particleRng = new SeededRandom('pimenta_particles_v1_' + Math.round(config.layoutSeed ?? 1));

  // Identical geometry for both modes — fill then stroke with bg color, only colors change
  ctx.fillStyle = isDark ? keyColor : CREAM;
  for (const poly of cellPolys) {
    if (poly.length < 3) continue;
    drawRoundedPolygon(ctx, poly, roundedness);
    ctx.fill();
  }
  ctx.strokeStyle = isDark ? CREAM : keyColor; // bg color as membrane line
  ctx.lineWidth = wallThick;
  ctx.lineJoin = 'round';
  for (const poly of cellPolys) {
    drawRoundedPolygon(ctx, poly, roundedness);
    ctx.stroke();
  }

  // Render micro-particles inside each cell
  // Particle color: opposite of cell fill (orange in light, cream in dark)
  const particleColor = isDark ? CREAM : keyColor;
  ctx.fillStyle = particleColor;

  for (const poly of cellPolys) {
    if (poly.length < 3) continue;
    const area = calculatePolygonArea(poly);
    const particles = generateParticlesInPolygon(poly, area, particleRng);

    for (const particle of particles) {
      ctx.save();
      ctx.translate(particle.x, particle.y);
      // Organic blob for particle (similar to vacuole, but smaller and with 5 control points)
      pathOrganicVacuole(ctx, particle.r, 5, particleRng, 0.06);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ─── Oregano: clustered spore capsule renderer ──────────────────────────────

// Build 8 control points for an organic oval capsule (shared by canvas + SVG)
function buildOrganicCapsulePts(
  cx: number, cy: number, halfH: number, halfW: number,
  rotation: number, shapeRng: SeededRandom
): [number, number][] {
  const N = 8;
  const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const angle = (i * Math.PI * 2) / N;
    const rh = halfH * (1 + shapeRng.range(-0.10, 0.10));
    const rw = halfW * (1 + shapeRng.range(-0.10, 0.10));
    const lx = Math.cos(angle) * rw, ly = Math.sin(angle) * rh;
    pts.push([cx + lx * cosR - ly * sinR, cy + lx * sinR + ly * cosR]);
  }
  return pts;
}

function pathOrganicCapsuleCanvas(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  const N = pts.length;
  ctx.beginPath();
  ctx.moveTo((pts[N - 1][0] + pts[0][0]) / 2, (pts[N - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2);
  }
  ctx.closePath();
}

function svgOrganicCapsulePath(pts: [number, number][]): string {
  const N = pts.length;
  let d = `M ${((pts[N-1][0]+pts[0][0])/2).toFixed(1)} ${((pts[N-1][1]+pts[0][1])/2).toFixed(1)}`;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const mx = ((pts[i][0]+pts[j][0])/2).toFixed(1);
    const my = ((pts[i][1]+pts[j][1])/2).toFixed(1);
    d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx} ${my}`;
  }
  return d + ' Z';
}

type OreganoSpore = { x: number; y: number; halfH: number; halfW: number; rot: number; idx: number };

// Clustered Poisson-disc scatter — same seed produces identical positions in canvas + SVG
function generateOreganoSporePositions(W: number, H: number, config: PatternConfig): OreganoSpore[] {
  const density = config.density ?? 30;
  const zm = (config.zoom ?? 100) / 100;
  const globalAngle = ((config.rotation ?? 0) * Math.PI) / 180;
  const rng = new SeededRandom('oregano_spore_v1_' + Math.round(config.layoutSeed ?? 1));

  const baseH = Math.min(W, H) * 0.046 * zm;
  const minDist = baseH * 1.1;
  const targetCount = Math.max(8, Math.round((density * 2.5) / Math.max(0.5, zm)));

  // Grid for O(1) Poisson-disc neighbor checks, offset so negative coords are valid
  const offX = minDist * 2, offY = minDist * 2;
  const cellSize = minDist / Math.SQRT2;
  const gW = Math.ceil((W + offX * 2) / cellSize) + 1;
  const gH = Math.ceil((H + offY * 2) / cellSize) + 1;
  const grid: ({ x: number; y: number } | null)[] = new Array(gW * gH).fill(null);

  const gIdx = (x: number, y: number) => {
    const gx = Math.min(gW - 1, Math.max(0, Math.floor((x + offX) / cellSize)));
    const gy = Math.min(gH - 1, Math.max(0, Math.floor((y + offY) / cellSize)));
    return gy * gW + gx;
  };

  const isValid = (px: number, py: number) => {
    const gx = Math.floor((px + offX) / cellSize);
    const gy = Math.floor((py + offY) / cellSize);
    for (let i = Math.max(0, gx - 2); i <= Math.min(gW - 1, gx + 2); i++) {
      for (let j = Math.max(0, gy - 2); j <= Math.min(gH - 1, gy + 2); j++) {
        const n = grid[j * gW + i];
        if (n) {
          const dx = px - n.x, dy = py - n.y;
          if (dx * dx + dy * dy < minDist * minDist) return false;
        }
      }
    }
    return true;
  };

  const spores: OreganoSpore[] = [];
  const addSpore = (px: number, py: number): boolean => {
    if (!isValid(px, py)) return false;
    const halfH = baseH * rng.range(0.70, 1.30);
    const aspect = rng.range(0.48, 0.78);
    const rot = globalAngle + rng.range(-25, 25) * (Math.PI / 180);
    spores.push({ x: px, y: py, halfH, halfW: halfH * aspect, rot, idx: spores.length });
    grid[gIdx(px, py)] = { x: px, y: py };
    return true;
  };

  // Place 2-4 cluster centers, then scatter around them
  const nClusters = 2 + Math.floor(rng.range(0, 2.9));
  const clusters: { x: number; y: number }[] = [];
  for (let c = 0; c < nClusters; c++) {
    const cx = rng.range(0.15, 0.85) * W;
    const cy = rng.range(0.15, 0.85) * H;
    clusters.push({ x: cx, y: cy });
    addSpore(cx, cy);
  }

  let attempts = 0;
  while (spores.length < targetCount && attempts < targetCount * 50) {
    attempts++;
    const cc = clusters[Math.floor(rng.range(0, clusters.length))];
    const spread = Math.min(W, H) * rng.range(0.08, 0.46);
    const a = rng.range(0, Math.PI * 2);
    addSpore(cc.x + Math.cos(a) * spread * rng.range(0, 1), cc.y + Math.sin(a) * spread * rng.range(0, 1));
  }

  return spores;
}

export function renderOreganoMicroscopeGrid(
  ctx: CanvasRenderingContext2D, W: number, H: number, config: PatternConfig
) {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['oregano'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;

  // Light: keyColor bg + CREAM capsules. Dark: CREAM bg + keyColor capsules.
  ctx.fillStyle = isDark ? CREAM : keyColor;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = isDark ? keyColor : CREAM;

  const layoutSeed = Math.round(config.layoutSeed ?? 1);
  for (const s of generateOreganoSporePositions(W, H, config)) {
    const shapeRng = new SeededRandom('oregano_blob_' + s.idx + '_' + layoutSeed);
    pathOrganicCapsuleCanvas(ctx, buildOrganicCapsulePts(s.x, s.y, s.halfH, s.halfW, s.rot, shapeRng));
    ctx.fill();
  }
}

// ─── Manjericão (Basil) microscopy: chloroplast tissue + glandular trichomes ─

// Shared organic blob points generator (consumed by canvas + SVG)
function buildOrganicBlobPoints(
  cx: number, cy: number, radiusX: number, radiusY: number,
  pointsCount: number, seedStr: string, dentFactor: number
): { x: number; y: number }[] {
  const rng = new SeededRandom(seedStr);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < pointsCount; i++) {
    const angle = (i * Math.PI * 2) / pointsCount;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const baseR = Math.sqrt(1 / ((cos * cos) / (radiusX * radiusX) + (sin * sin) / (radiusY * radiusY)));
    const wave = rng.range(1 - dentFactor, 1 + dentFactor);
    pts.push({ x: cx + baseR * wave * cos, y: cy + baseR * wave * sin });
  }
  return pts;
}

// Canvas: trace blob from shared points
function pathFromBlobPoints(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 3) return;
  ctx.beginPath();
  ctx.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
  }
  ctx.closePath();
}

// SVG: build path string from shared points
function svgFromBlobPoints(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n < 3) return '';
  let d = `M ${((pts[n - 1].x + pts[0].x) / 2).toFixed(1)} ${((pts[n - 1].y + pts[0].y) / 2).toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    d += ` Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${((curr.x + next.x) / 2).toFixed(1)} ${((curr.y + next.y) / 2).toFixed(1)}`;
  }
  return d + ' Z';
}

// Build sampled circle "beads" along a curved trichome filament path
function buildTrichomeSamples(
  startX: number, startY: number,
  endX: number, endY: number,
  bendAmount: number,
  rng: SeededRandom,
  thickness: number
): { x: number; y: number; r: number }[] {
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return [];
  // Perpendicular direction for bend offset
  const perpX = -dy / len;
  const perpY = dx / len;
  // Two cubic Bezier control points with slight twist
  const c1x = startX + dx * 0.33 + perpX * bendAmount;
  const c1y = startY + dy * 0.33 + perpY * bendAmount;
  const c2x = startX + dx * 0.66 + perpX * bendAmount * 0.6;
  const c2y = startY + dy * 0.66 + perpY * bendAmount * 0.6;

  const samples = Math.max(8, Math.round(len / 10));
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const mt = 1 - t;
    const bx = mt * mt * mt * startX + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * endX;
    const by = mt * mt * mt * startY + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * endY;
    // Tapered thickness: thicker in middle, slimmer at tips (sin envelope)
    const env = Math.sin(t * Math.PI);
    const r = (thickness * 0.35 + env * thickness * 0.65) * rng.range(0.82, 1.18);
    out.push({ x: bx, y: by, r });
  }
  return out;
}

// Layout primitives (shared canvas + SVG geometry)
interface BasilLayout {
  membranes: { cx: number; cy: number; rx: number; ry: number; seed: string; points: number }[];
  chloroplasts: { x: number; y: number; rx: number; ry: number; seed: string; points: number }[];
  grains: { x: number; y: number; r: number; seed: string }[];
  trichomes: { startX: number; startY: number; endX: number; endY: number; bendAmount: number; thickness: number; seed: string }[];
  microParticles: { x: number; y: number; r: number }[];
}

function generateBasilLayout(W: number, H: number, config: PatternConfig): BasilLayout {
  const seed = Math.round(config.layoutSeed ?? 1);
  const rng = new SeededRandom('basil_layout_v2_' + seed);
  const density = config.density ?? 16;
  // sqrt-scaling: prevents shape sizes from exploding at high zoom (1200x)
  // while still growing organically with magnification
  const zm = (config.zoom ?? 100) / 100;
  const zScale = Math.sqrt(Math.max(0.4, zm));
  const minDim = Math.min(W, H);

  // Step 1: biomass density centers (multi-scale uneven tissue distribution)
  const nClusters = 4 + Math.floor(rng.range(0, 5));
  const clusters: { cx: number; cy: number; r: number }[] = [];
  for (let i = 0; i < nClusters; i++) {
    clusters.push({
      cx: rng.range(-0.1, 1.1) * W, // allow off-canvas to break tile pattern
      cy: rng.range(-0.1, 1.1) * H,
      r: rng.range(0.15, 0.42) * minDim,
    });
  }

  // Helper: place a point biased toward a cluster (Gaussian-ish denser core)
  const samplePoint = (clusterBias: number): { x: number; y: number } => {
    if (rng.range(0, 1) < clusterBias) {
      const c = clusters[Math.floor(rng.range(0, clusters.length))];
      const a = rng.range(0, Math.PI * 2);
      const d = c.r * Math.sqrt(rng.range(0, 1));
      return { x: c.cx + Math.cos(a) * d, y: c.cy + Math.sin(a) * d };
    }
    return { x: rng.range(0, W), y: rng.range(0, H) };
  };

  // Step 2: amorphous membrane outlines (thin stroked ghosts — many overlapping)
  const nMembranes = 10 + Math.floor(rng.range(0, density * 0.6));
  const membranes: BasilLayout['membranes'] = [];
  for (let i = 0; i < nMembranes; i++) {
    const pos = samplePoint(0.55);
    // Multi-scale: 30% tiny, 50% medium, 20% large — like real cell walls
    const sizeRoll = rng.range(0, 1);
    let sizeBase: number;
    if (sizeRoll < 0.30) sizeBase = rng.range(0.035, 0.060);
    else if (sizeRoll < 0.80) sizeBase = rng.range(0.060, 0.110);
    else sizeBase = rng.range(0.110, 0.180);
    const baseR = sizeBase * minDim * zScale;
    membranes.push({
      cx: pos.x,
      cy: pos.y,
      rx: baseR * rng.range(0.75, 1.30),
      ry: baseR * rng.range(0.75, 1.30),
      seed: 'basil_mem_' + i + '_' + seed,
      points: 14 + Math.floor(rng.range(0, 9)),
    });
  }

  // Step 3: medium chloroplast cluster blobs (filled, biased to dense tissue)
  const nChloroplasts = Math.round(density * 2.5);
  const chloroplasts: BasilLayout['chloroplasts'] = [];
  for (let i = 0; i < nChloroplasts; i++) {
    const pos = samplePoint(0.82);
    // Mixed sizes: mostly small, some medium, rare larger
    const sizeRoll = rng.range(0, 1);
    let baseR: number;
    if (sizeRoll < 0.60) baseR = rng.range(0.012, 0.025) * minDim * zScale;
    else if (sizeRoll < 0.92) baseR = rng.range(0.025, 0.045) * minDim * zScale;
    else baseR = rng.range(0.045, 0.075) * minDim * zScale;
    chloroplasts.push({
      x: pos.x,
      y: pos.y,
      rx: baseR * rng.range(0.85, 1.20),
      ry: baseR * rng.range(0.85, 1.20),
      seed: 'basil_cl_' + i + '_' + seed,
      points: 8 + Math.floor(rng.range(0, 5)),
    });
  }

  // Step 4: small chloroplast grains (dense filled dots heavily biased to clusters)
  const nGrains = Math.round(density * 45);
  const grains: BasilLayout['grains'] = [];
  for (let i = 0; i < nGrains; i++) {
    const pos = samplePoint(0.90);
    grains.push({
      x: pos.x,
      y: pos.y,
      r: rng.range(1.2, 4.0) * zScale,
      seed: 'basil_g_' + i + '_' + seed,
    });
  }

  // Step 5: trichome filaments (curved organic hairs, internal anisotropy bias)
  const nTrichomes = 5 + Math.floor(density / 3);
  const trichomes: BasilLayout['trichomes'] = [];
  // Rotation = directional bias for filament flow (0–180° axis, not canvas rotation)
  const rotBase = ((config.rotation ?? 0) * Math.PI) / 180;
  for (let i = 0; i < nTrichomes; i++) {
    const start = samplePoint(0.55);
    const len = rng.range(0.06, 0.22) * minDim * zScale;
    // Bidirectional: 0–180° is an axis, so we flip half the trichomes
    const flip = rng.range(0, 1) < 0.5 ? 0 : Math.PI;
    const angle = rotBase + flip + rng.range(-0.7, 0.7);
    const endX = start.x + Math.cos(angle) * len;
    const endY = start.y + Math.sin(angle) * len;
    const bendAmount = rng.range(-0.35, 0.35) * len;
    trichomes.push({
      startX: start.x,
      startY: start.y,
      endX, endY,
      bendAmount,
      thickness: rng.range(1.8, 4.5) * zScale,
      seed: 'basil_t_' + i + '_' + seed,
    });
  }

  // Step 6: micro suspended particles (background biological noise, dense)
  const nMicro = Math.round(density * 55);
  const microParticles: BasilLayout['microParticles'] = [];
  for (let i = 0; i < nMicro; i++) {
    const pos = samplePoint(0.4);
    microParticles.push({
      x: pos.x,
      y: pos.y,
      r: rng.range(0.30, 1.0) * zScale,
    });
  }

  return { membranes, chloroplasts, grains, trichomes, microParticles };
}

export function renderManjericaoMicroscopeGrid(
  ctx: CanvasRenderingContext2D, W: number, H: number, config: PatternConfig
) {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['manjericao'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  // Theme: LIGHT bg=keyColor + structures=cream; DARK bg=cream + structures=keyColor
  const bgColor = isDark ? CREAM : keyColor;
  const shapeColor = isDark ? keyColor : CREAM;

  // Solid background fill
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  const layout = generateBasilLayout(W, H, config);
  const seed = Math.round(config.layoutSeed ?? 1);

  // Layer 1: Amorphous membrane outlines (thin stroke only — translucent ghost membranes)
  ctx.strokeStyle = shapeColor;
  ctx.lineWidth = strokeWidth(config.lineWidth || 1.5); // absolute pixels, consistent across all spices
  ctx.lineJoin = 'round';
  for (const m of layout.membranes) {
    const pts = buildOrganicBlobPoints(m.cx, m.cy, m.rx, m.ry, m.points, m.seed, 0.28);
    pathFromBlobPoints(ctx, pts);
    ctx.stroke();
  }

  // Layer 2: Medium chloroplast clusters (filled organic blobs)
  ctx.fillStyle = shapeColor;
  for (const c of layout.chloroplasts) {
    const pts = buildOrganicBlobPoints(c.x, c.y, c.rx, c.ry, c.points, c.seed, 0.22);
    pathFromBlobPoints(ctx, pts);
    ctx.fill();
  }

  // Layer 3: Trichome filaments (curved organic hairs as bead sequence)
  for (const t of layout.trichomes) {
    const triRng = new SeededRandom(t.seed);
    const samples = buildTrichomeSamples(t.startX, t.startY, t.endX, t.endY, t.bendAmount, triRng, t.thickness);
    for (const s of samples) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Layer 4: Small chloroplast grains (filled organic vacuoles)
  for (const g of layout.grains) {
    const grainRng = new SeededRandom(g.seed);
    ctx.save();
    ctx.translate(g.x, g.y);
    pathOrganicVacuole(ctx, g.r, 6, grainRng, 0.18);
    ctx.fill();
    ctx.restore();
  }

  // Layer 5: Suspended micro-particles (tiny dots — biological noise)
  for (const p of layout.microParticles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  void seed; // (silence: seed reserved for future deterministic per-layer noise)
}

// Manjericão SVG — mirrors renderManjericaoMicroscopeGrid exactly
function generateManjericaoSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['manjericao'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  const bgColor = isDark ? CREAM : keyColor;
  const shapeColor = isDark ? keyColor : CREAM;
  const strokeW = strokeWidth(config.lineWidth || 1.5).toFixed(2); // absolute pixels, consistent across all spices

  let content = `\n      <rect width="${width}" height="${height}" fill="${bgColor}" />\n  `;

  const layout = generateBasilLayout(width, height, config);

  // Layer 1: membrane outlines (stroke only)
  for (const m of layout.membranes) {
    const pts = buildOrganicBlobPoints(m.cx, m.cy, m.rx, m.ry, m.points, m.seed, 0.28);
    const d = svgFromBlobPoints(pts);
    if (d) content += `    <path d="${d}" fill="none" stroke="${shapeColor}" stroke-width="${strokeW}" stroke-linejoin="round" />\n`;
  }

  // Layer 2: medium chloroplast clusters (filled)
  for (const c of layout.chloroplasts) {
    const pts = buildOrganicBlobPoints(c.x, c.y, c.rx, c.ry, c.points, c.seed, 0.22);
    const d = svgFromBlobPoints(pts);
    if (d) content += `    <path d="${d}" fill="${shapeColor}" />\n`;
  }

  // Layer 3: trichome filaments (bead sequences)
  for (const t of layout.trichomes) {
    const triRng = new SeededRandom(t.seed);
    const samples = buildTrichomeSamples(t.startX, t.startY, t.endX, t.endY, t.bendAmount, triRng, t.thickness);
    for (const s of samples) {
      content += `    <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r.toFixed(2)}" fill="${shapeColor}" />\n`;
    }
  }

  // Layer 4: small grains (organic vacuoles)
  for (const g of layout.grains) {
    const grainRng = new SeededRandom(g.seed);
    const d = svgOrganicVacuole(g.x, g.y, g.r, 6, grainRng, 0.18);
    content += `    <path d="${d}" fill="${shapeColor}" />\n`;
  }

  // Layer 5: micro-particles (tiny dots)
  for (const p of layout.microParticles) {
    content += `    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(2)}" fill="${shapeColor}" />\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${content}</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────

// Master pattern tile generator
export function renderPatternTile(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seasoning: Seasoning,
  config: PatternConfig
) {
  if (seasoning.id === 'louro') {
    renderLouroMicroscopeGrid(ctx, width, height, config);
    return;
  }

  if (seasoning.id === 'alho') {
    renderGarlicMicroscopeGrid(ctx, width, height, config);
    return;
  }

  if (seasoning.id === 'pimenta') {
    renderPimentaMicroscopeGrid(ctx, width, height, config);
    return;
  }

  if (seasoning.id === 'oregano') {
    renderOreganoMicroscopeGrid(ctx, width, height, config);
    return;
  }

  if (seasoning.id === 'manjericao') {
    renderManjericaoMicroscopeGrid(ctx, width, height, config);
    return;
  }

  ctx.save();

  // Background: light=keyColor, dark=CREAM
  const isDark = config.themeMode === 'dark';
  ctx.fillStyle = getThemeColors(seasoning.id, isDark).bg;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();

  // Draw the deterministic particle network
  const count = Math.round(config.density);
  const particles = generateParticles(seasoning.id, count, width, height, config.layoutSeed ?? 1);

  // Draw seamless wrapped blobs
  const drawParticleWithWrap = (p: Particle) => {
    const drawFn = (x: number, y: number) => {
      switch (seasoning.particleType) {
        case 'crystal_cube':
          drawSaltCrystal(ctx, x, y, p, config, seasoning.id);
          break;
        case 'extended_leaf_cell':
          drawLouroCell(ctx, x, y, p, config, seasoning.id);
          break;
        case 'concentric_bulb_starch':
          drawGarlicConcentric(ctx, x, y, p, config, seasoning.id);
          break;
        case 'fiery_droplet_spike':
          drawPimentaSpikes(ctx, x, y, p, config, seasoning.id);
          break;
        case 'glandular_basil_hair':
          drawManjericaoGlandular(ctx, x, y, p, config, seasoning.id);
          break;
        case 'oregano_pollen_pod':
          drawOreganoPod(ctx, x, y, p, config, seasoning.id);
          break;
      }
    };

    // Main coordinate
    drawFn(p.x, p.y);

    // Seamless edges wrapped repeating checks
    const margin = p.size * (config.zoom / 100) * 3;
    const offsetsX = [0];
    const offsetsY = [0];

    if (p.x < margin) offsetsX.push(width);
    if (p.x > width - margin) offsetsX.push(-width);
    if (p.y < margin) offsetsY.push(height);
    if (p.y > height - margin) offsetsY.push(-height);

    for (const dx of offsetsX) {
      for (const dy of offsetsY) {
        if (dx !== 0 || dy !== 0) {
          drawFn(p.x + dx, p.y + dy);
        }
      }
    }
  };

  // Render all organic cell nodes cleanly with 100% solid flat opacity
  ctx.save();
  particles.forEach((p) => {
    drawParticleWithWrap(p);
  });
  ctx.restore();

  // Draw camera grain sensor noise overlay
  if (config.noise > 0) {
    ctx.save();
    const noiseImg = ctx.createImageData(width, height);
    const data = noiseImg.data;
    const noiseStrength = config.noise * 0.22;

    for (let i = 0; i < data.length; i += 4) {
      const grain = Math.random() * noiseStrength;
      data[i] = isDark ? 0 : 255;
      data[i + 1] = isDark ? 0 : 255;
      data[i + 2] = isDark ? 0 : 255;
      data[i + 3] = grain;
    }
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    tempCanvas.getContext('2d')?.putImageData(noiseImg, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();
  }
}

// Render composite Combined Mural containing all 6 seasonings in a patchwork
export function renderCombinedMural(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seasonings: Seasoning[],
  config: PatternConfig
) {
  const patchW = width / 3;
  const patchH = height / 2;

  seasonings.forEach((seasoning, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const startX = col * patchW;
    const startY = row * patchH;

    ctx.save();
    ctx.beginPath();
    ctx.rect(startX, startY, patchW, patchH);
    ctx.clip();

    ctx.translate(startX, startY);

    renderPatternTile(ctx, patchW, patchH, seasoning, {
      ...config,
      density: config.density * 0.5,
      zoom: config.zoom * 0.95,
    });

    // Draw quadrant boundaries
    ctx.strokeStyle = config.themeMode === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, patchW, patchH);

    ctx.restore();
  });
}
// Generate Pimenta SVG — mirrors renderPimentaMicroscopeGrid exactly (same seeds, same Voronoi, same insetPolyPx)
function generatePimentaSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['pimenta'];

  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;

  const W = width, H = height;
  let tileContent = `\n      <rect width="${W}" height="${H}" fill="${isDark ? CREAM : keyColor}" />\n  `;

  const density = config.density ?? 40;
  const zm = (config.zoom ?? 100) / 100;
  const M = Math.max(3, Math.min(11, Math.round((density * 0.45) / zm)));
  const roundedness = config.voronoiRoundedness ?? 42;
  const rng = new SeededRandom('pimenta_multiscale_v2_' + Math.round(config.layoutSeed ?? 1));

  // Mirror the canvas anisotropy exactly (stretch 1.22).
  const { toT, fromT } = createAnisotropicTransform(1.22, config.rotation ?? 0);

  const pad = 0.12;
  const seeds: { x: number; y: number }[] = [];

  const sparseCount = Math.max(4, Math.round(M * M * 0.20));
  for (let i = 0; i < sparseCount; i++) {
    seeds.push({ x: rng.range(-pad, 1 + pad) * W, y: rng.range(-pad, 1 + pad) * H });
  }

  const clusterCount = Math.max(2, Math.round(M * 0.85));
  const clusterR = Math.min(W, H) / M * 0.5;
  for (let c = 0; c < clusterCount; c++) {
    const cx2 = rng.range(pad, 1 - pad) * W;
    const cy2 = rng.range(pad, 1 - pad) * H;
    const n = Math.round(rng.range(4, 11));
    const r = clusterR * rng.range(0.55, 1.15);
    for (let s = 0; s < n; s++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, r);
      seeds.push({ x: cx2 + Math.cos(a) * d, y: cy2 + Math.sin(a) * d });
    }
  }

  const N = seeds.length;
  const big = Math.max(W, H) * 4;
  const cellPolys: [number, number][][] = [];

  for (let i = 0; i < N; i++) {
    const s0_t = toT(seeds[i].x, seeds[i].y);
    let poly: [number, number][] = [
      [s0_t.x - big, s0_t.y - big],
      [s0_t.x + big, s0_t.y - big],
      [s0_t.x + big, s0_t.y + big],
      [s0_t.x - big, s0_t.y + big],
    ];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      poly = clipPolygon(poly, s0_t, toT(seeds[j].x, seeds[j].y));
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;

    const finalPoly = poly.map(([px, py]) => fromT(px, py));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of finalPoly) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    if (maxX < 0 || minX > W || maxY < 0 || minY > H) continue;
    cellPolys.push(finalPoly);
  }

  const wallThick = strokeWidth(config.lineWidth || 2).toFixed(1); // absolute pixels, never scales with zoom
  const particleRng = new SeededRandom('pimenta_particles_v1_' + Math.round(config.layoutSeed ?? 1));

  for (const poly of cellPolys) {
    const d = getRoundedPolygonSvgPath(poly, roundedness);
    if (!d) continue;
    const fillColor = isDark ? keyColor : CREAM;
    const strokeColor = isDark ? CREAM : keyColor;
    tileContent += `    <path d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${wallThick}" stroke-linejoin="round" />\n`;
  }

  // Render micro-particles inside each cell (SVG)
  const particleColor = isDark ? CREAM : keyColor;

  for (const poly of cellPolys) {
    if (poly.length < 3) continue;
    const area = calculatePolygonArea(poly);
    const particles = generateParticlesInPolygon(poly, area, particleRng);

    for (const particle of particles) {
      // Organic blob path for particle (same as canvas: 5 control points, 0.06 wobble)
      const particlePath = svgOrganicVacuole(particle.x, particle.y, particle.r, 5, particleRng, 0.06);
      tileContent += `    <path d="${particlePath}" fill="${particleColor}" />\n`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${tileContent}</svg>`;
}

// Oregano SVG — mirrors renderOreganoMicroscopeGrid exactly
function generateOreganoSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['oregano'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  const bgColor = isDark ? CREAM : keyColor;
  const cellColor = isDark ? keyColor : CREAM;

  let tileContent = `\n      <rect width="${width}" height="${height}" fill="${bgColor}" />\n  `;
  const layoutSeed = Math.round(config.layoutSeed ?? 1);

  for (const s of generateOreganoSporePositions(width, height, config)) {
    const shapeRng = new SeededRandom('oregano_blob_' + s.idx + '_' + layoutSeed);
    const pts = buildOrganicCapsulePts(s.x, s.y, s.halfH, s.halfW, s.rot, shapeRng);
    tileContent += `    <path d="${svgOrganicCapsulePath(pts)}" fill="${cellColor}" />\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${tileContent}</svg>`;
}

// Convert drawing into a clean, standalone XML/SVG vector string for export
export function generateSVGPatternString(
  seasoning: Seasoning,
  config: PatternConfig,
  width: number,
  height: number
): string {
  if (seasoning.id === 'louro') {
    return generateLouroSVGPatternString(config, width, height);
  }

  if (seasoning.id === 'alho') {
    return generateGarlicSVGPatternString(config, width, height);
  }

  if (seasoning.id === 'pimenta') {
    return generatePimentaSVGPatternString(config, width, height);
  }

  if (seasoning.id === 'oregano') {
    return generateOreganoSVGPatternString(config, width, height);
  }

  if (seasoning.id === 'manjericao') {
    return generateManjericaoSVGPatternString(config, width, height);
  }

  const rng = new SeededRandom(seasoning.id + '_svg_organic_v2_' + Math.round(config.layoutSeed ?? 1));
  const count = Math.round(config.density);
  const zoomFactor = config.zoom / 100;
  const list = [];

  for (let i = 0; i < count; i++) {
    list.push({
      x: rng.range(0, width),
      y: rng.range(0, height),
      size: rng.range(16, 42) * zoomFactor,
      rotation: rng.range(0, Math.PI * 2),
      opacity: rng.range(0.8, 1.0),
      colorShift: rng.range(0, 1),
      extraValue: rng.range(0, 1),
    });
  }

  const isDark = config.themeMode === 'dark';
  const { bg, fg: color } = getThemeColors(seasoning.id, isDark);
  const bgStyleColor = bg; // cutouts / pores reveal the background

  let tileContent = `\n      <rect width="${width}" height="${height}" fill="${bg}" />\n  `;

  // Helper macro to generate smooth curving points in SVG Path format
  const getOrganicSvgPath = (sizeX: number, sizeY: number, seed: string, pointsCount: number, dentFactor: number = 0.15) => {
    const r = new SeededRandom(seed);
    const angles: number[] = [];
    const radii: number[] = [];

    for (let i = 0; i < pointsCount; i++) {
      const angle = (i * Math.PI * 2) / pointsCount;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const baseR = Math.sqrt(1 / ((cos * cos) / (sizeX * sizeX) + (sin * sin) / (sizeY * sizeY)));
      const wave = r.range(1 - dentFactor, 1 + dentFactor);
      radii.push(baseR * wave);
      angles.push(angle);
    }

    const pts = [];
    for (let i = 0; i < pointsCount; i++) {
      pts.push({
        x: radii[i] * Math.cos(angles[i]),
        y: radii[i] * Math.sin(angles[i]),
      });
    }

    const startX = (pts[pointsCount - 1].x + pts[0].x) / 2;
    const startY = (pts[pointsCount - 1].y + pts[0].y) / 2;
    let pathData = `M ${startX.toFixed(1)} ${startY.toFixed(1)}`;

    for (let i = 0; i < pointsCount; i++) {
      const curr = pts[i];
      const next = pts[(i + 1) % pointsCount];
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      pathData += ` Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}, ${midX.toFixed(1)} ${midY.toFixed(1)}`;
    }
    pathData += ' Z';
    return pathData;
  };

  const drawParticleSvgWithWrap = (p: Particle) => {
    const scale = p.size;
    const rotVal = (p.rotation * 180 / Math.PI) + config.rotation;
    let elementStr = '';
    
    if (seasoning.particleType === 'crystal_cube') {
      // Salt Pebble Shape: 45% circle/ellipse, 35% smooth pebble blob, 20% very rounded smooth rectangle
      const particleColor = getParticleColor(seasoning.id, p, config);
      const s = scale * 1.15;
      const r = new SeededRandom(p.colorShift + '_salt_grain');
      const shapeType = r.range(0, 1);

      if (shapeType < 0.45) {
        // Perfect circle / slightly squashed ellipse
        const rx = s * r.range(0.85, 1.15);
        const ry = s * r.range(0.85, 1.15);
        const randRot = (r.range(0, 360) + rotVal).toFixed(1);
        elementStr = `<ellipse cx="0" cy="0" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${randRot})" fill="${particleColor}" />`;
      } else if (shapeType < 0.8) {
        // Smooth organic pebble blob (6 point, low dent of 0.06)
        const rx = s * r.range(0.95, 1.25);
        const ry = s * r.range(0.8, 1.05);
        const pathData = getOrganicSvgPath(rx, ry, p.colorShift + '_salt_pebble', 6, 0.06);
        elementStr = `<path d="${pathData}" transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${rotVal.toFixed(1)})" fill="${particleColor}" />`;
      } else {
        // Very rounded smooth quadrilateral block
        const rx = s * r.range(0.9, 1.15);
        const ry = s * r.range(0.9, 1.15);
        const pathData = getOrganicSvgPath(rx, ry, p.colorShift + '_salt_quad', 4, 0.08);
        elementStr = `<path d="${pathData}" transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${rotVal.toFixed(1)})" fill="${particleColor}" />`;
      }
    } else if (seasoning.particleType === 'extended_leaf_cell') {
      // Epidermis anticlinal wavy cell wall (puzzle cells) for Louro
      const particleColor = getParticleColor(seasoning.id, p, config);
      const pathOuter = getOrganicSvgPath(scale * 1.2, scale * 0.9, p.colorShift + '_louro_puzzle', 10, 0.35);
      elementStr = `
      <path d="${pathOuter}" transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${rotVal.toFixed(1)})" fill="${particleColor}" />
      <ellipse cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" rx="${(scale * 0.25).toFixed(1)}" ry="${(scale * 0.1).toFixed(1)}" fill="${bgStyleColor}" transform="rotate(${rotVal.toFixed(1)}, ${p.x.toFixed(1)}, ${p.y.toFixed(1)})" />`;
    } else if (seasoning.particleType === 'concentric_bulb_starch') {
      // Garlic mitotic dividing cell
      const particleColor = getParticleColor(seasoning.id, p, config);
      const rCell = new SeededRandom(p.colorShift + '_svg_mitosis');
      const randVal = rCell.range(0, 1);
      
      const pathBox = getOrganicSvgPath(scale * 1.25, scale * 1.0, p.colorShift + '_garlic_box', 5, 0.08);
      
      let innerElements = '';
      
      // Calculate rotation matrix helpers to transform inner elements properly
      const rad = (rotVal * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const rotatePoint = (x: number, y: number) => {
        return {
          x: p.x + (x * cos - y * sin),
          y: p.y + (x * sin + y * cos)
        };
      };

      if (randVal < 0.75) {
        // Standard Interphase: 1 prominent nucleus slightly offset
        const ox = rCell.range(-scale * 0.08, scale * 0.08);
        const oy = rCell.range(-scale * 0.08, scale * 0.08);
        const nr = (scale * rCell.range(0.33, 0.40)).toFixed(1);
        const pt = rotatePoint(ox, oy);
        innerElements = `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${nr}" fill="${bgStyleColor}" />`;
      } else if (randVal < 0.88) {
        // Mitotic Metaphase/Anaphase: Condensed chromosome plate
        const crot = (rCell.range(-45, 45)).toFixed(1);
        innerElements = `
        <g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${(rotVal + parseFloat(crot)).toFixed(1)})" fill="${bgStyleColor}">
          <rect x="-${(scale * 0.12).toFixed(1)}" y="-${(scale * 0.35).toFixed(1)}" width="${(scale * 0.24).toFixed(1)}" height="${(scale * 0.7).toFixed(1)}" />
          <rect x="-${(scale * 0.3).toFixed(1)}" y="-${(scale * 0.12).toFixed(1)}" width="${(scale * 0.6).toFixed(1)}" height="${(scale * 0.24).toFixed(1)}" />
        </g>`;
      } else {
        // Telophase: Two daughter nuclei dividing and pulling apart
        const dist = scale * rCell.range(0.24, 0.32);
        const nr = (scale * rCell.range(0.18, 0.23)).toFixed(1);
        const pt1 = rotatePoint(-dist, 0);
        const pt2 = rotatePoint(dist, 0);
        innerElements = `
        <circle cx="${pt1.x.toFixed(1)}" cy="${pt1.y.toFixed(1)}" r="${nr}" fill="${bgStyleColor}" />
        <circle cx="${pt2.x.toFixed(1)}" cy="${pt2.y.toFixed(1)}" r="${nr}" fill="${bgStyleColor}" />`;
      }

      elementStr = `
      <path d="${pathBox}" transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${rotVal.toFixed(1)})" fill="${particleColor}" />
      ${innerElements}`;
    } else if (seasoning.particleType === 'fiery_droplet_spike') {
      // Pepper: TEM cell cross-section with membrane, cytoplasm, and organelles
      const particleColor = getParticleColor(seasoning.id, p, config);
      const s = scale * 1.35;
      const uid = `${Math.round(p.x)}_${Math.round(p.y)}`;

      const outerPath = getOrganicSvgPath(s * 1.05, s * 0.82, p.colorShift + '_pc_outer', 9, 0.18);
      const innerPath = getOrganicSvgPath(s * 0.88, s * 0.68, p.colorShift + '_pc_inner', 8, 0.15);

      const rngOrg = new SeededRandom(p.colorShift + '_pc_org_' + p.extraValue.toFixed(4));
      let orgDots = '';

      const smallCount = 18 + Math.floor(rngOrg.range(0, 7));
      for (let i = 0; i < smallCount; i++) {
        const a = rngOrg.range(0, Math.PI * 2);
        const d = Math.sqrt(rngOrg.range(0, 1));
        const ox = (p.x + Math.cos(a) * d * s * 0.7).toFixed(1);
        const oy = (p.y + Math.sin(a) * d * s * 0.56).toFixed(1);
        const r = rngOrg.range(s * 0.03, s * 0.065).toFixed(1);
        orgDots += `<circle cx="${ox}" cy="${oy}" r="${r}" fill="${particleColor}" />`;
      }

      const medCount = 2 + Math.floor(rngOrg.range(0, 2));
      for (let i = 0; i < medCount; i++) {
        const a = rngOrg.range(0, Math.PI * 2);
        const d = Math.sqrt(rngOrg.range(0, 0.65));
        const ox = (p.x + Math.cos(a) * d * s * 0.6).toFixed(1);
        const oy = (p.y + Math.sin(a) * d * s * 0.48).toFixed(1);
        const r = rngOrg.range(s * 0.1, s * 0.155).toFixed(1);
        orgDots += `<circle cx="${ox}" cy="${oy}" r="${r}" fill="${particleColor}" />`;
      }

      const la = rngOrg.range(0, Math.PI * 2);
      const ld = Math.sqrt(rngOrg.range(0.05, 0.45));
      const lx = (p.x + Math.cos(la) * ld * s * 0.55).toFixed(1);
      const ly = (p.y + Math.sin(la) * ld * s * 0.44).toFixed(1);
      const lr = rngOrg.range(s * 0.18, s * 0.24).toFixed(1);
      orgDots += `<circle cx="${lx}" cy="${ly}" r="${lr}" fill="${particleColor}" />`;

      elementStr = `
      <defs><clipPath id="pcc_${uid}"><path d="${innerPath}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${rotVal.toFixed(1)})" /></clipPath></defs>
      <path d="${outerPath}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${rotVal.toFixed(1)})" fill="${particleColor}" />
      <path d="${innerPath}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${rotVal.toFixed(1)})" fill="${bgStyleColor}" />
      <g clip-path="url(#pcc_${uid})">${orgDots}</g>`;
    } else if (seasoning.particleType === 'glandular_basil_hair') {
      // Basil glandular disc: 8 radial septa + inner ring + central nucleus
      const particleColor = getParticleColor(seasoning.id, p, config);
      const s = scale * 1.15;
      const segments = 8;
      let septaLines = '';
      for (let i = 0; i < segments; i++) {
        const angle = (rotVal * Math.PI / 180) + (i * Math.PI * 2) / segments;
        const x1 = (p.x + Math.cos(angle) * s * 0.21).toFixed(1);
        const y1 = (p.y + Math.sin(angle) * s * 0.21).toFixed(1);
        const x2 = (p.x + Math.cos(angle) * s * 0.81).toFixed(1);
        const y2 = (p.y + Math.sin(angle) * s * 0.81).toFixed(1);
        septaLines += `\n      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${bgStyleColor}" stroke-width="${(s * 0.08).toFixed(1)}" stroke-linecap="round" />`;
      }

      elementStr = `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(s * 0.88).toFixed(1)}" fill="${particleColor}" />${septaLines}
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(s * 0.42).toFixed(1)}" fill="none" stroke="${bgStyleColor}" stroke-width="${(s * 0.065).toFixed(1)}" />
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(s * 0.15).toFixed(1)}" fill="${bgStyleColor}" />`;
    } else {
      // Oregano hook claw & companion pod
      const particleColor = getParticleColor(seasoning.id, p, config);
      const hookPath = `M ${(-scale * 0.8).toFixed(1)} ${(scale * 0.4).toFixed(1)} Q ${(0).toFixed(1)} ${(-scale * 0.6).toFixed(1)}, ${(scale * 0.8).toFixed(1)} ${(-scale * 0.4).toFixed(1)} Q ${(scale * 0.15).toFixed(1)} ${(scale * 0.1).toFixed(1)}, ${(-scale * 0.5).toFixed(1)} ${(scale * 0.65).toFixed(1)} Z`;
      elementStr = `
      <g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${rotVal.toFixed(1)})">
        <path d="${hookPath}" fill="${particleColor}" />
        <circle cx="${(scale * 0.4).toFixed(1)}" cy="${(scale * 0.4).toFixed(1)}" r="${(scale * 0.24).toFixed(1)}" fill="${particleColor}" />
      </g>`;
    }

    tileContent += `\n      ${elementStr}`;
  };

  list.forEach((p) => {
    // Main draw
    drawParticleSvgWithWrap(p);

    // Dynamic wraps
    const margin = p.size * (config.zoom / 100) * 3;
    const offsetsX = [0];
    const offsetsY = [0];

    if (p.x < margin) offsetsX.push(width);
    if (p.x > width - margin) offsetsX.push(-width);
    if (p.y < margin) offsetsY.push(height);
    if (p.y > height - margin) offsetsY.push(-height);

    for (const dx of offsetsX) {
      for (const dy of offsetsY) {
        if (dx !== 0 || dy !== 0) {
          const wrappedP = {
            ...p,
            x: p.x + dx,
            y: p.y + dy,
          };
          drawParticleSvgWithWrap(wrappedP);
        }
      }
    }
  });

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${tileContent}
</svg>`;

  return svgContent;
}

// Automatically normalize parameters per seasoning to maintain curated visual occupancy (55%-75%) and negative space
// presetRatio kept in signature for API compatibility but no longer drives a gridMode field (removed dead param)
export function getCuratedConfigForSeasoning(
  seasoningId: string,
  _presetRatio: number,
  themeMode: 'light' | 'dark',
  customSeed?: number
): PatternConfig {
  const seed = customSeed ?? Math.floor(Math.random() * 100000) + 1;
  const rng = new SeededRandom(seasoningId + '_curation_v4_' + seed);

  // Resolve curated defaults from the canonical PARAMETERS registry.
  // Fallback to 'sal' if id unrecognized (defensive — should never happen).
  const spice = (PARAMETERS.zoom.defaults as Record<string, number>)[seasoningId] !== undefined
    ? (seasoningId as SpiceId)
    : 'sal';
  const dZoom = PARAMETERS.zoom.defaults[spice];
  const dDensity = PARAMETERS.density.defaults[spice];
  const dLineWidth = PARAMETERS.lineWidth.defaults[spice];
  const dRoundedness = PARAMETERS.voronoiRoundedness.defaults[spice];

  // Sample parameters within calibrated ranges for each spice (same RNG envelope as before)
  const zoom = Math.round(rng.range(dZoom * 0.95, dZoom * 1.05));
  const density = Math.round(rng.range(dDensity * 0.85, dDensity * 1.15));
  const rotation = 0; // Rotation now only affects internal anisotropy, not visual rotation
  const lineWidth = dLineWidth + rng.range(-0.2, 0.2);
  const voronoiRoundedness = Math.round(rng.range(dRoundedness * 0.9, dRoundedness * 1.1));

  return {
    zoom,
    density,
    rotation,
    noise: 12,
    lineWidth,
    themeMode,
    voronoiRoundedness,
    layoutSeed: seed,
  };
}


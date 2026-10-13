/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Seasoning, PatternConfig } from '../types';
import { PARAMETERS, SpiceId } from '../engine/parameters';
import { strokeWidth, targetCount, SPICE_DENSITY_FACTORS, scaleAtZoom } from '../engine/scaling';
import {
  clipPolygon,
  isPointInPolygon,
  polygonArea,
  polygonCentroid,
  createAnisotropicTransform,
} from '../engine/voronoi';
import { GRUPO_PIECES } from '../engine/grupoShapes';

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
  pimenta: { l: 0.665, c: 0.177, h: 45, fallback: '#E86820' },
  manjericao: { l: 0.35, c: 0.16, h: 350, fallback: '#8A2040' },
  oregano: { l: 0.71, c: 0.17, h: 115, fallback: '#93B629' },
  alecrim: { l: 0.4523, c: 0.1005, h: 139.81, fallback: '#35632A' },
  grupo: { l: 0.2758, c: 0.0901, h: 296.26, fallback: '#2D1B4E' }
};

// Neutral cream pole used in all theme inversions
export const CREAM = 'oklch(96% 0.008 88.75)';

// ─── OKLCH → sRGB hex converter ──────────────────────────────────────────────
// Björn Ottosson's OKLCH conversion. Used to emit hex colors in SVG exports
// because Figma / Sketch / most legacy SVG readers do NOT support oklch().
// Without this conversion, exported SVGs render as solid black in those tools.
function oklchToHex(l: number, c: number, h: number): string {
  // L is 0..1 (NOT percentage), c is chroma, h is degrees
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  // OKLab → LMS (cubic)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const lc = l_ * l_ * l_;
  const mc = m_ * m_ * m_;
  const sc = s_ * s_ * s_;
  // LMS → linear sRGB
  const rLin =  4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const gLin = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bLin = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;
  // linear sRGB → gamma-encoded sRGB
  const gamma = (x: number) => x >= 0.0031308
    ? 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055
    : 12.92 * x;
  const toByte = (x: number) => {
    const v = Math.round(gamma(x) * 255);
    return Math.max(0, Math.min(255, v));
  };
  const r = toByte(rLin);
  const g = toByte(gLin);
  const bch = toByte(bLin);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(bch)}`;
}

// Pre-computed hex of the CREAM constant (96% 0.008 88.75)
export const CREAM_HEX = oklchToHex(0.96, 0.008, 88.75);

// Public helper: derive (bg, shape) colors for a given spice + theme as OKLCH
// strings. Used by the canvas pipeline + shader system.
export function deriveSpiceColors(spiceId: string, themeMode: 'light' | 'dark'): { bgColor: string; shapeColor: string } {
  const ok = SEASONINGS_OKLCH[spiceId] || { l: 0.5, c: 0.1, h: 0 };
  const keyColor = `oklch(${ok.l * 100}% ${ok.c} ${ok.h})`;
  const isDark = themeMode === 'dark';
  return {
    bgColor: isDark ? keyColor : CREAM,
    shapeColor: isDark ? CREAM : keyColor,
  };
}

// Hex-color variant of deriveSpiceColors — for SVG export only.
// Same color values as deriveSpiceColors but converted to sRGB hex so
// Figma / Sketch / Illustrator can render them correctly.
export function deriveSpiceColorsHex(spiceId: string, themeMode: 'light' | 'dark'): { bgColor: string; shapeColor: string } {
  const ok = SEASONINGS_OKLCH[spiceId] || { l: 0.5, c: 0.1, h: 0 };
  const keyHex = oklchToHex(ok.l, ok.c, ok.h);
  const isDark = themeMode === 'dark';
  return {
    bgColor: isDark ? keyHex : CREAM_HEX,
    shapeColor: isDark ? CREAM_HEX : keyHex,
  };
}

// ─── Parameter scaling helpers ──────────────────────────────────────────────

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




// clipPolygon + isPointInPolygon now live in src/engine/voronoi.ts (shared with future migrations).

// ─── Frame-format consistency ───────────────────────────────────────────────
//
// Every format renders with a 1200px long side (Quadrado 1200², Paisagem
// 1200×800, Cinema 1200×675, Retrato/Story 1200 tall). Structure sizes are
// measured against that long side, never the short one: measuring against the
// short side shrank every structure in non-square frames (Cinema ≈ 56% size,
// ≈ 1/3 of the ink coverage of Quadrado). Count already follows area via
// targetCount, so size + count stay identical per pixel in every format.
// For a square frame long side = short side → output unchanged.
function frameRefDim(W: number, H: number): number {
  return Math.max(W, H);
}

// Grid sides for the Voronoi spices. A single M×M grid stretched over a wide
// frame squashed every cell (and Alho's nuclei, sized from the short cell
// side). Columns and rows now follow the frame aspect so cells keep their
// square-frame shape and size. Square frames still get M×M, same RNG order.
function voronoiGridSides(totalCount: number, W: number, H: number): { MX: number; MY: number } {
  const side = (n: number) => Math.max(2, Math.min(22, Math.round(Math.sqrt(n))));
  return { MX: side(totalCount * (W / H)), MY: side(totalCount * (H / W)) };
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

  // Density semantics (canonical, shared with all Voronoi spices):
  //   target structure COUNT = density × SPICE_DENSITY_FACTORS[id] × area_scale × (100/zoom)
  //   M (grid side)         = clamp(round(sqrt(count)), 3, 22)
  //
  // Calibration: SPICE_DENSITY_FACTORS.louro = 2.2 keeps M=3 at curated default
  //   (zoom=220, density=9), giving byte-identical baseline-snapshot output.
  // Higher zoom → fewer/larger cells (zoomReduces=true) → microscopy intuition.
  const density = config.density ?? 40;
  const totalCount = targetCount(density, W * H, SPICE_DENSITY_FACTORS.louro, config.zoom ?? 100, true);
  const { MX, MY } = voronoiGridSides(totalCount, W, H);

  const rng = new SeededRandom('louro_microscope_voronoi_' + Math.round(config.layoutSeed ?? 1));
  const jittersX: number[] = [];
  const jittersY: number[] = [];
  for (let d = 0; d < MX * MY; d++) {
    jittersX.push(rng.range(-0.35, 0.35));
    jittersY.push(rng.range(-0.35, 0.35));
  }

  const getSeed = (gi: number, gj: number) => {
    const iWrap = (gi % MX + MX) % MX;
    const jWrap = (gj % MY + MY) % MY;
    const idx = jWrap * MX + iWrap;
    
    const cellW = W / MX;
    const cellH = H / MY;
    
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
  // Stretch maps from anisotropy 0..100 → 1.0..2.5 (0 = circular cells, 100 = strongly elongated)
  const louroStretch = 1.0 + ((config.anisotropy ?? 40) / 100) * 1.5;
  const { toT: toTransformed, fromT: fromTransformed } = createAnisotropicTransform(louroStretch, rotation);

  // Draw cells over an extended grid area to allow seamless wrapping
  for (let gi = -4; gi <= MX + 3; gi++) {
    for (let gj = -4; gj <= MY + 3; gj++) {
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

  // SVG export uses HEX (Figma/Sketch/Illustrator don't support oklch()).
  const keyColorStr = oklchToHex(oklchConfig.l, oklchConfig.c, oklchConfig.h);
  const wallColor = isDark ? CREAM_HEX : keyColorStr;
  const cellBgColor = isDark ? keyColorStr : CREAM_HEX;

  const rotation = config.rotation ?? 0;

  let tileContent = `\n      <rect width="${width}" height="${height}" fill="${wallColor}" />\n  `;

  // Mirrors canvas density semantics exactly — same factor, same formula.
  const density = config.density ?? 40;
  const totalCount = targetCount(density, width * height, SPICE_DENSITY_FACTORS.louro, config.zoom ?? 100, true);
  const { MX, MY } = voronoiGridSides(totalCount, width, height);

  const rng = new SeededRandom('louro_microscope_voronoi_' + Math.round(config.layoutSeed ?? 1));
  const jittersX: number[] = [];
  const jittersY: number[] = [];
  for (let d = 0; d < MX * MY; d++) {
    jittersX.push(rng.range(-0.35, 0.35));
    jittersY.push(rng.range(-0.35, 0.35));
  }

  const getSeed = (gi: number, gj: number) => {
    const iWrap = (gi % MX + MX) % MX;
    const jWrap = (gj % MY + MY) % MY;
    const idx = jWrap * MX + iWrap;
    
    const cellW = width / MX;
    const cellH = height / MY;
    
    const jx = jittersX[idx] * cellW;
    const jy = jittersY[idx] * cellH;
    
    const x = gi * cellW + cellW / 2 + jx;
    const y = gj * cellH + cellH / 2 + jy;
    
    return { x, y };
  };

  const wallWidth = strokeWidth(config.lineWidth || 2).toFixed(1); // absolute pixels, never scales with zoom
  const roundedness = config.voronoiRoundedness ?? 35;

  // Mirror the canvas anisotropy exactly (stretch 1.6).
  // Stretch maps from anisotropy 0..100 → 1.0..2.5 (0 = circular cells, 100 = strongly elongated)
  const louroStretch = 1.0 + ((config.anisotropy ?? 40) / 100) * 1.5;
  const { toT: toTransformed, fromT: fromTransformed } = createAnisotropicTransform(louroStretch, rotation);

  for (let gi = -4; gi <= MX + 3; gi++) {
    for (let gj = -4; gj <= MY + 3; gj++) {
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

// Draw mitosis nucleus inside a cell. `interphaseThreshold` controls the
// probability of interphase (single nucleus) vs telophase (two nuclei).
// Default 0.85 → 15% telophase, matching the canonical mitotic-activity value.
function drawMitosisNucleus(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  randVal: number,
  rng: SeededRandom,
  color: string,
  interphaseThreshold: number = 0.85
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(cx, cy);

  if (randVal < interphaseThreshold) {
    // Interphase (85%): Organic vacuole nucleus, slightly offset
    const ox = rng.range(-size * 0.05, size * 0.05);
    const oy = rng.range(-size * 0.05, size * 0.05);
    const r = size * rng.range(0.18, 0.22);
    ctx.save();
    ctx.translate(ox, oy);
    pathFromBlobPoints(ctx, organicShape(0, 0, r, r, 7, rng, 0.07));
    ctx.fill();
    ctx.restore();
  } else {
    // Telophase (15%): Two organic daughter nuclei pulling apart
    const dist = size * rng.range(0.20, 0.24);
    const r = size * rng.range(0.11, 0.14);
    ctx.rotate(rng.range(-Math.PI / 6, Math.PI / 6));
    ctx.save(); ctx.translate(-dist, 0);
    pathFromBlobPoints(ctx, organicShape(0, 0, r, r, 7, rng, 0.07));
    ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(dist, 0);
    pathFromBlobPoints(ctx, organicShape(0, 0, r, r, 7, rng, 0.07));
    ctx.fill(); ctx.restore();
  }

  ctx.restore();
}

// Generate mitosis nucleus SVG path elements. Mirrors drawMitosisNucleus.
function generateMitosisNucleusSvg(
  cx: number,
  cy: number,
  size: number,
  randVal: number,
  rng: SeededRandom,
  color: string,
  interphaseThreshold: number = 0.85
): string {
  let content = '';

  if (randVal < interphaseThreshold) {
    const ox = cx + rng.range(-size * 0.05, size * 0.05);
    const oy = cy + rng.range(-size * 0.05, size * 0.05);
    const r = size * rng.range(0.18, 0.22);
    content = `    <path d="${svgFromBlobPoints(organicShape(ox, oy, r, r, 7, rng, 0.07))}" fill="${color}" />\n`;
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
    content = `    <path d="${svgFromBlobPoints(organicShape(x1, y1, r, r, 7, rng, 0.07))}" fill="${color}" />\n`;
    content += `    <path d="${svgFromBlobPoints(organicShape(x2, y2, r, r, 7, rng, 0.07))}" fill="${color}" />\n`;
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

  // Canonical density semantics — see VISUAL_CALIBRATION.md.
  // SPICE_DENSITY_FACTORS.alho = 1.16 → M=3 at curated default (zoom=180, density=14).
  const density = config.density ?? 40;
  const totalCount = targetCount(density, W * H, SPICE_DENSITY_FACTORS.alho, config.zoom ?? 100, true);
  const { MX, MY } = voronoiGridSides(totalCount, W, H);

  const rng = new SeededRandom('garlic_microscope_voronoi_' + Math.round(config.layoutSeed ?? 1));
  const jittersX: number[] = [];
  const jittersY: number[] = [];
  for (let d = 0; d < MX * MY; d++) {
    jittersX.push(rng.range(-0.32, 0.32));
    jittersY.push(rng.range(-0.32, 0.32));
  }

  const getSeed = (gi: number, gj: number) => {
    const iWrap = (gi % MX + MX) % MX;
    const jWrap = (gj % MY + MY) % MY;
    const idx = jWrap * MX + iWrap;
    const cellW = W / MX;
    const cellH = H / MY;
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

  for (let gi = -4; gi <= MX + 3; gi++) {
    for (let gj = -4; gj <= MY + 3; gj++) {
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
      const cellW = W / MX;
      const cellH = H / MY;
      const localSize = Math.min(cellW, cellH) * 0.95;

      const rngCell = new SeededRandom('garlic_cell_mitosis_' + gi + '_' + gj + '_' + Math.round(config.layoutSeed ?? 1));
      const randVal = rngCell.range(0, 1);

      // mitoticActivity (0..100) → telophase probability → interphaseThreshold (1 - p)
      const mitoticAct = (config.mitoticActivity ?? 15) / 100;
      drawMitosisNucleus(ctx, centroid.x, centroid.y, localSize, randVal, rngCell, nucleusColor, 1 - mitoticAct);
    }
  }
}

// Generate garlic SVG pattern string
function generateGarlicSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchConfig = SEASONINGS_OKLCH['alho'] || { l: 0.72, c: 0.16, h: 85, fallback: '#D4A010' };

  // SVG uses HEX for compatibility with Figma/Sketch/Illustrator.
  const keyColorStr = oklchToHex(oklchConfig.l, oklchConfig.c, oklchConfig.h);
  const wallColor = isDark ? CREAM_HEX : keyColorStr;
  const cellBgColor = isDark ? keyColorStr : CREAM_HEX;
  const nucleusColor = wallColor;
  const bgFillColor = wallColor;
  const rotation = config.rotation ?? 0;

  let tileContent = `\n      <rect width="${width}" height="${height}" fill="${bgFillColor}" />\n  `;

  // Mirrors canvas exactly — see renderGarlicMicroscopeGrid above.
  const density = config.density ?? 40;
  const totalCount = targetCount(density, width * height, SPICE_DENSITY_FACTORS.alho, config.zoom ?? 100, true);
  const { MX, MY } = voronoiGridSides(totalCount, width, height);

  const rng = new SeededRandom('garlic_microscope_voronoi_' + Math.round(config.layoutSeed ?? 1));
  const jittersX: number[] = [];
  const jittersY: number[] = [];
  for (let d = 0; d < MX * MY; d++) {
    jittersX.push(rng.range(-0.32, 0.32));
    jittersY.push(rng.range(-0.32, 0.32));
  }

  const getSeed = (gi: number, gj: number) => {
    const iWrap = (gi % MX + MX) % MX;
    const jWrap = (gj % MY + MY) % MY;
    const idx = jWrap * MX + iWrap;
    const cellW = width / MX;
    const cellH = height / MY;
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

  for (let gi = -4; gi <= MX + 3; gi++) {
    for (let gj = -4; gj <= MY + 3; gj++) {
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
      const cellW = width / MX;
      const cellH = height / MY;
      const localSize = Math.min(cellW, cellH) * 0.95;

      const rngCell = new SeededRandom('garlic_cell_mitosis_' + gi + '_' + gj + '_' + Math.round(config.layoutSeed ?? 1));
      const randVal = rngCell.range(0, 1);

      const mitoticAct = (config.mitoticActivity ?? 15) / 100;
      tileContent += generateMitosisNucleusSvg(centroid.x, centroid.y, localSize, randVal, rngCell, nucleusColor, 1 - mitoticAct);
    }
  }

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${tileContent}
</svg>`;

  return svgContent;
}

// ─── Pimenta swooshes — chili silhouettes flowing as a wind field ──────────
//
// Each pimenta is a minimalist tapered curve — wide rounded base, pointed
// tip, curving like a comma / bracket / Nike swoosh. Orientations are NOT
// random: every swoosh follows a deterministic 2D flow field, like wind
// barbs on a meteorological chart. The result reads as "swarming pimentas
// blown by a directional current" — fluid, coherent, with global flow
// patterns and local turbulence. Honors brand metaphor (Marketing + Sales =
// "acende o fogo, marca presença") through sharp shapes in directional flow.

interface PimentaSwoosh {
  baseX: number;        // wide-end position
  baseY: number;
  length: number;       // base-to-tip distance
  angle: number;        // orientation from flow field (base → tip)
  curve: number;        // perpendicular spine offset (signed — left/right hook)
  baseWidth: number;    // width at the base (tapers to 0 at tip)
}

const PIMENTA_DENSITY_FACTOR = 2.2;        // → ~25 swooshes at curated default — enough to read the flow
const PIMENTA_BASE_WIDTH_RATIO = 0.42;     // base width / length — chunky base
const PIMENTA_BASE_CAP_DEPTH = 1.20;       // back-cap depth multiplier — large, visible rounded stem end
const PIMENTA_FLOW_SCALE_RATIO = 0.45;     // flow-field scale / frame long side — controls how smoothly the wind varies

// Deterministic 2D flow field — smooth angular variation across the canvas.
// Sum of low-frequency sines gives smooth currents with natural turbulence.
// Same seed always produces the same wind map.
function pimentaFlowAngle(x: number, y: number, scale: number, seed: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const p1 = seed * 0.137;
  const p2 = seed * 0.291;
  const u = Math.sin(sx + p1) + Math.sin(sy * 0.7 + p2);
  const v = Math.cos(sx * 0.7 + p2) + Math.cos(sy + p1);
  return Math.atan2(v, u);
}

function generatePimentaSwooshes(W: number, H: number, config: PatternConfig): PimentaSwoosh[] {
  const seed = Math.round(config.layoutSeed ?? 1);
  const rng = new SeededRandom('pimenta_flow_v4_' + seed);
  const density = config.density ?? 22;
  const zoom = config.zoom ?? 100;
  const refDim = frameRefDim(W, H);
  const flowScale = refDim * PIMENTA_FLOW_SCALE_RATIO;

  // Base length — ~6% of refDim at zoom=100, scales with sqrt of zoom.
  // At default (zoom=340): ~133px tip-to-base. Smaller than v3 to allow more
  // swooshes to show the flow direction clearly.
  const baseLen = refDim * 0.06 * scaleAtZoom(1, zoom, 'sqrt');
  const desiredCount = Math.max(8, targetCount(density, W * H, PIMENTA_DENSITY_FACTOR, zoom, 0.5));

  // Size-aware Poisson-disc placement — uniform scatter to fill the field
  const minDist = baseLen * 0.55;
  const offX = minDist * 2, offY = minDist * 2;
  const cellSize = minDist / Math.SQRT2;
  const gW = Math.ceil((W + offX * 2) / cellSize) + 1;
  const gH = Math.ceil((H + offY * 2) / cellSize) + 1;
  const grid: ({ x: number; y: number; r: number } | null)[] = new Array(gW * gH).fill(null);
  const gIdx = (x: number, y: number) => {
    const gx = Math.min(gW - 1, Math.max(0, Math.floor((x + offX) / cellSize)));
    const gy = Math.min(gH - 1, Math.max(0, Math.floor((y + offY) / cellSize)));
    return gy * gW + gx;
  };
  const isValid = (px: number, py: number, r: number) => {
    const gx = Math.floor((px + offX) / cellSize);
    const gy = Math.floor((py + offY) / cellSize);
    for (let i = Math.max(0, gx - 3); i <= Math.min(gW - 1, gx + 3); i++) {
      for (let j = Math.max(0, gy - 3); j <= Math.min(gH - 1, gy + 3); j++) {
        const n = grid[j * gW + i];
        if (n) {
          const dx = px - n.x, dy = py - n.y;
          const minSep = (r + n.r) * 0.50;
          if (dx * dx + dy * dy < minSep * minSep) return false;
        }
      }
    }
    return true;
  };

  const swooshes: PimentaSwoosh[] = [];
  const place = (px: number, py: number): boolean => {
    const sizeRoll = rng.range(0, 1);
    let length: number;
    if (sizeRoll < 0.70) length = baseLen * rng.range(0.65, 0.95);       // 70% small
    else if (sizeRoll < 0.95) length = baseLen * rng.range(0.95, 1.25);  // 25% medium
    else length = baseLen * rng.range(1.25, 1.55);                       // 5% large
    if (!isValid(px, py, length)) return false;

    // Orientation: flow field gives a regional bias, but wide angular jitter
    // + occasional 180° flips ensure individual pimentas point all over the
    // Wind direction (rotation param relabeled for Pimenta) — global flow bias
    const windRad = ((config.rotation ?? 0) * Math.PI) / 180;
    // flowCohesion 0..100 → jitter range and flip probability (0 = chaos, 100 = perfect ranks)
    const cohesion = (config.flowCohesion ?? 30) / 100;
    const jitterRange = (1 - cohesion) * Math.PI; // 0..π (full chaos)
    const flipProb = (1 - cohesion) * 0.5;        // 0..50% flip
    let angle = pimentaFlowAngle(px, py, flowScale, seed) + windRad + rng.range(-jitterRange, jitterRange);
    if (rng.range(0, 1) < flipProb) angle += Math.PI;
    // Curve direction tied to local flow vorticity
    const curveDir = Math.sin(pimentaFlowAngle(px + flowScale, py, flowScale, seed) - angle) < 0 ? -1 : 1;
    // curvature 0..100 → bend magnitude (0 = straight, 100 = strong hook)
    const curvatureN = (config.curvature ?? 50) / 100;
    const bendMin = 0.02 + curvatureN * 0.28;
    const bendMax = bendMin + 0.10;
    const curve = curveDir * length * rng.range(bendMin, bendMax);
    const baseWidth = length * PIMENTA_BASE_WIDTH_RATIO;

    swooshes.push({ baseX: px, baseY: py, length, angle, curve, baseWidth });
    grid[gIdx(px, py)] = { x: px, y: py, r: length };
    return true;
  };

  // Uniform Poisson scatter — no cluster centers, so the flow is visible everywhere
  let attempts = 0;
  while (swooshes.length < desiredCount && attempts < desiredCount * 80) {
    attempts++;
    place(rng.range(0, W), rng.range(0, H));
  }

  return swooshes;
}

// Compute the 6 anchor points of a swoosh's outline. Both canvas and SVG
// consume this to guarantee parity. Shape: rounded base cap (stem end) on
// one side, tapered pointed tip on the other, with curved hook spine — the
// asymmetric ends are what separate this from a symmetric eyebrow/crescent.
function swooshGeometry(s: PimentaSwoosh): {
  baseL: [number, number]; ctrlL: [number, number];
  tip: [number, number];
  ctrlR: [number, number]; baseR: [number, number];
  backCtrl: [number, number];
} {
  const dx = Math.cos(s.angle), dy = Math.sin(s.angle);
  const px = -dy, py = dx;          // perpendicular to base→tip axis
  const bw = s.baseWidth * 0.5;
  // Spine midpoint, offset perpendicular by `curve` — gives the hook bend
  const midX = s.baseX + dx * s.length * 0.5 + px * s.curve;
  const midY = s.baseY + dy * s.length * 0.5 + py * s.curve;
  // Back-cap control: pushes the closing curve BEHIND the base center, giving
  // the chili its rounded "stem end" silhouette (the key fix vs eyebrow look).
  const capDepth = bw * PIMENTA_BASE_CAP_DEPTH * 2;
  return {
    baseL: [s.baseX + px * bw, s.baseY + py * bw],
    ctrlL: [midX + px * bw, midY + py * bw],
    tip:   [s.baseX + dx * s.length, s.baseY + dy * s.length],
    ctrlR: [midX - px * bw, midY - py * bw],
    baseR: [s.baseX - px * bw, s.baseY - py * bw],
    backCtrl: [s.baseX - dx * capDepth, s.baseY - dy * capDepth],
  };
}

export function renderPimentaMicroscopeGrid(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  config: PatternConfig
) {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['pimenta'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  // Non-tiling polarity: LIGHT = cream bg + colored swooshes; DARK = colored bg + cream swooshes
  const bgColor = isDark ? keyColor : CREAM;
  const shapeColor = isDark ? CREAM : keyColor;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  const swooshes = generatePimentaSwooshes(W, H, config);
  ctx.fillStyle = shapeColor;

  for (const s of swooshes) {
    const g = swooshGeometry(s);
    ctx.beginPath();
    ctx.moveTo(g.baseL[0], g.baseL[1]);
    ctx.quadraticCurveTo(g.ctrlL[0], g.ctrlL[1], g.tip[0], g.tip[1]);
    ctx.quadraticCurveTo(g.ctrlR[0], g.ctrlR[1], g.baseR[0], g.baseR[1]);
    ctx.quadraticCurveTo(g.backCtrl[0], g.backCtrl[1], g.baseL[0], g.baseL[1]);
    ctx.closePath();
    ctx.fill();
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
  const zoom = config.zoom ?? 100;
  const globalAngle = ((config.rotation ?? 0) * Math.PI) / 180;
  const rng = new SeededRandom('oregano_spore_v2_' + Math.round(config.layoutSeed ?? 1));

  // SIZE: sqrt(zoom/100) instead of linear zm. At zoom=1200 capsules grow ~3.46×
  // instead of ~12×, keeping the optical microscopy feel (cells never dominate frame).
  // Calibration: 0.0544 baseline anchors capsule size at the legacy value (~77px) when
  // zoom=140 (Orégano curated default).
  const baseH = frameRefDim(W, H) * 0.0544 * scaleAtZoom(1, zoom, 'sqrt');
  // minDist sizes the spatial grid for neighbor lookup; set to the minimum possible
  // capsule diameter (2 × min halfH = 2 × 0.70 × baseH = 1.4 × baseH) so the search
  // radius always captures all potential neighbors regardless of size variation.
  const minDist = baseH * 1.4;

  // COUNT: canonical targetCount with strength=0.7 (mid-feature, gentle reduction).
  // At default (zoom=140, density=28) yields ~50 — matches legacy.
  // At zoom=1200 yields ~10 — readable microscopy view, no overcrowding.
  const desiredCount = Math.max(8, targetCount(density, W * H, SPICE_DENSITY_FACTORS.oregano, zoom, 0.7));

  // Grid for O(1) Poisson-disc neighbor checks, offset so negative coords are valid
  const offX = minDist * 2, offY = minDist * 2;
  const cellSize = minDist / Math.SQRT2;
  const gW = Math.ceil((W + offX * 2) / cellSize) + 1;
  const gH = Math.ceil((H + offY * 2) / cellSize) + 1;
  const grid: ({ x: number; y: number; halfH: number } | null)[] = new Array(gW * gH).fill(null);

  const gIdx = (x: number, y: number) => {
    const gx = Math.min(gW - 1, Math.max(0, Math.floor((x + offX) / cellSize)));
    const gy = Math.min(gH - 1, Math.max(0, Math.floor((y + offY) / cellSize)));
    return gy * gW + gx;
  };

  // Size-aware validity: reject if center distance < (halfH_candidate + halfH_neighbor) × GAP.
  // GAP = 0.82 allows ~18% touching tolerance (edges may just kiss in dense clusters,
  // but deep penetrations are impossible). Neighborhood widened to ±3 cells because
  // max-sized capsules (1.30 × baseH) can reach further than the ±2 cell window.
  const isValid = (px: number, py: number, halfH: number) => {
    const gx = Math.floor((px + offX) / cellSize);
    const gy = Math.floor((py + offY) / cellSize);
    for (let i = Math.max(0, gx - 3); i <= Math.min(gW - 1, gx + 3); i++) {
      for (let j = Math.max(0, gy - 3); j <= Math.min(gH - 1, gy + 3); j++) {
        const n = grid[j * gW + i];
        if (n) {
          const dx = px - n.x, dy = py - n.y;
          const minSep = (halfH + n.halfH) * 0.82;
          if (dx * dx + dy * dy < minSep * minSep) return false;
        }
      }
    }
    return true;
  };

  // capsuleElongation 0..100 maps aspect ratio range
  // 0 → round (0.85..0.95), 50 → current (0.48..0.78), 100 → elongated (0.20..0.40)
  const elongationN = (config.capsuleElongation ?? 50) / 100;
  const aspectMin = 0.95 - elongationN * 0.75; // 0.95..0.20
  const aspectMax = aspectMin + 0.30;

  const spores: OreganoSpore[] = [];
  const addSpore = (px: number, py: number): boolean => {
    const halfH = baseH * rng.range(0.70, 1.30);
    const aspect = rng.range(aspectMin, aspectMax);
    const rot = globalAngle + rng.range(-25, 25) * (Math.PI / 180);
    if (!isValid(px, py, halfH)) return false;
    spores.push({ x: px, y: py, halfH, halfW: halfH * aspect, rot, idx: spores.length });
    grid[gIdx(px, py)] = { x: px, y: py, halfH };
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

  // clusterSpread 0..100 maps spread radius range
  // 0 → tight (0.02..0.15), 50 → current (0.08..0.46), 100 → wide (0.20..0.80)
  const spreadN = (config.clusterSpread ?? 50) / 100;
  const spreadMin = 0.02 + spreadN * 0.18;  // 0.02..0.20
  const spreadMax = 0.15 + spreadN * 0.65;  // 0.15..0.80

  let attempts = 0;
  while (spores.length < desiredCount && attempts < desiredCount * 50) {
    attempts++;
    const cc = clusters[Math.floor(rng.range(0, clusters.length))];
    // Spread is a fraction of each axis, so wide/tall frames fill edge to edge (square unchanged).
    const spread = rng.range(spreadMin, spreadMax);
    const a = rng.range(0, Math.PI * 2);
    addSpore(cc.x + Math.cos(a) * spread * W * rng.range(0, 1), cc.y + Math.sin(a) * spread * H * rng.range(0, 1));
  }

  return spores;
}

export function renderOreganoMicroscopeGrid(
  ctx: CanvasRenderingContext2D, W: number, H: number, config: PatternConfig
) {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['oregano'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;

  // Polarity (non-tiling spice): LIGHT = cream bg + keyColor capsules (bright-field);
  // DARK = keyColor bg + cream capsules (dark-field). Matches the perceived polarity
  // of the Voronoi spices (Louro/Alho/Pimenta).
  ctx.fillStyle = isDark ? keyColor : CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = isDark ? CREAM : keyColor;

  const layoutSeed = Math.round(config.layoutSeed ?? 1);
  for (const s of generateOreganoSporePositions(W, H, config)) {
    const shapeRng = new SeededRandom('oregano_blob_' + s.idx + '_' + layoutSeed);
    pathOrganicCapsuleCanvas(ctx, buildOrganicCapsulePts(s.x, s.y, s.halfH, s.halfW, s.rot, shapeRng));
    ctx.fill();
  }
}

// ─── Sal (Salt) microscopy: crystalline grain field ──────────────────────────
//
// Phase A migration: moves Sal off the legacy particle dispatch onto the
// canonical pipeline (targetCount + scaleAtZoom + seeded RNG only). The
// visual character shifts from "soft organic blobs" to "crystalline polygon
// grains" — closer to actual salt-crystal microscopy: cubic dominant shapes,
// some hexagonal facets, slight jaggedness, no curved outlines.
//
// Per VISUAL_CALIBRATION.md: Sal calibrates as a *mid feature* (strength=0.5),
// not pure substrate — selecting Sal as a spice means crystals ARE the
// subject, so they should respond to zoom (fewer + larger at higher mag).

interface SalCrystal {
  x: number; y: number;
  rx: number; ry: number;
  sides: number;
  rotation: number;
  jaggedness: number;
  seed: string;
}

// Shared crystal polygon: regular N-gon with per-vertex radius jitter (jaggedness)
// and axis rotation. Aspect (rx vs ry) creates rectangular cubes-from-angle.
function buildCrystalPolygonPts(
  cx: number, cy: number,
  rx: number, ry: number,
  sides: number,
  rotation: number,
  rng: SeededRandom,
  jaggedness: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const scale = rng.range(1 - jaggedness, 1 + jaggedness);
    const lx = Math.cos(a) * rx * scale;
    const ly = Math.sin(a) * ry * scale;
    pts.push({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
  }
  return pts;
}

// Subtle corner softening for mineral-crystal feel (still clearly polygonal).
// Cubic-eased internally; ~9% of shortest-edge inset at 45 → reads as weathered facet.
const SAL_CORNER_ROUND = 44;

function pathCrystalCanvas(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  if (pts.length < 3) return;
  drawRoundedPolygon(ctx, pts.map(p => [p.x, p.y] as [number, number]), SAL_CORNER_ROUND);
}

function svgCrystalPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 3) return '';
  return getRoundedPolygonSvgPath(pts.map(p => [p.x, p.y] as [number, number]), SAL_CORNER_ROUND);
}

// Clustered Poisson-disc placement — natural salt-grain dispersal with
// loose clustering, mirroring the Orégano approach but tuned for Sal sizes.
function generateSalCrystalPositions(W: number, H: number, config: PatternConfig): SalCrystal[] {
  const density = config.density ?? 18;
  const zoom = config.zoom ?? 100;
  const globalAngle = ((config.rotation ?? 0) * Math.PI) / 180;
  const rng = new SeededRandom('sal_crystal_v1_' + Math.round(config.layoutSeed ?? 1));

  // SIZE: sqrt scaling — at zoom=1200 crystals grow ~3.46× instead of 12×.
  // 0.026 calibrated so baseR ≈ 34 px at default zoom=120, matching the
  // legacy avg particle size (16-42 range × 1.15 multiplier × 1.2 zoom ≈ 33 px).
  const baseR = frameRefDim(W, H) * 0.026 * scaleAtZoom(1, zoom, 'sqrt');
  const minDist = baseR * 1.4;

  // COUNT: strength=0.5 (mild reduction) — Sal is a *mid feature* in the
  // calibration family (between substrate constant and strong macro reduction).
  // factor=1.10 calibrated so count ≈ 18 at default (zoom=120, density=18).
  const desiredCount = Math.max(6, targetCount(density, W * H, SPICE_DENSITY_FACTORS.sal, zoom, 0.5));

  // O(1) Poisson neighbor grid (same approach as Orégano)
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

  const crystals: SalCrystal[] = [];
  const place = (px: number, py: number): boolean => {
    if (!isValid(px, py)) return false;
    // Size tier: 70% small grains, 25% medium crystals, 5% large plates.
    const sizeRoll = rng.range(0, 1);
    let r: number;
    if (sizeRoll < 0.70) r = baseR * rng.range(0.40, 0.80);
    else if (sizeRoll < 0.95) r = baseR * rng.range(0.80, 1.40);
    else r = baseR * rng.range(1.40, 2.00);
    // Shape tier: 60% cubic (4-sided), 25% hexagonal, 15% octagonal.
    // Higher 'sides' + lower jaggedness produces rounder grains; cubes stay
    // sharp. Larger plates get slightly more jaggedness (fracture feel).
    // crystalShape (0..1) biases tier via power-curve: 0.5=identity (current),
    // <0.5 pushes toward 5-sided, >0.5 pushes toward 9-sided.
    // faceting (0..1) scales jaggedness magnitude (0=smooth, 1=current, 2=fractured).
    const crystalShapeNorm = (config.crystalShape ?? 50) / 100;
    const facetingFactor = (config.faceting ?? 50) / 50;
    const shapeRoll = rng.range(0, 1);
    const biasedRoll = Math.pow(shapeRoll, Math.exp(-4 * (crystalShapeNorm - 0.5)));
    let sides: number, jagged: number;
    if (biasedRoll < 0.60) { sides = 5; jagged = 0.06; }
    else if (biasedRoll < 0.85) { sides = 7; jagged = 0.09; }
    else { sides = 9; jagged = 0.13; }
    jagged *= facetingFactor;
    if (sizeRoll >= 0.95) jagged += 0.07 * facetingFactor;
    const aspect = rng.range(0.78, 1.18);
    const rotation = globalAngle + rng.range(0, Math.PI * 2);
    crystals.push({
      x: px, y: py, rx: r, ry: r * aspect,
      sides, rotation, jaggedness: jagged,
      seed: 'sal_crystal_' + crystals.length,
    });
    grid[gIdx(px, py)] = { x: px, y: py };
    return true;
  };

  // 2-4 cluster centers + scattered crystals around them (~80%) + free scatter (~20%)
  const nClusters = 2 + Math.floor(rng.range(0, 2.9));
  const clusters: { x: number; y: number }[] = [];
  for (let c = 0; c < nClusters; c++) {
    const cx = rng.range(0.12, 0.88) * W;
    const cy = rng.range(0.12, 0.88) * H;
    clusters.push({ x: cx, y: cy });
    place(cx, cy);
  }

  let attempts = 0;
  while (crystals.length < desiredCount && attempts < desiredCount * 60) {
    attempts++;
    if (rng.range(0, 1) < 0.80) {
      const cc = clusters[Math.floor(rng.range(0, clusters.length))];
      // Spread is a fraction of each axis, so wide/tall frames fill edge to edge (square unchanged).
      const spread = rng.range(0.06, 0.42);
      const a = rng.range(0, Math.PI * 2);
      place(cc.x + Math.cos(a) * spread * W * rng.range(0, 1), cc.y + Math.sin(a) * spread * H * rng.range(0, 1));
    } else {
      place(rng.range(0, W), rng.range(0, H));
    }
  }

  return crystals;
}

export function renderSalMicroscopeGrid(
  ctx: CanvasRenderingContext2D, W: number, H: number, config: PatternConfig
): void {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['sal'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  // Polarity (non-tiling spice): LIGHT = cream bg + keyColor crystals (bright-field);
  // DARK = keyColor bg + cream crystals (dark-field). Matches the perceived polarity
  // of the Voronoi spices (Louro/Alho/Pimenta), where cells tile the canvas.
  const bgColor = isDark ? keyColor : CREAM;
  const shapeColor = isDark ? CREAM : keyColor;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = shapeColor;

  for (const c of generateSalCrystalPositions(W, H, config)) {
    const shapeRng = new SeededRandom(c.seed);
    pathCrystalCanvas(ctx, buildCrystalPolygonPts(c.x, c.y, c.rx, c.ry, c.sides, c.rotation, shapeRng, c.jaggedness));
    ctx.fill();
  }
}

function generateSalSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['sal'];
  // SVG export uses HEX (Figma compatibility).
  const keyColor = oklchToHex(oklchCfg.l, oklchCfg.c, oklchCfg.h);
  const bgColor = isDark ? keyColor : CREAM_HEX;
  const shapeColor = isDark ? CREAM_HEX : keyColor;

  let content = `\n      <rect width="${width}" height="${height}" fill="${bgColor}" />\n  `;
  for (const c of generateSalCrystalPositions(width, height, config)) {
    const shapeRng = new SeededRandom(c.seed);
    const pts = buildCrystalPolygonPts(c.x, c.y, c.rx, c.ry, c.sides, c.rotation, shapeRng, c.jaggedness);
    const d = svgCrystalPath(pts);
    if (d) content += `    <path d="${d}" fill="${shapeColor}" />\n`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${content}</svg>`;
}

// ─── Manjericão (Basil) microscopy: chloroplast tissue + glandular trichomes ─

// Shared organic blob points generator (consumed by canvas + SVG)
function organicShape(
  cx: number, cy: number, radiusX: number, radiusY: number,
  pointsCount: number, seedOrRng: string | SeededRandom, dentFactor: number
): { x: number; y: number }[] {
  // Dual seed-entry: pass a seedStr to get an isolated rng instance (existing
  // callers; matches the prior buildOrganicBlobPoints behavior), OR pass a
  // shared SeededRandom to consume from an external stream (new callers
  // migrated from pathOrganicVacuole/svgOrganicVacuole, which use a
  // per-cell/per-particle rng shared across multiple shape calls).
  const rng = typeof seedOrRng === 'string' ? new SeededRandom(seedOrRng) : seedOrRng;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < pointsCount; i++) {
    const angle = (i * Math.PI * 2) / pointsCount;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const wave = rng.range(1 - dentFactor, 1 + dentFactor);
    if (radiusX === radiusY) {
      // Circular fast-path — matches pathOrganicVacuole's float operation
      // order exactly (cos * r * w, left-to-right). For rx=ry the elliptical
      // radius equation would collapse algebraically to r but NOT bit-equal
      // because cos² + sin² in IEEE 754 is 1+ε. This branch preserves
      // byte-identical parity for vacuole-migrated callers.
      pts.push({ x: cx + cos * radiusX * wave, y: cy + sin * radiusX * wave });
    } else {
      // Elliptical path — original organicShape math, retained verbatim for
      // existing callers (Manjericão membranes + chloroplasts always have
      // rx ≠ ry because each is an independent rng.range draw).
      const baseR = Math.sqrt(1 / ((cos * cos) / (radiusX * radiusX) + (sin * sin) / (radiusY * radiusY)));
      pts.push({ x: cx + baseR * wave * cos, y: cy + baseR * wave * sin });
    }
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

// ─── Manjericão venation — branching leaf-vein system, NOT mesh ─────────────
//
// Basil reads as PLANT TISSUE not via cell membranes (which collide with the
// Voronoi family Louro/Alho/Pimenta), but via the iconic linear-branching
// venation pattern of any leaf. Pure lines, hierarchical thickness, dominant
// negative space. The brand metaphor (Social = "folha do bem, leveza") is
// honored by breathable open composition.

// Basil rosette: top-down view of a basil plant. Basil has DECUSSATE
// PHYLLOTAXIS — leaf pairs grow opposite (180°) at each node, with
// successive nodes rotated 90°. From above, this produces a cross-shaped
// (4-leaf), star-shaped (6-leaf), or fuller (8-leaf) rosette depending on
// how many nodes are visible. Each rosette is graphically a "small basil
// plant from above" — multiple groups, each different in leaf count,
// rotation and size, populating the canvas.

interface BasilLeaf {
  cx: number; cy: number;       // base attachment point (rosette center)
  angle: number;                // direction the tip points (from center outward)
  length: number;
  maxWidth: number;             // max half-width at widest point (ovate leaf profile)
}

interface BasilLayout {
  leaves: BasilLeaf[];
}

// Rosette density and proportion constants
const ROSETTE_DENSITY_FACTOR = 0.4;        // → ~6 rosettes at default
const LEAF_WIDTH_RATIO = 0.38;             // maxWidth / length — chunky ovate basil proportions

// Botanically-accurate basil leaf geometry. Basil (Ocimum basilicum) has
// OVATE leaves: chunky ~2:1 length-to-width, widest in the lower-middle,
// with ACUMINATE apex tapering smoothly to a pointed tip. All leaves
// attach at the rosette center (no petiole gap) so leaf bases converge
// into a solid filled center, like a real basil whorl viewed from above.
//
// Construction: cubic Bezier per side with two width-control points
// producing the chunky ovate profile:
//   - t1=0.30, w1=1.25×maxWidth → wide bulge in lower-middle (ovate widest)
//   - t2=0.68, w2=0.65×maxWidth → gradual taper to acuminate tip
function leafGeometry(l: BasilLeaf): {
  base: [number, number];
  outA: [number, number]; outB: [number, number];
  tip:  [number, number];
  inA:  [number, number]; inB:  [number, number];
} {
  const dx = Math.cos(l.angle), dy = Math.sin(l.angle);
  const px = -dy, py = dx;
  const t1 = 0.30;
  const t2 = 0.68;
  const w1 = l.maxWidth * 1.25;
  const w2 = l.maxWidth * 0.65;
  const sp1X = l.cx + dx * l.length * t1;
  const sp1Y = l.cy + dy * l.length * t1;
  const sp2X = l.cx + dx * l.length * t2;
  const sp2Y = l.cy + dy * l.length * t2;
  return {
    base: [l.cx, l.cy],
    outA: [sp1X + px * w1, sp1Y + py * w1],
    outB: [sp2X + px * w2, sp2Y + py * w2],
    tip:  [l.cx + dx * l.length, l.cy + dy * l.length],
    inA:  [sp2X - px * w2, sp2Y - py * w2],
    inB:  [sp1X - px * w1, sp1Y - py * w1],
  };
}

function generateBasilLayout(W: number, H: number, config: PatternConfig): BasilLayout {
  const seed = Math.round(config.layoutSeed ?? 1);
  const rng = new SeededRandom('basil_rosette_v7_' + seed);
  const density = config.density ?? 16;
  const zoom = config.zoom ?? 100;
  const refDim = frameRefDim(W, H);
  const sizeScale = scaleAtZoom(1, zoom, 'sqrt');

  // Per-rosette leaf length (each rosette has its own scale around this base)
  const baseLeafLen = refDim * 0.10 * sizeScale;
  const nRosettes = Math.max(2, targetCount(density, W * H, ROSETTE_DENSITY_FACTOR, zoom, 0.6));

  const leaves: BasilLeaf[] = [];
  const placedCenters: { x: number; y: number; r: number }[] = [];

  const isValid = (px: number, py: number, r: number) => {
    for (const pc of placedCenters) {
      const ddx = px - pc.x, ddy = py - pc.y;
      const minSep = (r + pc.r) * 0.85; // rosettes can lightly overlap leaves but not centers
      if (ddx * ddx + ddy * ddy < minSep * minSep) return false;
    }
    return true;
  };

  let attempts = 0;
  while (placedCenters.length < nRosettes && attempts < nRosettes * 120) {
    attempts++;
    const cx = rng.range(0.10, 0.90) * W;
    const cy = rng.range(0.10, 0.90) * H;

    // Per-rosette size variation
    const sizeRoll = rng.range(0, 1);
    let scale: number;
    if (sizeRoll < 0.55) scale = rng.range(0.55, 0.85);       // 55% small
    else if (sizeRoll < 0.90) scale = rng.range(0.85, 1.15);  // 35% medium
    else scale = rng.range(1.15, 1.55);                       // 10% large
    const rosetteSize = baseLeafLen * scale;

    if (!isValid(cx, cy, rosetteSize)) continue;
    placedCenters.push({ x: cx, y: cy, r: rosetteSize });

    // Leaf count: 4 (1-2 visible nodes), 6 (3 nodes), or 8 (4 nodes)
    const countRoll = rng.range(0, 1);
    // leavesPerRosette 0..100 biases the 4/6/8 distribution via power curve
    // 0 = always 4; 50 = current 45/30/25; 100 = always 8
    const leafCountN = (config.leavesPerRosette ?? 50) / 100;
    const biasedCountRoll = Math.pow(countRoll, Math.exp(-3 * (leafCountN - 0.5)));
    let nLeaves: number;
    if (biasedCountRoll < 0.45) nLeaves = 4;
    else if (biasedCountRoll < 0.75) nLeaves = 6;
    else nLeaves = 8;

    // leafShape 0..100 maps LEAF_WIDTH_RATIO from 0.18 (thin) to 0.55 (wide)
    const leafShapeRatio = 0.18 + ((config.leafShape ?? 50) / 100) * 0.37;
    // rosetteVariation 0..100 maps angular jitter from 0 to ±0.30 rad
    const rosetteJitter = ((config.rosetteVariation ?? 30) / 100) * 0.30;

    const baseRot = rng.range(0, Math.PI * 2);
    for (let i = 0; i < nLeaves; i++) {
      const angle = baseRot + (i / nLeaves) * Math.PI * 2 + rng.range(-rosetteJitter, rosetteJitter);
      const lenVar = rosetteSize * rng.range(0.85, 1.15);
      const widthVar = lenVar * leafShapeRatio * rng.range(0.85, 1.10);
      leaves.push({ cx, cy, angle, length: lenVar, maxWidth: widthVar });
    }
  }

  return { leaves };
}

export function renderManjericaoMicroscopeGrid(
  ctx: CanvasRenderingContext2D, W: number, H: number, config: PatternConfig
) {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['manjericao'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  // Non-tiling polarity: LIGHT = cream bg + colored leaves; DARK = colored bg + cream leaves
  const bgColor = isDark ? keyColor : CREAM;
  const shapeColor = isDark ? CREAM : keyColor;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  const layout = generateBasilLayout(W, H, config);
  ctx.fillStyle = shapeColor;

  for (const leaf of layout.leaves) {
    const g = leafGeometry(leaf);
    ctx.beginPath();
    ctx.moveTo(g.base[0], g.base[1]);
    ctx.bezierCurveTo(g.outA[0], g.outA[1], g.outB[0], g.outB[1], g.tip[0], g.tip[1]);
    ctx.bezierCurveTo(g.inA[0], g.inA[1], g.inB[0], g.inB[1], g.base[0], g.base[1]);
    ctx.closePath();
    ctx.fill();
  }
}

// Manjericão SVG — mirrors renderManjericaoMicroscopeGrid exactly
function generateManjericaoSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['manjericao'];
  // SVG export uses HEX (Figma compatibility).
  const keyColor = oklchToHex(oklchCfg.l, oklchCfg.c, oklchCfg.h);
  const bgColor = isDark ? keyColor : CREAM_HEX;
  const shapeColor = isDark ? CREAM_HEX : keyColor;

  const layout = generateBasilLayout(width, height, config);
  let content = `\n      <rect width="${width}" height="${height}" fill="${bgColor}" />\n  `;

  for (const leaf of layout.leaves) {
    const g = leafGeometry(leaf);
    const d = `M ${g.base[0].toFixed(1)} ${g.base[1].toFixed(1)} C ${g.outA[0].toFixed(1)} ${g.outA[1].toFixed(1)}, ${g.outB[0].toFixed(1)} ${g.outB[1].toFixed(1)}, ${g.tip[0].toFixed(1)} ${g.tip[1].toFixed(1)} C ${g.inA[0].toFixed(1)} ${g.inA[1].toFixed(1)}, ${g.inB[0].toFixed(1)} ${g.inB[1].toFixed(1)}, ${g.base[0].toFixed(1)} ${g.base[1].toFixed(1)} Z`;
    content += `    <path d="${d}" fill="${shapeColor}" />\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${content}</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── Alecrim (Rosemary) microscopy: branched non-glandular trichomes ─────────
//
// The underside of a rosemary leaf is covered by dendritic ("candelabra")
// hairs that interlock into a silvery felt protecting the leaf from sun and
// drought. Each trichome = a foot cell with N primary arms; each arm carries
// M secondary branches alternating sides.
//
// Limbs are built as tapered FILLED outlines (not strokes) so canvas and SVG
// share one path string (canvas draws it through Path2D) and Figma receives
// clean vector shapes. Every limb subpath winds the same way, so overlapping
// limbs union under the default nonzero fill rule.
//
// Canonical pipeline: size = scaleAtZoom(sqrt), count = targetCount(strength
// 0.7), stroke = strokeWidth (absolute px, never scales with zoom).

const ALECRIM_ARM_RATIO = 0.056;      // mean arm length / frame long side at zoom=100 (~85px at 1200² default)
const ALECRIM_TIP_RATIO = 0.42;       // arm tip width / arm base width
const ALECRIM_BRANCH_TIP_END = 0.82;  // farthest branch attachment (fraction of arm length)
const ALECRIM_BRANCH_SPREAD = 0.62;   // how far toward the foot cell branchSpacing=100 reaches
const BEZIER_QUARTER = 0.5523;        // cubic control distance for a quarter circle

// One tapered limb with round caps, from (x0,y0) width w0 to (x1,y1) width w1.
function alecrimLimbPath(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number): string {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
  const nx = -dy, ny = dx;
  const r0 = w0 / 2, r1 = w1 / 2, k = BEZIER_QUARTER;
  const f = (n: number) => n.toFixed(1);
  const pt = (x: number, y: number) => `${f(x)} ${f(y)}`;
  // tip cap: left → apex → right
  const tlx = x1 + nx * r1, tly = y1 + ny * r1;
  const tax = x1 + dx * r1, tay = y1 + dy * r1;
  const trx = x1 - nx * r1, try_ = y1 - ny * r1;
  // base cap: right → back → left
  const brx = x0 - nx * r0, bry = y0 - ny * r0;
  const bbx = x0 - dx * r0, bby = y0 - dy * r0;
  const blx = x0 + nx * r0, bly = y0 + ny * r0;
  return `M ${pt(blx, bly)} L ${pt(tlx, tly)}`
    + ` C ${pt(tlx + dx * k * r1, tly + dy * k * r1)} ${pt(tax + nx * k * r1, tay + ny * k * r1)} ${pt(tax, tay)}`
    + ` C ${pt(tax - nx * k * r1, tay - ny * k * r1)} ${pt(trx + dx * k * r1, try_ + dy * k * r1)} ${pt(trx, try_)}`
    + ` L ${pt(brx, bry)}`
    + ` C ${pt(brx - dx * k * r0, bry - dy * k * r0)} ${pt(bbx - nx * k * r0, bby - ny * k * r0)} ${pt(bbx, bby)}`
    + ` C ${pt(bbx + nx * k * r0, bby + ny * k * r0)} ${pt(blx - dx * k * r0, bly - dy * k * r0)} ${pt(blx, bly)} Z`;
}

// Returns one SVG path string per trichome. Same seed → identical canvas + SVG.
function generateAlecrimTrichomes(W: number, H: number, config: PatternConfig): string[] {
  const density = config.density ?? 18;
  const zoom = config.zoom ?? 160;
  const rng = new SeededRandom('alecrim_trichome_v1_' + Math.round(config.layoutSeed ?? 1));

  const nArms = Math.round(config.armCount ?? 5);
  const nBranches = Math.round(config.branchCount ?? 2);
  const spacingN = (config.branchSpacing ?? 50) / 100;
  const armW = strokeWidth(config.lineWidth || 4.2) * 2;

  const armLen = frameRefDim(W, H) * ALECRIM_ARM_RATIO * scaleAtZoom(1, zoom, 'sqrt');

  // Trichomes bleed past the frame by one arm length so edges stay as dense as the middle.
  const pad = armLen;
  const PW = W + pad * 2, PH = H + pad * 2;
  const count = Math.max(4, Math.round(
    targetCount(density, W * H, SPICE_DENSITY_FACTORS.alecrim, zoom, 0.7) * (PW * PH) / (W * H)
  ));
  // Spacing follows count (density), never size (zoom): neighbors interlock into felt.
  const minSep = Math.sqrt((PW * PH) / count) * 0.8;

  const feet: { x: number; y: number }[] = [];
  for (let attempts = 0; feet.length < count && attempts < count * 60; attempts++) {
    const x = rng.range(-pad, W + pad), y = rng.range(-pad, H + pad);
    if (feet.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > minSep * minSep)) feet.push({ x, y });
  }

  // Branch attachment window along the arm: spacing 0 → single fork near the tip,
  // spacing 100 → branches spread from near the foot cell to the tip.
  const tEnd = ALECRIM_BRANCH_TIP_END;
  const tStart = tEnd - spacingN * ALECRIM_BRANCH_SPREAD;

  return feet.map(({ x: cx, y: cy }) => {
    let d = '';
    const a0 = rng.range(0, Math.PI * 2);
    for (let k = 0; k < nArms; k++) {
      const a = a0 + (k * Math.PI * 2) / nArms + rng.range(-0.22, 0.22);
      const L = armLen * rng.range(0.8, 1.2);
      d += alecrimLimbPath(cx, cy, cx + Math.cos(a) * L, cy + Math.sin(a) * L, armW, armW * ALECRIM_TIP_RATIO);

      for (let b = 0; b < nBranches; b++) {
        const t = nBranches === 1 ? (tStart + tEnd) / 2 : tEnd - ((tEnd - tStart) * b) / (nBranches - 1);
        const side = (b % 2 === 0 ? 1 : -1) * (k % 2 === 0 ? 1 : -1);
        // Branches sharing a fork point fan out instead of stacking on the same angle.
        const ang = a + side * (0.5 + 0.2 * Math.floor(b / 2) + rng.range(-0.08, 0.12));
        const bl = L * rng.range(0.36, 0.5) * (1.15 - 0.3 * t);
        const wAt = armW + (armW * ALECRIM_TIP_RATIO - armW) * t;
        const bx = cx + Math.cos(a) * L * t, by = cy + Math.sin(a) * L * t;
        d += ' ' + alecrimLimbPath(bx, by, bx + Math.cos(ang) * bl, by + Math.sin(ang) * bl, wAt * 0.8, armW * 0.32);
      }
      d += ' ';
    }
    // Foot cell: a round hub that hides the arm joints.
    const r = armW * 1.1;
    d += alecrimLimbPath(cx - 0.01, cy, cx + 0.01, cy, r * 2, r * 2);
    return d;
  });
}

export function renderAlecrimMicroscopeGrid(
  ctx: CanvasRenderingContext2D, W: number, H: number, config: PatternConfig
) {
  // Polarity matches Orégano: LIGHT = cream bg + keyColor hairs; DARK = inverted.
  const { bgColor, shapeColor } = deriveSpiceColors('alecrim', config.themeMode);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = shapeColor;
  for (const d of generateAlecrimTrichomes(W, H, config)) ctx.fill(new Path2D(d));
}

// Alecrim SVG — mirrors renderAlecrimMicroscopeGrid exactly (same path strings)
function generateAlecrimSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const { bgColor, shapeColor } = deriveSpiceColorsHex('alecrim', config.themeMode);
  let content = `\n      <rect width="${width}" height="${height}" fill="${bgColor}" />\n  `;
  for (const d of generateAlecrimTrichomes(width, height, config)) {
    content += `    <path d="${d}" fill="${shapeColor}" />\n`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${content}</svg>`;
}

// ─── Grupo Ragga: "Colheita" — the 7 vertical pieces tossed together ────────
//
// Unlike the vertical patterns (one spice under the microscope), the group
// pattern uses the symbol pieces themselves: every vertical side by side, like
// ingredients tossed on a table. Pieces are packed large-first in size tiers so
// the small ones fill the gaps, never touching (collision runs on each piece's
// circle cover from grupoShapes.ts, so canvas and SVG share one layout without
// a canvas), and a shuffled bag keeps the 7 verticals in balanced numbers.

const GRUPO_BASE_RATIO = 0.09;          // medium piece long side / frame long side at zoom=100
const GRUPO_MIN_GAP = 2;                // px at piecesSpacing=0 — collision circles are a cover, keep a hairline so pieces never overlap
const GRUPO_MAX_GAP = 40;               // px at piecesSpacing=100
// [size multiplier at piecesVariation=100, share of the piece count] — big first
const GRUPO_TIERS: [number, number][] = [[1.75, 0.03], [1.25, 0.08], [0.88, 0.17], [0.6, 0.3], [0.42, 0.42]];
const GRUPO_ATTEMPTS_PER_PIECE = 40;

interface GrupoPlacement { piece: number; x: number; y: number; size: number; rot: number }

function generateGrupoLayout(W: number, H: number, config: PatternConfig): GrupoPlacement[] {
  const rng = new SeededRandom('grupo_colheita_v1_' + Math.round(config.layoutSeed ?? 1));
  const zoom = config.zoom ?? 100;
  const variation = (config.piecesVariation ?? 100) / 100;
  const gap = GRUPO_MIN_GAP + ((config.piecesSpacing ?? 25) / 100) * (GRUPO_MAX_GAP - GRUPO_MIN_GAP);
  const spin = (config.piecesRotation ?? 100) / 100;

  const base = frameRefDim(W, H) * GRUPO_BASE_RATIO * scaleAtZoom(1, zoom, 'sqrt');
  const total = targetCount(config.density ?? 24, W * H, SPICE_DENSITY_FACTORS.grupo, zoom, 0.7);
  const sizeOf = (mult: number) => base * (1 + (mult - 1) * variation);
  const maxSize = sizeOf(GRUPO_TIERS[0][0]);
  const pad = maxSize / 2; // pieces bleed past the frame so edges are as full as the middle

  // Spatial hash of placed collision circles. A cover circle never exceeds ~0.4 × piece size.
  const cell = maxSize * 0.8 + gap;
  const grid = new Map<number, { x: number; y: number; r: number }[]>();
  const key = (gx: number, gy: number) => gx * 73856093 ^ gy * 19349663;
  const coverOf = (piece: number, x: number, y: number, size: number, rot: number) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return GRUPO_PIECES[piece].circles.map(([u, v, r]) => ({
      x: x + (u * c - v * s) * size, y: y + (u * s + v * c) * size, r: r * size,
    }));
  };
  const fits = (cover: { x: number; y: number; r: number }[]) => {
    for (const a of cover) {
      const gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
      for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) {
        for (const b of grid.get(key(i, j)) ?? []) {
          const min = a.r + b.r + gap;
          if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < min * min) return false;
        }
      }
    }
    return true;
  };

  // Shuffled bag: every 7 picks contain each vertical once.
  let bag: number[] = [];
  const nextPiece = () => {
    if (!bag.length) {
      bag = GRUPO_PIECES.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    return bag.pop()!;
  };

  const placed: GrupoPlacement[] = [];
  for (const [mult, share] of GRUPO_TIERS) {
    const quota = Math.max(1, Math.round(total * share));
    const size = sizeOf(mult);
    let piece = nextPiece();
    for (let ok = 0, tries = 0; ok < quota && tries < quota * GRUPO_ATTEMPTS_PER_PIECE; tries++) {
      const x = rng.range(-pad, W + pad), y = rng.range(-pad, H + pad);
      const rot = spin * rng.range(-Math.PI, Math.PI);
      const cover = coverOf(piece, x, y, size, rot);
      if (!fits(cover)) continue;
      for (const c of cover) {
        const k = key(Math.floor(c.x / cell), Math.floor(c.y / cell));
        const list = grid.get(k); if (list) list.push(c); else grid.set(k, [c]);
      }
      placed.push({ piece, x, y, size, rot });
      ok++;
      piece = nextPiece();
    }
  }
  return placed;
}

let grupoPathCache: Path2D[] | null = null;
export function renderGrupoMicroscopeGrid(
  ctx: CanvasRenderingContext2D, W: number, H: number, config: PatternConfig
) {
  const { bgColor, shapeColor } = deriveSpiceColors('grupo', config.themeMode);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = shapeColor;
  grupoPathCache ??= GRUPO_PIECES.map((p) => new Path2D(p.d));
  for (const pl of generateGrupoLayout(W, H, config)) {
    const p = GRUPO_PIECES[pl.piece], s = pl.size / p.len;
    ctx.save();
    ctx.translate(pl.x, pl.y);
    ctx.rotate(pl.rot);
    ctx.scale(s, s);
    ctx.translate(-p.cx, -p.cy);
    ctx.fill(grupoPathCache[pl.piece]);
    ctx.restore();
  }
}

// Grupo SVG — mirrors renderGrupoMicroscopeGrid exactly (same layout, same transforms)
function generateGrupoSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const { bgColor, shapeColor } = deriveSpiceColorsHex('grupo', config.themeMode);
  let content = `\n      <rect width="${width}" height="${height}" fill="${bgColor}" />\n  `;
  for (const pl of generateGrupoLayout(width, height, config)) {
    const p = GRUPO_PIECES[pl.piece], s = pl.size / p.len;
    const t = `translate(${pl.x.toFixed(1)} ${pl.y.toFixed(1)}) rotate(${((pl.rot * 180) / Math.PI).toFixed(2)}) scale(${s.toFixed(4)}) translate(${-p.cx} ${-p.cy})`;
    content += `    <path d="${p.d}" transform="${t}" fill="${shapeColor}" />\n`;
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

  if (seasoning.id === 'sal') {
    renderSalMicroscopeGrid(ctx, width, height, config);
    return;
  }

  if (seasoning.id === 'alecrim') {
    renderAlecrimMicroscopeGrid(ctx, width, height, config);
    return;
  }

  if (seasoning.id === 'grupo') {
    renderGrupoMicroscopeGrid(ctx, width, height, config);
    return;
  }

}

// Generate Pimenta SVG — mirrors renderPimentaMicroscopeGrid exactly
function generatePimentaSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['pimenta'];
  // SVG export uses HEX (Figma compatibility).
  const keyColor = oklchToHex(oklchCfg.l, oklchCfg.c, oklchCfg.h);
  const bgColor = isDark ? keyColor : CREAM_HEX;
  const shapeColor = isDark ? CREAM_HEX : keyColor;

  const swooshes = generatePimentaSwooshes(width, height, config);
  let content = `\n      <rect width="${width}" height="${height}" fill="${bgColor}" />\n  `;

  for (const s of swooshes) {
    const g = swooshGeometry(s);
    const d = `M ${g.baseL[0].toFixed(1)} ${g.baseL[1].toFixed(1)} Q ${g.ctrlL[0].toFixed(1)} ${g.ctrlL[1].toFixed(1)} ${g.tip[0].toFixed(1)} ${g.tip[1].toFixed(1)} Q ${g.ctrlR[0].toFixed(1)} ${g.ctrlR[1].toFixed(1)} ${g.baseR[0].toFixed(1)} ${g.baseR[1].toFixed(1)} Q ${g.backCtrl[0].toFixed(1)} ${g.backCtrl[1].toFixed(1)} ${g.baseL[0].toFixed(1)} ${g.baseL[1].toFixed(1)} Z`;
    content += `    <path d="${d}" fill="${shapeColor}" />\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${content}</svg>`;
}

// Oregano SVG — mirrors renderOreganoMicroscopeGrid exactly
function generateOreganoSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['oregano'];
  // SVG export uses HEX (Figma compatibility).
  const keyColor = oklchToHex(oklchCfg.l, oklchCfg.c, oklchCfg.h);
  const bgColor = isDark ? keyColor : CREAM_HEX;
  const cellColor = isDark ? CREAM_HEX : keyColor;

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

  if (seasoning.id === 'sal') {
    return generateSalSVGPatternString(config, width, height);
  }

  if (seasoning.id === 'alecrim') {
    return generateAlecrimSVGPatternString(config, width, height);
  }

  if (seasoning.id === 'grupo') {
    return generateGrupoSVGPatternString(config, width, height);
  }

  // All 8 known spice ids are dispatched above. This branch is unreachable
  // for valid inputs; throw rather than silently return empty SVG.
  throw new Error(`generateSVGPatternString: unknown seasoning id "${seasoning.id}"`);
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
    lineWidth,
    themeMode,
    voronoiRoundedness,
    layoutSeed: seed,
    // Spice-specific contextual parameters — seeded with their registry defaults
    faceting: PARAMETERS.faceting.defaults[spice],
    crystalShape: PARAMETERS.crystalShape.defaults[spice],
    anisotropy: PARAMETERS.anisotropy.defaults[spice],
    mitoticActivity: PARAMETERS.mitoticActivity.defaults[spice],
    curvature: PARAMETERS.curvature.defaults[spice],
    flowCohesion: PARAMETERS.flowCohesion.defaults[spice],
    leavesPerRosette: PARAMETERS.leavesPerRosette.defaults[spice],
    leafShape: PARAMETERS.leafShape.defaults[spice],
    rosetteVariation: PARAMETERS.rosetteVariation.defaults[spice],
    clusterSpread: PARAMETERS.clusterSpread.defaults[spice],
    capsuleElongation: PARAMETERS.capsuleElongation.defaults[spice],
    armCount: PARAMETERS.armCount.defaults[spice],
    branchCount: PARAMETERS.branchCount.defaults[spice],
    branchSpacing: PARAMETERS.branchSpacing.defaults[spice],
    piecesVariation: PARAMETERS.piecesVariation.defaults[spice],
    piecesSpacing: PARAMETERS.piecesSpacing.defaults[spice],
    piecesRotation: PARAMETERS.piecesRotation.defaults[spice],
  };
}


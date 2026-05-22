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
  pimenta: { l: 0.58, c: 0.21, h: 40, fallback: '#E86820' },
  manjericao: { l: 0.35, c: 0.16, h: 350, fallback: '#8A2040' },
  oregano: { l: 0.71, c: 0.17, h: 115, fallback: '#93B629' }
};

// Neutral cream pole used in all theme inversions
const CREAM = 'oklch(96% 0.008 88.75)';

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
  const M = Math.max(2, Math.min(22, Math.round(Math.sqrt(totalCount))));

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

  // Mirrors canvas density semantics exactly — same factor, same formula.
  const density = config.density ?? 40;
  const totalCount = targetCount(density, width * height, SPICE_DENSITY_FACTORS.louro, config.zoom ?? 100, true);
  const M = Math.max(2, Math.min(22, Math.round(Math.sqrt(totalCount))));

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
  const M = Math.max(2, Math.min(22, Math.round(Math.sqrt(totalCount))));

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

  // Mirrors canvas exactly — see renderGarlicMicroscopeGrid above.
  const density = config.density ?? 40;
  const totalCount = targetCount(density, width * height, SPICE_DENSITY_FACTORS.alho, config.zoom ?? 100, true);
  const M = Math.max(2, Math.min(22, Math.round(Math.sqrt(totalCount))));

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

  // Canonical density semantics — see VISUAL_CALIBRATION.md.
  // SPICE_DENSITY_FACTORS.pimenta = 1.39 → M=3 at curated default (zoom=340, density=22).
  // Pimenta caps M at 11 (vs 22 for Louro/Alho): its multi-scale seeding adds a
  // clustered small-cell layer on top of the M×M sparse layer, so capping the
  // macro grid earlier prevents the canvas from drowning in tiny cells.
  const density = config.density ?? 40;
  const totalCount = targetCount(density, W * H, SPICE_DENSITY_FACTORS.pimenta, config.zoom ?? 100, true);
  const M = Math.max(2, Math.min(11, Math.round(Math.sqrt(totalCount))));
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
      pathFromBlobPoints(ctx, organicShape(0, 0, particle.r, particle.r, 5, particleRng, 0.06));
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
  const zoom = config.zoom ?? 100;
  const globalAngle = ((config.rotation ?? 0) * Math.PI) / 180;
  const rng = new SeededRandom('oregano_spore_v2_' + Math.round(config.layoutSeed ?? 1));

  // SIZE: sqrt(zoom/100) instead of linear zm. At zoom=1200 capsules grow ~3.46×
  // instead of ~12×, keeping the optical microscopy feel (cells never dominate frame).
  // Calibration: 0.0544 baseline anchors capsule size at the legacy value (~77px) when
  // zoom=140 (Orégano curated default).
  const baseH = Math.min(W, H) * 0.0544 * scaleAtZoom(1, zoom, 'sqrt');
  const minDist = baseH * 1.1;

  // COUNT: canonical targetCount with strength=0.7 (mid-feature, gentle reduction).
  // At default (zoom=140, density=28) yields ~50 — matches legacy.
  // At zoom=1200 yields ~10 — readable microscopy view, no overcrowding.
  const desiredCount = Math.max(8, targetCount(density, W * H, SPICE_DENSITY_FACTORS.oregano, zoom, 0.7));

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
  while (spores.length < desiredCount && attempts < desiredCount * 50) {
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

function pathCrystalCanvas(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function svgCrystalPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 3) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  return d + ' Z';
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
  const baseR = Math.min(W, H) * 0.026 * scaleAtZoom(1, zoom, 'sqrt');
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
    const shapeRoll = rng.range(0, 1);
    let sides: number, jagged: number;
    if (shapeRoll < 0.60) { sides = 4; jagged = 0.06; }
    else if (shapeRoll < 0.85) { sides = 6; jagged = 0.09; }
    else { sides = 8; jagged = 0.13; }
    if (sizeRoll >= 0.95) jagged += 0.07; // large plates fracture more
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
      const spread = Math.min(W, H) * rng.range(0.06, 0.42);
      const a = rng.range(0, Math.PI * 2);
      place(cc.x + Math.cos(a) * spread * rng.range(0, 1), cc.y + Math.sin(a) * spread * rng.range(0, 1));
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
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  // Mirrors canvas — see renderSalMicroscopeGrid polarity note.
  const bgColor = isDark ? keyColor : CREAM;
  const shapeColor = isDark ? CREAM : keyColor;

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
  const rng = new SeededRandom('basil_layout_v3_' + seed);
  const density = config.density ?? 16;
  const zoom = config.zoom ?? 100;
  const minDim = Math.min(W, H);
  const viewportArea = W * H;

  // ─── Per-layer optical scaling ─────────────────────────────────────────────
  //
  // Real microscopy doesn't scale all features equally as you change objective:
  //   - Macro features (whole cell walls, trichome hairs) → fewer, larger
  //   - Mid features (chloroplast clusters)              → fewer, larger
  //   - Substrate features (grains, suspended particles) → density stays high
  //                                                        size grows mildly
  //   - Filament thickness                               → nearly constant
  //
  // Each layer gets its own (countFactor, countZoomReduceStrength, sizeMode).
  // Factors calibrated so total counts at the curated default (zoom=260,
  // density=16) approximately match the prior implementation, preserving
  // perceptual identity at the default config. Below 260x more structures
  // appear; above 260x macro structures fade while substrate stays.

  // Step 1: biomass density centers — unchanged (procedural detail, not a
  // perceptual layer; their count drives WHERE structures land, not what
  // the viewer counts).
  const nClusters = 4 + Math.floor(rng.range(0, 5));
  const clusters: { cx: number; cy: number; r: number }[] = [];
  for (let i = 0; i < nClusters; i++) {
    clusters.push({
      cx: rng.range(-0.1, 1.1) * W,
      cy: rng.range(-0.1, 1.1) * H,
      r: rng.range(0.15, 0.42) * minDim,
    });
  }

  const samplePoint = (clusterBias: number): { x: number; y: number } => {
    if (rng.range(0, 1) < clusterBias) {
      const c = clusters[Math.floor(rng.range(0, clusters.length))];
      const a = rng.range(0, Math.PI * 2);
      const d = c.r * Math.sqrt(rng.range(0, 1));
      return { x: c.cx + Math.cos(a) * d, y: c.cy + Math.sin(a) * d };
    }
    return { x: rng.range(0, W), y: rng.range(0, H) };
  };

  // Layer 2: MEMBRANES — macro feature, linear count reduction, sqrt size growth
  // factor=2.11, strength=1.0 → ~13 at curated default; 34 at 100x; 3 at 1200x
  const nMembranes = targetCount(density, viewportArea, 2.11, zoom, 1.0);
  const memSizeScale = scaleAtZoom(1, zoom, 'sqrt');
  const membranes: BasilLayout['membranes'] = [];
  for (let i = 0; i < nMembranes; i++) {
    const pos = samplePoint(0.55);
    // Multi-scale: 30% tiny, 50% medium, 20% large
    const sizeRoll = rng.range(0, 1);
    let sizeBase: number;
    if (sizeRoll < 0.30) sizeBase = rng.range(0.035, 0.060);
    else if (sizeRoll < 0.80) sizeBase = rng.range(0.060, 0.110);
    else sizeBase = rng.range(0.110, 0.180);
    const baseR = sizeBase * minDim * memSizeScale;
    membranes.push({
      cx: pos.x,
      cy: pos.y,
      rx: baseR * rng.range(0.75, 1.30),
      ry: baseR * rng.range(0.75, 1.30),
      seed: 'basil_mem_' + i + '_' + seed,
      points: 14 + Math.floor(rng.range(0, 9)),
    });
  }

  // Layer 3: CHLOROPLAST CLUSTERS — mid feature, gentle count reduction (strength 0.7),
  //                                 sqrt size growth
  // factor=5.13, strength=0.7 → ~40 at curated default; 82 at 100x; 13 at 1200x
  const nChloroplasts = targetCount(density, viewportArea, 5.13, zoom, 0.7);
  const chSizeScale = scaleAtZoom(1, zoom, 'sqrt');
  const chloroplasts: BasilLayout['chloroplasts'] = [];
  for (let i = 0; i < nChloroplasts; i++) {
    const pos = samplePoint(0.82);
    const sizeRoll = rng.range(0, 1);
    let baseR: number;
    if (sizeRoll < 0.60) baseR = rng.range(0.012, 0.025) * minDim * chSizeScale;
    else if (sizeRoll < 0.92) baseR = rng.range(0.025, 0.045) * minDim * chSizeScale;
    else baseR = rng.range(0.045, 0.075) * minDim * chSizeScale;
    chloroplasts.push({
      x: pos.x,
      y: pos.y,
      rx: baseR * rng.range(0.85, 1.20),
      ry: baseR * rng.range(0.85, 1.20),
      seed: 'basil_cl_' + i + '_' + seed,
      points: 8 + Math.floor(rng.range(0, 5)),
    });
  }

  // Layer 4: GRAINS — substrate, no count reduction (always plentiful), sqrt size growth
  // factor=45.0, strength=0 → 720 at any zoom (density=16)
  const nGrains = targetCount(density, viewportArea, 45.0, zoom, 0);
  const grainSizeScale = scaleAtZoom(1, zoom, 'sqrt');
  const grains: BasilLayout['grains'] = [];
  for (let i = 0; i < nGrains; i++) {
    const pos = samplePoint(0.90);
    grains.push({
      x: pos.x,
      y: pos.y,
      r: rng.range(1.2, 4.0) * grainSizeScale,
      seed: 'basil_g_' + i + '_' + seed,
    });
  }

  // Layer 5: TRICHOMES — strong count reduction (strength 1.2, faster than linear),
  //                      length grows with sqrt, thickness nearly absolute
  // factor=1.96, strength=1.2 → ~10 at curated default; 31 at 100x; 2 at 1200x
  const nTrichomes = targetCount(density, viewportArea, 1.96, zoom, 1.2);
  const triLengthScale = scaleAtZoom(1, zoom, 'sqrt');
  // Thickness: "almost absolute" — start with sqrt, attenuate to ~0.3 of its growth
  //   At 100x: 1.0×;  at 260x: ~1.18× ; at 1200x: ~1.74×  (much less than full sqrt's 3.46×)
  const triThickScale = 1 + (scaleAtZoom(1, zoom, 'sqrt') - 1) * 0.3;
  const trichomes: BasilLayout['trichomes'] = [];
  const rotBase = ((config.rotation ?? 0) * Math.PI) / 180;
  for (let i = 0; i < nTrichomes; i++) {
    const start = samplePoint(0.55);
    const len = rng.range(0.06, 0.22) * minDim * triLengthScale;
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
      thickness: rng.range(1.8, 4.5) * triThickScale,
      seed: 'basil_t_' + i + '_' + seed,
    });
  }

  // Layer 6: MICRO-PARTICLES — background noise, no count reduction, absolute size
  // factor=55, strength=0 → 880 at any zoom (density=16)
  // Size stays absolute: tiny dots are pixel-resolution markers; growing them
  // would turn the background into noise dots rather than the intended "grain"
  const nMicro = targetCount(density, viewportArea, 55.0, zoom, 0);
  const microParticles: BasilLayout['microParticles'] = [];
  for (let i = 0; i < nMicro; i++) {
    const pos = samplePoint(0.4);
    microParticles.push({
      x: pos.x,
      y: pos.y,
      r: rng.range(0.30, 1.0), // absolute pixel size
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
    const pts = organicShape(m.cx, m.cy, m.rx, m.ry, m.points, m.seed, 0.28);
    pathFromBlobPoints(ctx, pts);
    ctx.stroke();
  }

  // Layer 2: Medium chloroplast clusters (filled organic blobs)
  ctx.fillStyle = shapeColor;
  for (const c of layout.chloroplasts) {
    const pts = organicShape(c.x, c.y, c.rx, c.ry, c.points, c.seed, 0.22);
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
    pathFromBlobPoints(ctx, organicShape(0, 0, g.r, g.r, 6, grainRng, 0.18));
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
    const pts = organicShape(m.cx, m.cy, m.rx, m.ry, m.points, m.seed, 0.28);
    const d = svgFromBlobPoints(pts);
    if (d) content += `    <path d="${d}" fill="none" stroke="${shapeColor}" stroke-width="${strokeW}" stroke-linejoin="round" />\n`;
  }

  // Layer 2: medium chloroplast clusters (filled)
  for (const c of layout.chloroplasts) {
    const pts = organicShape(c.x, c.y, c.rx, c.ry, c.points, c.seed, 0.22);
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
    const d = svgFromBlobPoints(organicShape(g.x, g.y, g.r, g.r, 6, grainRng, 0.18));
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

  if (seasoning.id === 'sal') {
    renderSalMicroscopeGrid(ctx, width, height, config);
    return;
  }

}

// Generate Pimenta SVG — mirrors renderPimentaMicroscopeGrid exactly (same seeds, same Voronoi, same insetPolyPx)
function generatePimentaSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['pimenta'];

  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;

  const W = width, H = height;
  let tileContent = `\n      <rect width="${W}" height="${H}" fill="${isDark ? CREAM : keyColor}" />\n  `;

  // Mirrors canvas exactly — see renderPimentaMicroscopeGrid above.
  const density = config.density ?? 40;
  const totalCount = targetCount(density, W * H, SPICE_DENSITY_FACTORS.pimenta, config.zoom ?? 100, true);
  const M = Math.max(2, Math.min(11, Math.round(Math.sqrt(totalCount))));
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
      const particlePath = svgFromBlobPoints(organicShape(particle.x, particle.y, particle.r, particle.r, 5, particleRng, 0.06));
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

  if (seasoning.id === 'sal') {
    return generateSalSVGPatternString(config, width, height);
  }

  // All 6 known spice ids are dispatched above. This branch is unreachable
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
  };
}


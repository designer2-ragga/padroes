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
  pimenta: { l: 0.665, c: 0.177, h: 45, fallback: '#E86820' },
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
const PIMENTA_FLOW_SCALE_RATIO = 0.45;     // flow-field scale / minDim — controls how smoothly the wind varies

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
  const minDim = Math.min(W, H);
  const flowScale = minDim * PIMENTA_FLOW_SCALE_RATIO;

  // Base length — ~6% of minDim at zoom=100, scales with sqrt of zoom.
  // At default (zoom=340): ~133px tip-to-base. Smaller than v3 to allow more
  // swooshes to show the flow direction clearly.
  const baseLen = minDim * 0.06 * scaleAtZoom(1, zoom, 'sqrt');
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
    // place — some sideways, some upside-down, some aligned with the flow.
    // The result reads as "pimentas tumbling in a current", not marching ranks.
    let angle = pimentaFlowAngle(px, py, flowScale, seed) + rng.range(-0.9, 0.9);
    if (rng.range(0, 1) < 0.35) angle += Math.PI; // 35% flip — counter-current pimentas
    // Curve direction tied to local flow (neighbors still hook similarly)
    const curveDir = Math.sin(pimentaFlowAngle(px + flowScale, py, flowScale, seed) - angle) < 0 ? -1 : 1;
    // Gentle curve — strong enough to read as chili bend, weak enough to NOT look
    // like a banana/crescent/eyebrow (which would emerge with strong curve + symmetric ends)
    const curve = curveDir * length * rng.range(0.12, 0.22);
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
  const baseH = Math.min(W, H) * 0.0544 * scaleAtZoom(1, zoom, 'sqrt');
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

  const spores: OreganoSpore[] = [];
  const addSpore = (px: number, py: number): boolean => {
    // Compute actual size/orientation BEFORE validation so the check is size-aware.
    // Rejected candidates consume 3 rng draws — intentional, ensures stable per-call
    // RNG cost and prevents oscillation between rejection states.
    const halfH = baseH * rng.range(0.70, 1.30);
    const aspect = rng.range(0.48, 0.78);
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
    if (shapeRoll < 0.60) { sides = 5; jagged = 0.06; }
    else if (shapeRoll < 0.85) { sides = 7; jagged = 0.09; }
    else { sides = 9; jagged = 0.13; }
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
  cx: number; cy: number;   // base attachment point (rosette center)
  angle: number;            // direction the tip points (from center outward)
  length: number;
  maxWidth: number;         // max half-width at widest point (ovate leaf profile)
}

interface BasilLayout {
  leaves: BasilLeaf[];
}

// Rosette density and proportion constants
const ROSETTE_DENSITY_FACTOR = 0.4;        // → ~6 rosettes at default
const LEAF_WIDTH_RATIO = 0.26;             // maxWidth / length — basil leaf proportions (~2:1 ovate)
const LEAF_PETIOLE_OFFSET = 0.08;          // base offset from rosette center / length (implicit petiole gap)
const LEAF_MIDRIB_THICKNESS_RATIO = 0.012; // midrib stroke width / length

// Botanically-accurate basil leaf geometry. Basil (Ocimum basilicum) has
// OVATE leaves: ~2:1 length-to-width, widest in the lower-middle, with
// ACUMINATE apex (gradually tapering to a sharp tip) and ATTENUATE base
// (gradually tapering to the petiole/stem).
//
// Construction: cubic Bezier per side with two width-control points placed
// to produce the asymmetric ovate profile:
//   - t1=0.32, w1=1.10×maxWidth → wide bulge in lower-middle (ovate widest)
//   - t2=0.72, w2=0.45×maxWidth → quick taper to acuminate tip
// A small petiole offset from the rosette center creates a visible gap
// between the leaf bases — the implicit petiole/stem attachment point.
function leafGeometry(l: BasilLeaf): {
  base: [number, number];
  outA: [number, number]; outB: [number, number];
  tip:  [number, number];
  inA:  [number, number]; inB:  [number, number];
  midribStart: [number, number]; midribEnd: [number, number];
} {
  const dx = Math.cos(l.angle), dy = Math.sin(l.angle);
  const px = -dy, py = dx;
  // Petiole gap — leaf doesn't start at rosette center, but slightly outward
  const petX = l.cx + dx * l.length * LEAF_PETIOLE_OFFSET;
  const petY = l.cy + dy * l.length * LEAF_PETIOLE_OFFSET;
  // Effective blade length (after subtracting petiole offset)
  const bladeLen = l.length * (1 - LEAF_PETIOLE_OFFSET);
  const t1 = 0.32;  // lower-middle (widest)
  const t2 = 0.72;  // upper-third
  const w1 = l.maxWidth * 1.10;  // ovate bulge — widest below middle
  const w2 = l.maxWidth * 0.45;  // acuminate taper toward tip
  const sp1X = petX + dx * bladeLen * t1;
  const sp1Y = petY + dy * bladeLen * t1;
  const sp2X = petX + dx * bladeLen * t2;
  const sp2Y = petY + dy * bladeLen * t2;
  const tipX = petX + dx * bladeLen;
  const tipY = petY + dy * bladeLen;
  return {
    base: [petX, petY],
    outA: [sp1X + px * w1, sp1Y + py * w1],
    outB: [sp2X + px * w2, sp2Y + py * w2],
    tip:  [tipX, tipY],
    inA:  [sp2X - px * w2, sp2Y - py * w2],
    inB:  [sp1X - px * w1, sp1Y - py * w1],
    // Midrib (central vein) — base of blade to slightly before tip
    midribStart: [petX, petY],
    midribEnd:   [petX + dx * bladeLen * 0.92, petY + dy * bladeLen * 0.92],
  };
}

function generateBasilLayout(W: number, H: number, config: PatternConfig): BasilLayout {
  const seed = Math.round(config.layoutSeed ?? 1);
  const rng = new SeededRandom('basil_rosette_v7_' + seed);
  const density = config.density ?? 16;
  const zoom = config.zoom ?? 100;
  const minDim = Math.min(W, H);
  const sizeScale = scaleAtZoom(1, zoom, 'sqrt');

  // Per-rosette leaf length (each rosette has its own scale around this base)
  const baseLeafLen = minDim * 0.10 * sizeScale;
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
    let nLeaves: number;
    if (countRoll < 0.45) nLeaves = 4;        // 45% — youngest 4-leaf cross
    else if (countRoll < 0.75) nLeaves = 6;   // 30% — 6-leaf rosette
    else nLeaves = 8;                          // 25% — full 8-leaf rosette

    const baseRot = rng.range(0, Math.PI * 2);
    for (let i = 0; i < nLeaves; i++) {
      const angle = baseRot + (i / nLeaves) * Math.PI * 2 + rng.range(-0.08, 0.08);
      const lenVar = rosetteSize * rng.range(0.85, 1.15);
      const widthVar = lenVar * LEAF_WIDTH_RATIO * rng.range(0.85, 1.10);
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

  // Pass 1: filled leaf blades
  for (const leaf of layout.leaves) {
    const g = leafGeometry(leaf);
    ctx.beginPath();
    ctx.moveTo(g.base[0], g.base[1]);
    ctx.bezierCurveTo(g.outA[0], g.outA[1], g.outB[0], g.outB[1], g.tip[0], g.tip[1]);
    ctx.bezierCurveTo(g.inA[0], g.inA[1], g.inB[0], g.inB[1], g.base[0], g.base[1]);
    ctx.closePath();
    ctx.fill();
  }

  // Pass 2: midribs (central vein) — drawn in bg color to appear as a
  // negative line carved out of each leaf. This is the most identifiable
  // visual feature of basil leaves viewed from above.
  ctx.strokeStyle = bgColor;
  ctx.lineCap = 'round';
  for (const leaf of layout.leaves) {
    const g = leafGeometry(leaf);
    ctx.lineWidth = leaf.length * LEAF_MIDRIB_THICKNESS_RATIO;
    ctx.beginPath();
    ctx.moveTo(g.midribStart[0], g.midribStart[1]);
    ctx.lineTo(g.midribEnd[0], g.midribEnd[1]);
    ctx.stroke();
  }
}

// Manjericão SVG — mirrors renderManjericaoMicroscopeGrid exactly
function generateManjericaoSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['manjericao'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  const bgColor = isDark ? keyColor : CREAM;
  const shapeColor = isDark ? CREAM : keyColor;

  const layout = generateBasilLayout(width, height, config);
  let content = `\n      <rect width="${width}" height="${height}" fill="${bgColor}" />\n  `;

  // Pass 1: filled leaf blades
  for (const leaf of layout.leaves) {
    const g = leafGeometry(leaf);
    const d = `M ${g.base[0].toFixed(1)} ${g.base[1].toFixed(1)} C ${g.outA[0].toFixed(1)} ${g.outA[1].toFixed(1)}, ${g.outB[0].toFixed(1)} ${g.outB[1].toFixed(1)}, ${g.tip[0].toFixed(1)} ${g.tip[1].toFixed(1)} C ${g.inA[0].toFixed(1)} ${g.inA[1].toFixed(1)}, ${g.inB[0].toFixed(1)} ${g.inB[1].toFixed(1)}, ${g.base[0].toFixed(1)} ${g.base[1].toFixed(1)} Z`;
    content += `    <path d="${d}" fill="${shapeColor}" />\n`;
  }

  // Pass 2: midribs (negative central vein, drawn in bg color)
  for (const leaf of layout.leaves) {
    const g = leafGeometry(leaf);
    const w = (leaf.length * LEAF_MIDRIB_THICKNESS_RATIO).toFixed(2);
    content += `    <line x1="${g.midribStart[0].toFixed(1)}" y1="${g.midribStart[1].toFixed(1)}" x2="${g.midribEnd[0].toFixed(1)}" y2="${g.midribEnd[1].toFixed(1)}" stroke="${bgColor}" stroke-width="${w}" stroke-linecap="round" />\n`;
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

// Generate Pimenta SVG — mirrors renderPimentaMicroscopeGrid exactly
function generatePimentaSVGPatternString(config: PatternConfig, width: number, height: number): string {
  const isDark = config.themeMode === 'dark';
  const oklchCfg = SEASONINGS_OKLCH['pimenta'];
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  const bgColor = isDark ? keyColor : CREAM;
  const shapeColor = isDark ? CREAM : keyColor;

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
  const keyColor = `oklch(${oklchCfg.l * 100}% ${oklchCfg.c} ${oklchCfg.h})`;
  // Mirrors canvas — see renderOreganoMicroscopeGrid polarity note.
  const bgColor = isDark ? keyColor : CREAM;
  const cellColor = isDark ? CREAM : keyColor;

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


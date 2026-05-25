/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Risograph shader — simulates two-color riso print: the shape rendered
 * twice in two layers (one in shapeColor, one in a darker accent),
 * each layer offset by a few px, with grain noise overlay. Zine /
 * indie-press aesthetic.
 */

import { ShaderContext, buildCoverageMap } from './index';

// Riso accent — warm gray/black for the offset layer, regardless of theme
const RISO_ACCENT = '#1A1814';

function makeRng(seed: number) {
  let s = (seed | 0) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Render a "tinted shape" canvas: transparent except where coverage = 1,
// where pixels are filled with the given color.
function makeTintedCanvas(coverage: Uint8Array, W: number, H: number, hex: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  // Parse hex/css color via probe
  const probe = document.createElement('canvas');
  probe.width = 1; probe.height = 1;
  const pc = probe.getContext('2d');
  if (!pc) return canvas;
  pc.fillStyle = hex;
  pc.fillRect(0, 0, 1, 1);
  const [r, g, b] = pc.getImageData(0, 0, 1, 1).data;

  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let p = 0, i = 0; p < coverage.length; p++, i += 4) {
    if (coverage[p]) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export function applyRisograph(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor, config } = c;

  // Background
  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);
  const off = Math.max(2, Math.round(Math.min(W, H) / 250));

  // Build two tinted-shape canvases
  const accentLayer = makeTintedCanvas(coverage, W, H, RISO_ACCENT);
  const mainLayer = makeTintedCanvas(coverage, W, H, shapeColor);

  // Pass 1: accent offset down-right (slight transparency for color mixing illusion)
  dst.save();
  dst.globalAlpha = 0.65;
  dst.drawImage(accentLayer, off, off);
  dst.restore();

  // Pass 2: main shapeColor layer, offset up-left (full opacity)
  dst.drawImage(mainLayer, -Math.round(off * 0.4), -Math.round(off * 0.4));

  // Grain noise overlay
  const rng = makeRng(Math.round(config.layoutSeed ?? 1) ^ 0xB1750);
  const imageData = dst.getImageData(0, 0, W, H);
  const data = imageData.data;
  const grainStrength = 14;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rng() - 0.5) * grainStrength;
    data[i]     = Math.max(0, Math.min(255, data[i]     + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  dst.putImageData(imageData, 0, 0);
}

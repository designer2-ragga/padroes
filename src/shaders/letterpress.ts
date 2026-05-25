/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Letterpress shader — simulates debossed printing. The shape is rendered
 * as light highlight (top-left offset) + dark shadow (bottom-right offset)
 * + main shape in bg color (visually merging with background, leaving only
 * the shadow-rim around the shape edge). Premium printed-paper / tactile
 * editorial aesthetic.
 */

import { ShaderContext, buildCoverageMap } from './index';

// Sample a CSS color into [R, G, B]
function sampleColor(color: string): [number, number, number] {
  const probe = document.createElement('canvas');
  probe.width = 1; probe.height = 1;
  const ctx = probe.getContext('2d');
  if (!ctx) return [128, 128, 128];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

function shiftRGB(rgb: [number, number, number], pct: number): [number, number, number] {
  const [r, g, b] = rgb;
  const shift = (v: number) => {
    const nv = pct > 0
      ? v + (255 - v) * pct
      : v + v * pct;
    return Math.max(0, Math.min(255, Math.round(nv)));
  };
  return [shift(r), shift(g), shift(b)];
}

// Build a canvas where coverage pixels are filled with the given RGB color
function makeTintedShape(coverage: Uint8Array, W: number, H: number, rgb: [number, number, number]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let p = 0, i = 0; p < coverage.length; p++, i += 4) {
    if (coverage[p]) {
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function applyLetterpress(c: ShaderContext): void {
  const { dst, src, W, H, bgColor } = c;

  // Background
  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);
  const off = Math.max(2, Math.round(Math.min(W, H) / 400));

  const bgRGB = sampleColor(bgColor);
  const lightRGB = shiftRGB(bgRGB, 0.18);   // +18% toward white
  const darkRGB  = shiftRGB(bgRGB, -0.30);  // -30% toward black

  const lightLayer = makeTintedShape(coverage, W, H, lightRGB);
  const darkLayer  = makeTintedShape(coverage, W, H, darkRGB);
  const fillLayer  = makeTintedShape(coverage, W, H, bgRGB);

  // Layer 1: light highlight offset top-left
  dst.drawImage(lightLayer, -off, -off);
  // Layer 2: dark shadow offset bottom-right
  dst.drawImage(darkLayer, off, off);
  // Layer 3: main shape filled with bg color (merges with background visually,
  // leaving only the offset shadow rims as visible relief)
  dst.drawImage(fillLayer, 0, 0);
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Letterpress shader — debossed-print simulation with light highlight +
 * dark shadow + bg-color fill, finished with paper grain to feel like
 * pressed cotton paper. Premium tactile editorial aesthetic.
 */

import { ShaderContext, buildCoverageMap } from './index';
import { addPaperGrain } from './_texture';

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
    const nv = pct > 0 ? v + (255 - v) * pct : v + v * pct;
    return Math.max(0, Math.min(255, Math.round(nv)));
  };
  return [shift(r), shift(g), shift(b)];
}

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
  const { dst, src, W, H, bgColor, config } = c;
  const seed = Math.round(config.layoutSeed ?? 1) ^ 0x1E771E;

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);
  const off = Math.max(2, Math.round(Math.min(W, H) / 400));

  const bgRGB = sampleColor(bgColor);
  const lightRGB = shiftRGB(bgRGB, 0.18);
  const darkRGB  = shiftRGB(bgRGB, -0.30);

  const lightLayer = makeTintedShape(coverage, W, H, lightRGB);
  const darkLayer  = makeTintedShape(coverage, W, H, darkRGB);
  const fillLayer  = makeTintedShape(coverage, W, H, bgRGB);

  dst.drawImage(lightLayer, -off, -off);
  dst.drawImage(darkLayer, off, off);
  dst.drawImage(fillLayer, 0, 0);

  // Cotton-paper grain — patchy noise simulates pressed paper texture
  addPaperGrain(dst, W, H, seed, 14, 2);
}

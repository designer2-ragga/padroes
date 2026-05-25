/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Risograph shader — two-color offset print with shape rendered twice
 * (offset accent + main color) + heavy paper grain + ink density variance.
 * Zine / indie-press aesthetic.
 */

import { ShaderContext, buildCoverageMap } from './index';
import { makeRng, addPaperGrain } from './_texture';

const RISO_ACCENT = '#1A1814';

function makeTintedCanvas(coverage: Uint8Array, W: number, H: number, hex: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
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
  const seed = Math.round(config.layoutSeed ?? 1) ^ 0xB1750;

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);
  const off = Math.max(2, Math.round(Math.min(W, H) / 250));

  const accentLayer = makeTintedCanvas(coverage, W, H, RISO_ACCENT);
  const mainLayer = makeTintedCanvas(coverage, W, H, shapeColor);

  // Accent layer offset down-right with transparency for color blending
  dst.save();
  dst.globalAlpha = 0.6;
  dst.drawImage(accentLayer, off, off);
  dst.restore();

  // Main color layer with slight transparency for ink-mixing feel
  dst.save();
  dst.globalAlpha = 0.92;
  dst.drawImage(mainLayer, -Math.round(off * 0.4), -Math.round(off * 0.4));
  dst.restore();

  // Heavy multi-scale grain (riso is famous for its noisy texture)
  addPaperGrain(dst, W, H, seed, 18, 1);
  addPaperGrain(dst, W, H, seed ^ 0xFADE, 8, 3);
}

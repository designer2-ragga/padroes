/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cyanotype shader — Prussian-blue/cream palette swap with patchy
 * chemical-wash variation + paper grain. Anna Atkins / blueprint
 * scientific archive aesthetic.
 */

import { ShaderContext, buildCoverageMap } from './index';
import { makeRng, addPaperGrain } from './_texture';

const CYANO_BG = '#0F3361';
const CYANO_FG = '#F4EFE0';

export function applyCyanotype(c: ShaderContext): void {
  const { dst, src, W, H, config } = c;
  const seed = Math.round(config.layoutSeed ?? 1) ^ 0xCAFE5;
  const rng = makeRng(seed);

  dst.fillStyle = CYANO_BG;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);
  const imageData = dst.getImageData(0, 0, W, H);
  const data = imageData.data;

  const fgR = parseInt(CYANO_FG.slice(1, 3), 16);
  const fgG = parseInt(CYANO_FG.slice(3, 5), 16);
  const fgB = parseInt(CYANO_FG.slice(5, 7), 16);

  // Chemical-wash patches — irregular brightness variations across the bg
  // sampled at multiple low-frequency scales for organic blotchy feel.
  const patchSeed1 = rng() * 1000;
  const patchSeed2 = rng() * 1000;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const i = p * 4;
      if (coverage[p]) {
        data[i] = fgR;
        data[i + 1] = fgG;
        data[i + 2] = fgB;
      } else {
        // Smooth chemical patches — sin/cos low-freq variation
        const wash = Math.sin((x + patchSeed1) * 0.008) * Math.cos((y + patchSeed2) * 0.011);
        const delta = wash * 18;
        data[i]     = clamp(data[i]     + delta);
        data[i + 1] = clamp(data[i + 1] + delta);
        data[i + 2] = clamp(data[i + 2] + delta);
      }
    }
  }
  dst.putImageData(imageData, 0, 0);

  // High-frequency paper grain on top
  addPaperGrain(dst, W, H, seed, 18, 2);
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cyanotype shader — replaces the entire palette with the iconic Prussian-
 * blue/cream of cyanotype photographic prints. Adds subtle grain texture
 * for the chemical-paper feel. Blueprint / Anna Atkins scientific archive
 * aesthetic.
 */

import { ShaderContext, buildCoverageMap } from './index';

// Cyanotype palette: Prussian blue background, off-white/cream shapes
const CYANO_BG = '#0F3361';      // deep Prussian blue
const CYANO_FG = '#F4EFE0';      // creamy paper white

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

export function applyCyanotype(c: ShaderContext): void {
  const { dst, src, W, H, config } = c;

  // Fill canvas with cyanotype blue background
  dst.fillStyle = CYANO_BG;
  dst.fillRect(0, 0, W, H);

  // Paint each shape pixel as cyanotype cream
  const coverage = buildCoverageMap(src, W, H);
  const imageData = dst.getImageData(0, 0, W, H);
  const data = imageData.data;

  // Parse CYANO_FG hex
  const fgR = parseInt(CYANO_FG.slice(1, 3), 16);
  const fgG = parseInt(CYANO_FG.slice(3, 5), 16);
  const fgB = parseInt(CYANO_FG.slice(5, 7), 16);

  for (let p = 0, i = 0; p < coverage.length; p++, i += 4) {
    if (coverage[p]) {
      data[i] = fgR;
      data[i + 1] = fgG;
      data[i + 2] = fgB;
    }
  }

  // Add chemical-paper grain: random subtle brightness variation across the bg
  const rng = makeRng(Math.round(config.layoutSeed ?? 1) ^ 0xCAFE5);
  const grainBudget = Math.round(W * H * 0.015);
  for (let n = 0; n < grainBudget; n++) {
    const idx = Math.floor(rng() * coverage.length);
    const i = idx * 4;
    // Only grain on bg pixels
    if (!coverage[idx]) {
      const delta = (rng() - 0.5) * 30;
      data[i]     = Math.max(0, Math.min(255, data[i]     + delta));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + delta));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + delta));
    }
  }

  dst.putImageData(imageData, 0, 0);
}

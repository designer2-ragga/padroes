/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stippling shader — fills "shape" pixels with scattered random dots.
 * Density of dots is proportional to local coverage. Technical-drawing /
 * pointillism aesthetic. Deterministic via layoutSeed-derived seed.
 */

import { ShaderContext, buildCoverageMap, sampleCoverage } from './index';

// Mulberry32 PRNG — same algorithm as engine SeededRandom for deterministic dots
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

export function applyStippling(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor, config } = c;

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);

  // Number of dot attempts — total budget proportional to canvas area.
  const totalAttempts = Math.round(W * H * 0.025);
  const dotR = Math.max(0.7, Math.min(W, H) / 700);
  const sampleSize = Math.max(4, Math.round(Math.min(W, H) / 200));

  const rng = makeRng(Math.round(config.layoutSeed ?? 1) ^ 0xA1B2C3);

  dst.fillStyle = shapeColor;
  for (let i = 0; i < totalAttempts; i++) {
    const x = rng() * W;
    const y = rng() * H;
    // Sample local coverage to decide whether to place a dot
    const x0 = Math.max(0, Math.floor(x - sampleSize / 2));
    const y0 = Math.max(0, Math.floor(y - sampleSize / 2));
    const cov = sampleCoverage(coverage, W, x0, y0, sampleSize, sampleSize);
    // Probabilistic placement: high coverage → high chance of dot
    if (rng() < cov) {
      dst.beginPath();
      dst.arc(x, y, dotR * (0.8 + rng() * 0.6), 0, Math.PI * 2);
      dst.fill();
    }
  }
}

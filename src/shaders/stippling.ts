/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stippling shader — Poisson-random dots with size/opacity variance +
 * paper grain. Technical drawing / pointillism aesthetic.
 */

import { ShaderContext, buildCoverageMap, sampleCoverage } from './index';
import { makeRng, addPaperGrain } from './_texture';

export function applyStippling(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor, config } = c;

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);
  const seed = Math.round(config.layoutSeed ?? 1) ^ 0xA1B2C3;
  const rng = makeRng(seed);

  const totalAttempts = Math.round(W * H * 0.025);
  const dotR = Math.max(0.7, Math.min(W, H) / 700);
  const sampleSize = Math.max(4, Math.round(Math.min(W, H) / 200));

  dst.fillStyle = shapeColor;
  for (let i = 0; i < totalAttempts; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const x0 = Math.max(0, Math.floor(x - sampleSize / 2));
    const y0 = Math.max(0, Math.floor(y - sampleSize / 2));
    const cov = sampleCoverage(coverage, W, x0, y0, sampleSize, sampleSize);
    if (rng() < cov) {
      // Wider size range + ink-density opacity variance
      dst.globalAlpha = 0.65 + rng() * 0.35;
      dst.beginPath();
      dst.arc(x, y, dotR * (0.5 + rng() * 1.2), 0, Math.PI * 2);
      dst.fill();
    }
  }
  dst.globalAlpha = 1;

  addPaperGrain(dst, W, H, seed, 10);
}

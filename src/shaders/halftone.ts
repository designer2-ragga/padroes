/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Halftone shader — newspaper/print dot grid with sub-pixel jitter,
 * radius variation, and ink-density opacity variance. No paper grain
 * (kept clean for sharper print feel).
 */

import { ShaderContext, buildCoverageMap, sampleCoverage } from './index';
import { makeRng } from './_texture';

export function applyHalftone(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor, config } = c;

  const cellSize = Math.max(8, Math.round(Math.min(W, H) / 90));
  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(H / cellSize);
  const maxR = cellSize * 0.6;
  const seed = Math.round(config.layoutSeed ?? 1) ^ 0xA1F70E;
  const rng = makeRng(seed);

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);

  dst.fillStyle = shapeColor;
  const jitter = cellSize * 0.18;

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cellSize;
      const y0 = r * cellSize;
      const cov = sampleCoverage(coverage, W, x0, y0, cellSize, cellSize);
      if (cov < 0.02) continue;
      const baseR = maxR * Math.sqrt(cov);
      const dotR = baseR * (0.82 + rng() * 0.36);
      const jx = (rng() - 0.5) * jitter;
      const jy = (rng() - 0.5) * jitter;
      dst.globalAlpha = 0.85 + rng() * 0.15;
      dst.beginPath();
      dst.arc(x0 + cellSize / 2 + jx, y0 + cellSize / 2 + jy, dotR, 0, Math.PI * 2);
      dst.fill();
    }
  }
  dst.globalAlpha = 1;
}

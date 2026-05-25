/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Halftone shader — renders the pattern as a regular grid of dots whose
 * radius is proportional to local coverage. Vintage newspaper / scientific-
 * journal print aesthetic.
 */

import { ShaderContext, buildCoverageMap, sampleCoverage } from './index';

export function applyHalftone(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor } = c;

  // Cell size — smaller = finer halftone. Tuned for 1200×1200.
  const cellSize = Math.max(8, Math.round(Math.min(W, H) / 90));
  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(H / cellSize);
  const maxR = cellSize * 0.6; // dot radius at full coverage (slight overlap to bleed)

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);

  dst.fillStyle = shapeColor;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cellSize;
      const y0 = r * cellSize;
      const cov = sampleCoverage(coverage, W, x0, y0, cellSize, cellSize);
      if (cov < 0.02) continue;
      const dotR = maxR * Math.sqrt(cov); // sqrt scaling matches eye's perception of area
      dst.beginPath();
      dst.arc(x0 + cellSize / 2, y0 + cellSize / 2, dotR, 0, Math.PI * 2);
      dst.fill();
    }
  }
}

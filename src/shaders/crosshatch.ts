/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Crosshatch shader — multi-angle parallel hatching with per-segment line
 * wobble + thickness variation + paper grain for hand-engraved feel.
 */

import { ShaderContext, buildCoverageMap, sampleCoverage } from './index';
import { makeRng, addPaperGrain } from './_texture';

export function applyCrosshatch(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor, config } = c;

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);
  const seed = Math.round(config.layoutSeed ?? 1) ^ 0xC0C55;
  const rng = makeRng(seed);

  const spacing = Math.max(8, Math.round(Math.min(W, H) / 80));
  const cellSize = spacing * 3;
  const baseLineWidth = Math.max(0.8, spacing * 0.22);
  const angles = [Math.PI / 4, -Math.PI / 4, 0];

  dst.strokeStyle = shapeColor;
  dst.lineCap = 'butt';

  const diag = Math.sqrt(W * W + H * H);

  for (let pass = 0; pass < 3; pass++) {
    const angle = angles[pass];
    const threshold = 0.10 + pass * 0.30;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = -sin;
    const py = cos;
    const nLines = Math.ceil((Math.abs(W * px) + Math.abs(H * py)) / spacing) + 4;
    const cx = W / 2;
    const cy = H / 2;

    for (let i = -nLines; i <= nLines; i++) {
      // Per-line offset jitter — breaks perfect parallelism
      const offsetJitter = (rng() - 0.5) * spacing * 0.25;
      const offset = i * spacing + offsetJitter;
      const mx = cx + px * offset;
      const my = cy + py * offset;
      const x1 = mx - cos * diag;
      const y1 = my - sin * diag;
      const x2 = mx + cos * diag;
      const y2 = my + sin * diag;
      const step = spacing * 0.6;
      const segs = Math.ceil((diag * 2) / step);
      let prevInside = false;
      let segStartX = 0, segStartY = 0;
      // Per-line thickness variation — etched-by-hand feel
      dst.lineWidth = baseLineWidth * (0.7 + rng() * 0.6);
      dst.globalAlpha = 0.75 + rng() * 0.25;

      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const sx = x1 + (x2 - x1) * t;
        const sy = y1 + (y2 - y1) * t;
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) {
          if (prevInside) {
            dst.beginPath();
            dst.moveTo(segStartX, segStartY);
            dst.lineTo(sx, sy);
            dst.stroke();
            prevInside = false;
          }
          continue;
        }
        const x0 = Math.max(0, Math.floor(sx - cellSize / 2));
        const y0 = Math.max(0, Math.floor(sy - cellSize / 2));
        const cov = sampleCoverage(coverage, W, x0, y0, cellSize, cellSize);
        const inside = cov >= threshold;
        if (inside && !prevInside) {
          segStartX = sx;
          segStartY = sy;
          prevInside = true;
        } else if (!inside && prevInside) {
          dst.beginPath();
          dst.moveTo(segStartX, segStartY);
          dst.lineTo(sx, sy);
          dst.stroke();
          prevInside = false;
        }
      }
      if (prevInside) {
        dst.beginPath();
        dst.moveTo(segStartX, segStartY);
        dst.lineTo(x2, y2);
        dst.stroke();
      }
    }
  }
  dst.globalAlpha = 1;

  addPaperGrain(dst, W, H, seed, 12);
}

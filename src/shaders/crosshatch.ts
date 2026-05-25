/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Crosshatch shader — fills "shape" pixels with parallel hatching lines.
 * Higher coverage adds more line layers at different angles (X-hatch,
 * XX-hatch). Botanical-engraving / scientific-illustration aesthetic.
 */

import { ShaderContext, buildCoverageMap, sampleCoverage } from './index';

export function applyCrosshatch(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor } = c;

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);

  // Three hatch passes at different angles for graduated density.
  // Each pass: parallel lines at angle θ, spaced by `spacing` px.
  const spacing = Math.max(8, Math.round(Math.min(W, H) / 80));
  const cellSize = spacing * 3;
  const lineWidth = Math.max(0.8, spacing * 0.22);
  const angles = [Math.PI / 4, -Math.PI / 4, 0]; // 45°, -45°, 0°

  dst.strokeStyle = shapeColor;
  dst.lineWidth = lineWidth;
  dst.lineCap = 'butt';

  // Diagonal of canvas, used to size hatch lines that always cross the screen
  const diag = Math.sqrt(W * W + H * H);

  for (let pass = 0; pass < 3; pass++) {
    const angle = angles[pass];
    // Coverage threshold for this pass (later passes only fill denser areas)
    const threshold = 0.10 + pass * 0.30; // 0.10, 0.40, 0.70

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Perpendicular to line direction
    const px = -sin;
    const py = cos;

    // Number of parallel lines covering the canvas
    const nLines = Math.ceil((Math.abs(W * px) + Math.abs(H * py)) / spacing) + 4;

    // Origin: center of canvas
    const cx = W / 2;
    const cy = H / 2;

    for (let i = -nLines; i <= nLines; i++) {
      const offset = i * spacing;
      // Line center
      const mx = cx + px * offset;
      const my = cy + py * offset;
      // Line endpoints (long enough to cross canvas in `angle` direction)
      const x1 = mx - cos * diag;
      const y1 = my - sin * diag;
      const x2 = mx + cos * diag;
      const y2 = my + sin * diag;
      // Walk the line in small steps, drawing only segments that fall within
      // dense-enough coverage regions
      const step = spacing * 0.6;
      const segs = Math.ceil((diag * 2) / step);
      let prevInside = false;
      let segStartX = 0, segStartY = 0;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const sx = x1 + (x2 - x1) * t;
        const sy = y1 + (y2 - y1) * t;
        // Skip if outside canvas
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) {
          if (prevInside) {
            // Close any open segment
            dst.beginPath();
            dst.moveTo(segStartX, segStartY);
            dst.lineTo(sx, sy);
            dst.stroke();
            prevInside = false;
          }
          continue;
        }
        // Sample coverage at this point
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
}

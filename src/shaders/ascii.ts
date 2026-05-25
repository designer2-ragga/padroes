/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ASCII shader — renders the pattern as a grid of monospace characters.
 * Each grid cell samples coverage in the source canvas; the coverage
 * fraction maps to a character of increasing visual density.
 */

import { ShaderContext, buildCoverageMap, sampleCoverage } from './index';

// Character ramp from sparse to dense — classic ASCII art ramp.
const CHARS = ' .,:;+*#@';

export function applyAscii(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor } = c;

  // Cell size — characters per row, tuned for readability at 1200×1200.
  // Smaller cellSize = more characters, finer detail, lower readability.
  const cellSize = Math.max(10, Math.round(Math.min(W, H) / 80));
  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(H / cellSize);

  // Background fill
  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  // Build coverage map from src
  const coverage = buildCoverageMap(src, W, H);

  // Render characters
  dst.fillStyle = shapeColor;
  dst.font = `${cellSize}px "JetBrains Mono", "Courier New", monospace`;
  dst.textBaseline = 'middle';
  dst.textAlign = 'center';

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cellSize;
      const y0 = r * cellSize;
      const cov = sampleCoverage(coverage, W, x0, y0, cellSize, cellSize);
      if (cov < 0.05) continue; // empty cell — no character
      const charIdx = Math.min(CHARS.length - 1, Math.floor(cov * CHARS.length));
      const ch = CHARS[charIdx];
      if (ch === ' ') continue;
      dst.fillText(ch, x0 + cellSize / 2, y0 + cellSize / 2);
    }
  }
}

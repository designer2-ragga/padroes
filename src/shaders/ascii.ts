/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ASCII shader — monospace character grid, density-mapped.
 * Per-character position + opacity jitter for typewriter-imperfect feel.
 * Subtle paper grain overlay simulates ink-on-paper texture.
 */

import { ShaderContext, buildCoverageMap, sampleCoverage } from './index';
import { makeRng, addPaperGrain } from './_texture';

const CHARS = ' .,:;+*#@';

export function applyAscii(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor, config } = c;

  const cellSize = Math.max(10, Math.round(Math.min(W, H) / 80));
  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(H / cellSize);
  const seed = Math.round(config.layoutSeed ?? 1) ^ 0xA5C11;
  const rng = makeRng(seed);

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);

  dst.fillStyle = shapeColor;
  dst.font = `${cellSize}px "JetBrains Mono", "Courier New", monospace`;
  dst.textBaseline = 'middle';
  dst.textAlign = 'center';

  const jitterAmount = cellSize * 0.12; // ~1-2px at typical cellSize

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cellSize;
      const y0 = r * cellSize;
      const cov = sampleCoverage(coverage, W, x0, y0, cellSize, cellSize);
      if (cov < 0.05) continue;
      const charIdx = Math.min(CHARS.length - 1, Math.floor(cov * CHARS.length));
      const ch = CHARS[charIdx];
      if (ch === ' ') continue;
      // Per-character imperfection
      const jx = (rng() - 0.5) * jitterAmount * 2;
      const jy = (rng() - 0.5) * jitterAmount * 2;
      const op = 0.78 + rng() * 0.22; // 0.78 - 1.00 opacity variance (ink density)
      dst.globalAlpha = op;
      dst.fillText(ch, x0 + cellSize / 2 + jx, y0 + cellSize / 2 + jy);
    }
  }
  dst.globalAlpha = 1;

  // Paper grain final pass
  addPaperGrain(dst, W, H, seed, 10);
}

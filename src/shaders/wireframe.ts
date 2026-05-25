/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wireframe shader — edge-detection outline only. Random pixel dropouts
 * along the outline simulate hand-drawn / etched line break-up, then
 * paper grain finishes the analog feel.
 */

import { ShaderContext, buildCoverageMap } from './index';
import { makeRng, addPaperGrain } from './_texture';

export function applyWireframe(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor, config } = c;
  const seed = Math.round(config.layoutSeed ?? 1) ^ 0xE17EFF;
  const rng = makeRng(seed);

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);
  const imageData = dst.getImageData(0, 0, W, H);
  const data = imageData.data;

  const probe = document.createElement('canvas');
  probe.width = 1; probe.height = 1;
  const pctx = probe.getContext('2d');
  if (!pctx) return;
  pctx.fillStyle = shapeColor;
  pctx.fillRect(0, 0, 1, 1);
  const pdata = pctx.getImageData(0, 0, 1, 1).data;
  const fgR = pdata[0], fgG = pdata[1], fgB = pdata[2];

  // Edge detection with random dropouts for hand-drawn line feel
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!coverage[p]) continue;
      const isEdge =
        (x > 0     && !coverage[p - 1]) ||
        (x < W - 1 && !coverage[p + 1]) ||
        (y > 0     && !coverage[p - W]) ||
        (y < H - 1 && !coverage[p + W]);
      if (isEdge) {
        // ~12% line break-up — random pixel dropouts simulate ink skips
        if (rng() < 0.88) {
          const i = p * 4;
          data[i]     = fgR;
          data[i + 1] = fgG;
          data[i + 2] = fgB;
          data[i + 3] = 255;
        }
      }
    }
  }

  dst.putImageData(imageData, 0, 0);

  // Light grain — wireframe is sparse, doesn't need heavy texture
  addPaperGrain(dst, W, H, seed, 8);
}

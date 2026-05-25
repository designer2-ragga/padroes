/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wireframe shader — removes all fills; shows only the OUTLINE of each
 * shape via edge detection. CAD / technical schematic / X-ray aesthetic.
 */

import { ShaderContext, buildCoverageMap } from './index';

export function applyWireframe(c: ShaderContext): void {
  const { dst, src, W, H, bgColor, shapeColor } = c;

  dst.fillStyle = bgColor;
  dst.fillRect(0, 0, W, H);

  const coverage = buildCoverageMap(src, W, H);

  // Edge detection: a pixel is an edge if it's "shape" and at least one of
  // its 4-neighbors is "bg" (or vice versa). The result is a 1-pixel outline
  // along every shape/bg boundary.
  const imageData = dst.getImageData(0, 0, W, H);
  const data = imageData.data;

  // Parse shapeColor — we'll need to write its RGB into the imageData.
  // The cleanest way: temporarily draw a 1px patch in shapeColor to an
  // offscreen and read it back.
  const probe = document.createElement('canvas');
  probe.width = 1; probe.height = 1;
  const pctx = probe.getContext('2d');
  if (!pctx) return;
  pctx.fillStyle = shapeColor;
  pctx.fillRect(0, 0, 1, 1);
  const pdata = pctx.getImageData(0, 0, 1, 1).data;
  const fgR = pdata[0], fgG = pdata[1], fgB = pdata[2];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!coverage[p]) continue;
      // Check 4-neighbors
      const isEdge =
        (x > 0     && !coverage[p - 1]) ||
        (x < W - 1 && !coverage[p + 1]) ||
        (y > 0     && !coverage[p - W]) ||
        (y < H - 1 && !coverage[p + W]);
      if (isEdge) {
        const i = p * 4;
        data[i]     = fgR;
        data[i + 1] = fgG;
        data[i + 2] = fgB;
        data[i + 3] = 255;
      }
    }
  }

  dst.putImageData(imageData, 0, 0);
}

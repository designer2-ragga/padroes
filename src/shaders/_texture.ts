/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared analog-texture helpers used by all shaders to break away from
 * the "clean vector" look:
 *   - makeRng: deterministic PRNG (Mulberry32 — same algo as engine RNG)
 *   - addPaperGrain: subtle multiplicative noise across the whole canvas
 *     to simulate paper fiber / print substrate imperfection
 */

export function makeRng(seed: number) {
  let s = (seed | 0) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Multiplicative-noise paper grain. Applied as a final pass over an
 * already-rendered image. Strength is the maximum per-pixel ±deviation
 * applied to each channel. Typical values: 6 (very subtle) → 20 (strong).
 *
 * Spatial coherence: optional `cellSize` clusters the noise into small
 * patches (cellSize=1 = per-pixel; cellSize=3 = 3×3 patches). Default 1.
 */
export function addPaperGrain(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  seed: number,
  strength: number = 12,
  cellSize: number = 1
): void {
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;
  const rng = makeRng(seed ^ 0x9E3779B9);

  if (cellSize <= 1) {
    for (let i = 0; i < data.length; i += 4) {
      const noise = (rng() - 0.5) * strength;
      data[i]     = clamp(data[i]     + noise);
      data[i + 1] = clamp(data[i + 1] + noise);
      data[i + 2] = clamp(data[i + 2] + noise);
    }
  } else {
    // Patch noise: sample one noise value per cellSize×cellSize patch
    for (let y = 0; y < H; y += cellSize) {
      for (let x = 0; x < W; x += cellSize) {
        const noise = (rng() - 0.5) * strength;
        const yMax = Math.min(y + cellSize, H);
        const xMax = Math.min(x + cellSize, W);
        for (let py = y; py < yMax; py++) {
          for (let px = x; px < xMax; px++) {
            const i = (py * W + px) * 4;
            data[i]     = clamp(data[i]     + noise);
            data[i + 1] = clamp(data[i + 1] + noise);
            data[i + 2] = clamp(data[i + 2] + noise);
          }
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

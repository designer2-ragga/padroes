/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shader registry — post-process visual filters applied AFTER the spice
 * renderer has drawn its pattern. Each shader receives the original rendered
 * canvas as input and produces a transformed canvas as output.
 *
 * Architecture:
 *   1. PatternWorkspace renders the pattern into an OFFSCREEN canvas.
 *   2. If a shader is selected, the shader function reads the offscreen and
 *      paints the transformed result into the VISIBLE canvas.
 *   3. If no shader, the offscreen is blitted directly.
 *
 * Shaders are pure functions: same input + same config = same output.
 * Determinism is preserved via shaderSeed (derived from layoutSeed).
 */

import { ShaderId, PatternConfig } from '../types';
import { applyAscii } from './ascii';
import { applyHalftone } from './halftone';
import { applyCrosshatch } from './crosshatch';
import { applyStippling } from './stippling';
import { applyCyanotype } from './cyanotype';
import { applyWireframe } from './wireframe';
import { applyRisograph } from './risograph';
import { applyLetterpress } from './letterpress';

export interface ShaderContext {
  src: HTMLCanvasElement;          // offscreen canvas with original pattern
  dst: CanvasRenderingContext2D;   // visible canvas to paint into
  W: number;
  H: number;
  config: PatternConfig;
  shapeColor: string;              // OKLCH color of the pattern shapes
  bgColor: string;                 // OKLCH color of the background
}

export type ShaderFn = (ctx: ShaderContext) => void;

export interface ShaderSpec {
  id: ShaderId;
  label: string;
  apply: ShaderFn | null;          // null = no shader, blit src directly
}

export const SHADERS: Record<ShaderId, ShaderSpec> = {
  none:        { id: 'none',        label: 'Nenhum',       apply: null },
  ascii:       { id: 'ascii',       label: 'ASCII',        apply: applyAscii },
  halftone:    { id: 'halftone',    label: 'Halftone',     apply: applyHalftone },
  crosshatch:  { id: 'crosshatch',  label: 'Crosshatch',   apply: applyCrosshatch },
  stippling:   { id: 'stippling',   label: 'Stippling',    apply: applyStippling },
  cyanotype:   { id: 'cyanotype',   label: 'Cianotipia',   apply: applyCyanotype },
  wireframe:   { id: 'wireframe',   label: 'Wireframe',    apply: applyWireframe },
  risograph:   { id: 'risograph',   label: 'Risograph',    apply: applyRisograph },
  letterpress: { id: 'letterpress', label: 'Letterpress',  apply: applyLetterpress },
};

export const SHADER_IDS: ShaderId[] = [
  'none', 'ascii', 'halftone', 'crosshatch', 'stippling',
  'cyanotype', 'wireframe', 'risograph', 'letterpress',
];

/**
 * Read the bg color from the rendered offscreen by sampling pixel (0, 0).
 * Returns a coverage map (1 = shape, 0 = bg) for the whole image.
 *
 * Used by shape-based shaders (ASCII, halftone, crosshatch, stippling,
 * wireframe) that need to know which pixels are "shape" vs "bg".
 */
export function buildCoverageMap(src: HTMLCanvasElement, W: number, H: number): Uint8Array {
  const srcCtx = src.getContext('2d');
  if (!srcCtx) return new Uint8Array(W * H);
  const imageData = srcCtx.getImageData(0, 0, W, H);
  const data = imageData.data;
  // Sample bg from top-left corner pixel
  const bgR = data[0], bgG = data[1], bgB = data[2];
  const coverage = new Uint8Array(W * H);
  // A pixel is "shape" if it differs sufficiently from bg.
  // Threshold 20 (sum of channel diffs) is permissive enough for OKLCH
  // anti-aliasing edges to still register as shape.
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    const diff = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
    coverage[p] = diff > 20 ? 1 : 0;
  }
  return coverage;
}

/**
 * Sample the coverage in a rectangular region. Returns fraction [0..1].
 */
export function sampleCoverage(
  coverage: Uint8Array,
  W: number,
  x0: number, y0: number,
  cellW: number, cellH: number
): number {
  let count = 0;
  let total = 0;
  const x1 = Math.min(x0 + cellW, W);
  const y1 = Math.min(y0 + cellH, coverage.length / W);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (coverage[y * W + x]) count++;
      total++;
    }
  }
  return total > 0 ? count / total : 0;
}

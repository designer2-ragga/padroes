/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared scaling utilities for the morphology engine.
 *
 * These utilities replace the five different zoom-scaling formulas
 * and five different density-to-count formulas previously scattered
 * across the spice renderers (see ARCHITECTURE_AUDIT.md).
 *
 * Defined here but NOT yet consumed by renderers — phase 3 of refactor
 * (creating the abstraction) is separate from phase 4 (migrating each
 * spice to use it). Each spice will switch over individually so the
 * pixel-equivalence contract is preserved per migration.
 */

// ─── Zoom scaling ────────────────────────────────────────────────────────────

/**
 * Mode controls how a base value scales with the zoom slider:
 *
 *  - 'absolute': returns the base value unchanged. Used for stroke width
 *    and other measurements that must stay perceptually constant across
 *    magnification. THIS IS THE DEFAULT FOR STROKES.
 *
 *  - 'linear':   value * (zoom / 100). Naive linear scaling — explodes
 *    at high zoom (1200x → 12× the base). Used historically by Louro/
 *    Alho/Pimenta stroke calculations; flagged as a bug in the audit.
 *
 *  - 'sqrt':     value * sqrt(zoom / 100). Conservative scaling that
 *    grows but doesn't dominate at high zoom. Used by Manjericão for
 *    all per-element sizes.
 *
 *  - 'log':      value * pow(2, (zoom - 100) / 220). Logarithmic-feeling
 *    scaling: zoom 100 → 1×, 320 → 2×, 540 → 4×, 1200 → ~22×. Matches
 *    a microscope's perceptual scale where each "doubling" corresponds
 *    to a fixed zoom-slider interval. Recommended for structure sizes
 *    in future migrations.
 */
export type ZoomMode = 'absolute' | 'linear' | 'sqrt' | 'log';

const ZOOM_BASE = 100;
const LOG_HALF_LIFE = 220; // zoom delta required to double the scale

/**
 * Apply a zoom-mode scaling to a base value.
 *
 * @param baseValue   the unscaled value (e.g. a pixel count at zoom=100)
 * @param zoom        the current zoom value from PatternConfig
 * @param mode        which scaling curve to apply
 */
export function scaleAtZoom(baseValue: number, zoom: number, mode: ZoomMode): number {
  switch (mode) {
    case 'absolute':
      return baseValue;
    case 'linear':
      return baseValue * (zoom / ZOOM_BASE);
    case 'sqrt':
      return baseValue * Math.sqrt(zoom / ZOOM_BASE);
    case 'log':
      return baseValue * Math.pow(2, (zoom - ZOOM_BASE) / LOG_HALF_LIFE);
  }
}

/**
 * Returns just the multiplier (scale factor) for a given zoom + mode.
 * Useful when you want to apply zoom-scaling at the call site rather than
 * to a specific value.
 */
export function zoomFactor(zoom: number, mode: ZoomMode): number {
  return scaleAtZoom(1, zoom, mode);
}

// ─── Density → structure count ──────────────────────────────────────────────

/**
 * Convert the unified density slider (2–40) into a target structure count
 * for a given viewport, using a spice-specific calibration factor.
 *
 * The semantics: "density" means "structures per square reference viewport"
 * at zoom=100. Higher zoom values can OPTIONALLY reduce the count for
 * spices that interpret zoom as "fewer/larger structures" (controlled by
 * the zoomReduces flag).
 *
 * @param density        slider value, 2–40
 * @param viewportArea   actual canvas area in px² (W * H)
 * @param spiceFactor    per-spice calibration multiplier (see SPICE_DENSITY_FACTORS).
 *                       Higher = more structures per density unit.
 * @param zoom           current zoom value (used only if zoomReduces=true)
 * @param zoomReduces    if true, count decreases as zoom increases (1/zm).
 *                       Matches the "more zoom = fewer/larger structures"
 *                       spec for Voronoi-based spices. Default false.
 *
 * Reference viewport = 1200×1200 (the standard canvas). For smaller
 * viewports the count scales proportionally.
 */
export function targetCount(
  density: number,
  viewportArea: number,
  spiceFactor: number,
  zoom: number = 100,
  zoomReduces: boolean = false
): number {
  const REFERENCE_AREA = 1200 * 1200;
  const areaScale = viewportArea / REFERENCE_AREA;
  const zoomScale = zoomReduces ? (ZOOM_BASE / Math.max(40, zoom)) : 1;
  return Math.max(1, Math.round(density * spiceFactor * areaScale * zoomScale));
}

/**
 * Per-spice calibration factor that maps the unified density slider
 * to each spice's natural structure-count rhythm. Calibrated so that
 * density=20 at the spice's curated default zoom produces approximately
 * the same "fullness" across all 6 spices.
 *
 * NOT yet consumed — kept here as the eventual calibration target
 * during the Voronoi/morphology engine migration.
 */
export const SPICE_DENSITY_FACTORS: Record<string, number> = {
  sal: 1.4,        // Salt: small particles, allows higher counts
  louro: 0.8,      // Bay Leaf: large Voronoi cells, fewer structures
  alho: 1.0,       // Garlic: medium cells with nuclei overlays
  pimenta: 0.9,    // Pepper: variable-density Voronoi
  manjericao: 1.8, // Basil: multi-layer, many small grains per "structure"
  oregano: 1.6,    // Oregano: dense clustered capsules
};

// ─── Stroke philosophy ──────────────────────────────────────────────────────

/**
 * The canonical stroke-thickness resolver for every spice.
 *
 * Hard rule from the architectural audit:
 *   Stroke width is ABSOLUTE PIXELS. It NEVER scales with zoom.
 *   It NEVER changes between light/dark themes (only colors invert).
 *
 * Use this helper everywhere instead of inlining `lineWidth * zoom/100`
 * or similar zoom-dependent stroke calculations.
 *
 * @param userStroke  the value from config.lineWidth (slider 0.5–6.0)
 * @param minPx       absolute floor in pixels (defensive — never go below
 *                    this so strokes stay visible). Default 0.8.
 */
export function strokeWidth(userStroke: number, minPx: number = 0.8): number {
  return Math.max(minPx, userStroke);
}

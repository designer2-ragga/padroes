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
 * at zoom=100. Higher zoom values can OPTIONALLY reduce the count, with
 * VARIABLE STRENGTH per layer/spice — required for multi-layer spices like
 * Manjericão where macro features (trichomes, membranes) should disappear
 * faster than substrate features (grains, micro-particles).
 *
 * @param density        slider value, 2–40
 * @param viewportArea   actual canvas area in px² (W * H)
 * @param spiceFactor    per-spice calibration multiplier (see SPICE_DENSITY_FACTORS)
 * @param zoom           current zoom value
 * @param zoomReduces    Controls how count responds to zoom:
 *                         false (default) | 0  → no reduction with zoom
 *                         true             | 1  → linear reduction (count × 100/zoom)
 *                         0 < n < 1            → mild reduction (gentler than linear)
 *                         n > 1                → strong reduction (faster than linear)
 *                       Voronoi spices use 1.0 (matches old behavior).
 *                       Manjericão layers use 0..1.5 depending on optical role.
 *
 * Reference viewport = 1200×1200. For smaller viewports the count scales
 * proportionally via areaScale.
 */
export function targetCount(
  density: number,
  viewportArea: number,
  spiceFactor: number,
  zoom: number = 100,
  zoomReduces: boolean | number = false
): number {
  const REFERENCE_AREA = 1200 * 1200;
  const areaScale = viewportArea / REFERENCE_AREA;
  // Normalize boolean → number for unified math.
  // false → 0 (no reduction); true → 1.0 (linear reduction, preserves Voronoi callsites).
  const strength = typeof zoomReduces === 'boolean' ? (zoomReduces ? 1 : 0) : zoomReduces;
  const zoomScale = strength === 0
    ? 1
    : Math.pow(ZOOM_BASE / Math.max(40, zoom), strength);
  return Math.max(1, Math.round(density * spiceFactor * areaScale * zoomScale));
}

/**
 * Per-spice calibration factor that maps the unified density slider
 * to each spice's natural structure-count rhythm.
 *
 * Calibration rule: factor is chosen so that at the spice's curated
 * default (zoom, density), targetCount(...) yields a structure count
 * whose square root matches the prior-art's grid-side M. This locks in
 * pixel parity with baseline-snapshots at the curated config.
 *
 * Verification per spice: pick the (zoom_default, density_default) from
 * PARAMETERS, compute old_M from the legacy inline formula, solve for
 * factor in:  round(sqrt(density * factor * (100/zoom))) == old_M
 *
 * Louro default (zoom=220, density=9): old_M = 3 → factor = 9/(9*100/220) = 2.20
 * Alho  default (zoom=180, density=14): old_M = round((14/3)/1.8) = 3 → factor = 9/(14*100/180) = 1.16
 * Pimenta default (zoom=340, density=22): old_M = round((22*0.45)/3.4) = 3 → factor = 9/(22*100/340) = 1.39
 *
 * The other three spices haven't migrated yet — factors stay as initial
 * estimates until their migration recalibrates.
 */
export const SPICE_DENSITY_FACTORS: Record<string, number> = {
  sal: 1.4,         // Salt: TBD (still on legacy particle dispatch)
  louro: 2.2,       // Bay Leaf: calibrated to old_M=3 at default → pixel parity
  alho: 1.16,       // Garlic:   calibrated to old_M=3 at default → pixel parity
  pimenta: 1.39,    // Pepper:   calibrated to old_M=3 at default → pixel parity
  manjericao: 1.8,  // Basil: per-layer factors live inline in generateBasilLayout
                    //   (multi-layer topology; this single value is documentation only)
  oregano: 2.25,    // Oregano:  calibrated so targetCount(28, area, 2.25, 140, 0.7) ≈ 50
                    //   (matches old (density*2.5)/zm formula at curated default)
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

# Visual Calibration — Ragga Micro Pattern Engine

> **Status:** Louro pilot reference. Alho + Pimenta calibrate against this.
> **Last updated:** session 8 (refactor/morphology-engine).
>
> Captured at: `density=9`, `lineWidth=2.2`, `voronoiRoundedness=44`,
> `rotation=0`, `themeMode=light`, `seed=42`, canvas 1200×1200.
> All four PNGs live in `calibration/louro-{N}x.png`.

This document is the **engine-wide ruler**. Every other spice's
calibration factor (`SPICE_DENSITY_FACTORS`) is tuned until it produces
output that **feels** like the corresponding stop on this ruler. The
zoom slider's perceptual meaning is grounded here.

---

## Louro — canonical reference

Louro was chosen as the pilot because:

- it's the simplest Voronoi (single layer, isotropic seeds, fixed jitter)
- its visual identity is "leaf epidermis tissue" — clean cell-wall geometry
- it has no internal overlays (no nuclei, no particles, no filaments)
  → zoom and density effects read directly without confounding layers

---

### 100x  —  "tissue field"

![louro-100x](calibration/louro-100x.png)

| Aspect | Reading |
|---|---|
| Cells per side (M) | **4** (16 cells visible) |
| Cells filling viewport | dense — many overlapping in periphery |
| Avg cell width | ~300 px (¼ of canvas) |
| Stroke thickness | 2.2 px absolute |
| Legibility | high — every cell wall crisply readable |
| Apparent line weight | thin, sharp — feels like a fine-tip pen drawing |
| Vibe | "wide field view of leaf tissue" — botanist's first pass under low-power objective |
| Use case | overview compositions, large-format prints where many cells contribute to texture |

**Anisotropy at 100x:** the 1.6× stretch is visible — cells lean noticeably along the rotation axis. Easy to perceive directional flow.

---

### 300x  —  "cell cluster"

![louro-300x](calibration/louro-300x.png)

| Aspect | Reading |
|---|---|
| Cells per side (M) | **3** (9 cells visible — floor clamp engaged) |
| Cells filling viewport | sparse — each cell dominates a third of the canvas |
| Avg cell width | ~400 px |
| Stroke thickness | 2.2 px absolute (still — that's the stroke fix) |
| Legibility | very high — single cell can be the focal subject |
| Apparent line weight | thin against large cells — strokes feel even more delicate proportionally |
| Vibe | "centered cell cluster" — looking at one neighborhood under medium objective |
| Use case | curated default for Louro identity tiles; the configured `zoom=220` lives here |

**Anisotropy at 300x:** elongation still readable but less dramatic — fewer cells means fewer comparison points for the eye.

---

### 800x  —  "macro view, floor-capped"

![louro-800x](calibration/louro-800x.png)

| Aspect | Reading |
|---|---|
| Cells per side (M) | **3** (clamped — formula wants 2, floor forces 3) |
| Cells filling viewport | identical to 300x — **byte-identical PNG** |
| Apparent line weight | unchanged from 300x |
| Vibe | should be "high mag — fewer larger cells" but the M=3 floor hides this |
| ⚠️ Calibration note | **slider has no visual effect between ~250x and 1200x** — the floor `Math.max(3, ...)` clamps every value to M=3. This is preserved from the legacy formula for parity, but represents dead range in the slider. |

**Design decision pending:** consider lowering the M floor from 3 to 2 (4 cells total) in a future commit to give 800x+ its own distinct character. Documenting here so the choice is intentional, not accidental.

---

### 1200x  —  "absolute close-up, also floor-capped"

![louro-1200x](calibration/louro-1200x.png)

| Aspect | Reading |
|---|---|
| Cells per side (M) | **3** (clamped — formula wants 1, floor forces 3) |
| PNG bytes | identical to 300x and 800x |
| ⚠️ Calibration note | same floor issue — slider value distinct, output identical |
| Apparent line weight | 2.2 px (this is where the OLD code would have rendered ~26 px strokes; the stroke fix is most visible here) |

**Before the stroke fix:** at 1200x the legacy formula computed `lineWidth × 1.5 × (1200/100) = 39.6 px` (clamped to a wallthick of ~40 px). Cells became thick orange paint regions with tiny cream interiors. **After the fix:** crisp 2.2 px lines, every value of zoom looks like microscopy.

---

## Perceptual rules of the engine

These observations promote to engine-wide rules — Alho and Pimenta calibrations must respect them:

| Rule | Specification |
|---|---|
| **R1 — zoom only changes count** | At a fixed `density`, increasing `zoom` reduces cell count (and increases per-cell size). It NEVER changes stroke thickness, NEVER changes color saturation, NEVER changes anisotropy magnitude. |
| **R2 — density only changes count** | At a fixed `zoom`, increasing `density` increases cell count (and reduces per-cell size). It NEVER changes stroke or color. |
| **R3 — stroke is absolute pixels** | The same `lineWidth=2.2` value produces a 2.2 px line at every zoom level. No multiplication by `zoom/100`. |
| **R4 — theme is pure inversion** | Light↔dark swaps `bg ↔ shape` colors only. Stroke width, geometry, count are identical between themes. |
| **R5 — anisotropy is intrinsic** | The 1.6× elongation is a Louro identity constant. `rotation` rotates the axis, but never the magnitude. |
| **R6 — M floor = 3** | All Voronoi spices clamp to a minimum of 3 cells per side, producing a 3×3 grid. Below this the pattern is unreadable. (Possibly relaxable — see 800x note above.) |
| **R7 — M ceiling = 22** | Above 484 total cells (M=22), the canvas becomes a fine mesh — visual identity collapses into "static noise" rather than "cellular tissue". |

---

## How Alho + Pimenta will calibrate

Each remaining Voronoi spice will:

1. Switch to `targetCount(density, viewportArea, SPICE_DENSITY_FACTORS[id], zoom, true)`
2. Use `M = clamp(round(sqrt(totalCount)), 3, 22)` — same formula as Louro
3. Pre-calibrated factors (in `src/engine/scaling.ts`):
   - Alho:    `1.16`  — matches old `M = round((d/3)/zm)` at curated default (d=14, zoom=180)
   - Pimenta: `1.39`  — matches old `M = round((d*0.45)/zm)` at curated default (d=22, zoom=340)
4. After migration: re-capture all 12 baseline snapshots and verify byte-equivalence.

Manjericão and Orégano have different topologies (multi-layer organic, Poisson-disc capsules respectively) and will likely use `targetCount` with `zoomReduces=false` to scale STRUCTURE SIZE (via `scaleAtZoom` `sqrt` or `log` mode) rather than reducing count. Their calibrations are TBD when their migrations land.

---

## Files in this calibration set

```
calibration/
  louro-100x.png   (4×4 grid, 16 cells)
  louro-300x.png   (3×3 grid, 9 cells — curated default range)
  louro-800x.png   (3×3 grid, byte-identical to 300x)
  louro-1200x.png  (3×3 grid, byte-identical to 300x)
```

To regenerate after future renderer changes: re-run the eval loop in
the preview app + `node scripts/decode-calibration.cjs <dump-path>`.

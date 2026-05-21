# Architectural Audit — Pattern Generation Engine

## Per-Spice Parameter Analysis

### 🧂 **SALT** (`drawSaltCrystal` via particle dispatch)

| Question | Finding |
|---|---|
| **Affects geometry** | `zoom` (size mult ×1.15), `density` (particle count), `layoutSeed` |
| **Rendering only** | `themeMode`, `noise` |
| **Fake-global / silent** | `rotation` ❌ (sliders moves but particles use `p.rotation` only; config.rotation removed in session 6), `voronoiRoundedness`, `lineWidth`, `fillAlpha`, `lightingAngle`, `gridScale`, `gridMode` |
| **Conflicts** | None (simple system) |
| **Unique procedural logic** | 45% ellipses + 35% pebbles + 20% rounded quads via `pathOrganicBlob`. Crystal-specific RNG seed `'_salt_grain'` |
| **Reuses shared system** | `generateParticles`, `pathOrganicBlob`, `applyFillAndStroke` |
| **Wrong zoom scaling** | None severe — particles scale linearly, OK at salt's domain |
| **Light/dark consistency** | ✅ Pure color inversion |
| **Hardcoded/hacked** | `p.size = rng.range(16, 42)` baked into `generateParticles` (ignores spice domain). Multiplier `1.15` is magic number |

---

### 🌿 **BAY LEAF (Louro)** (`renderLouroMicroscopeGrid`)

| Question | Finding |
|---|---|
| **Affects geometry** | `zoom`, `density`, `rotation` (anisotropic stretch via `α`), `voronoiRoundedness`, `layoutSeed` |
| **Rendering only** | `themeMode`, `lineWidth` |
| **Fake-global / silent** | `noise`, `fillAlpha`, `lightingAngle`, `gridScale`, `gridMode` |
| **Conflicts** | `density/zoom` coupling: `M = max(3, min(22, round((density/3)/zm)))` — at high zoom (1200x) density slider is effectively dead (M floors to 3) |
| **Unique procedural logic** | Jittered M×M grid → anisotropic Voronoi via half-plane clipping. `stretch = 1.6` magic constant |
| **Reuses shared system** | `clipPolygon`, `drawRoundedPolygon`, `getRoundedPolygonSvgPath` |
| **Wrong zoom scaling** | `lineWidth: max(1.8, lineWidth * 1.5 * (zoom/100))` — stroke grows linearly with zoom (200% at 200x → 600% at 600x). Breaks "constant visual thickness" rule. |
| **Light/dark consistency** | ✅ Identical geometry, only color swap |
| **Hardcoded/hacked** | `stretch=1.6`, jitter range `±0.35`, `lineWidth * 1.5` |

---

### 🧄 **GARLIC (Alho)** (`renderGarlicMicroscopeGrid`)

| Question | Finding |
|---|---|
| **Affects geometry** | `zoom`, `density`, `rotation` (anisotropy), `voronoiRoundedness`, `layoutSeed` |
| **Rendering only** | `themeMode`, `lineWidth` |
| **Fake-global / silent** | Same as Louro |
| **Conflicts** | Same `density/zoom` coupling formula as Louro (copy-paste); same effective dead zone at high zoom |
| **Unique procedural logic** | Same Voronoi as Louro + mitosis nuclei via `pathOrganicVacuole` per cell |
| **Reuses shared system** | Same Voronoi machinery as Louro (near-duplicate code!) + `pathOrganicVacuole` |
| **Wrong zoom scaling** | `lineWidth * 1.3 * (zoom/100)` — different multiplier than Louro (1.3 vs 1.5) — **inconsistency** |
| **Light/dark consistency** | ✅ |
| **Hardcoded/hacked** | `stretch=1.35` (vs Louro 1.6), jitter range `±0.32` (vs Louro `±0.35`), `lineWidth * 1.3`, nucleus localSize × 0.95 |

---

### 🌶️ **PEPPER (Pimenta)** (`renderPimentaMicroscopeGrid`)

| Question | Finding |
|---|---|
| **Affects geometry** | `zoom`, `density`, `rotation` (anisotropy stretch=1.22), `voronoiRoundedness`, `layoutSeed`, `lineWidth` (boundary check buffer) |
| **Rendering only** | `themeMode` |
| **Fake-global / silent** | `noise`, `fillAlpha`, `lightingAngle`, `gridScale`, `gridMode` |
| **Conflicts** | Different `M` formula: `M = max(3, min(11, round((density * 0.45) / zm)))` — different range cap (11 vs 22), different multiplier (0.45 vs 1/3) → **density behaves differently than Louro/Alho** |
| **Unique procedural logic** | Variable-density Voronoi: sparse large-cell seeds + clustered small-cell seeds. Plus internal micro-particles via `generateParticlesInPolygon` with inset polygon |
| **Reuses shared system** | `clipPolygon`, `drawRoundedPolygon`, `pathOrganicVacuole`, `isPointInPolygon` |
| **Wrong zoom scaling** | Particle inset margin uses 8px constant (does NOT scale with zoom). Particle radii are absolute pixels (0.8–6px) — invisible at 1200x zoom |
| **Light/dark consistency** | ✅ |
| **Hardcoded/hacked** | `stretch=1.22`, `pad=0.12`, sparse vs cluster ratios `0.20/0.85`, `clusterR = minDim/M * 0.5`, particle min spacing `12px` constant |

---

### 🌱 **BASIL (Manjericão)** (`renderManjericaoMicroscopeGrid`)

| Question | Finding |
|---|---|
| **Affects geometry** | `zoom` (sqrt-scaled), `density` (per-layer multipliers), `rotation` (trichome axis bias), `layoutSeed` |
| **Rendering only** | `themeMode`, `lineWidth` (membrane stroke) |
| **Fake-global / silent** | **`voronoiRoundedness` slider is VISIBLE but ignored by renderer ❌ (regression introduced session 7 when I added it to UI conditional)**, `noise`, `fillAlpha`, `lightingAngle`, `gridScale`, `gridMode` |
| **Conflicts** | Count formula NEVER divides by zoom (unlike all other microscope grids) → at 1200x zoom you still get density × 45 grains, breaking "higher zoom = fewer structures" rule |
| **Unique procedural logic** | 5-layer system: membranes / chloroplasts / trichomes / grains / micro-particles. Biomass density centers + cluster-biased sampling. Trichome = cubic Bezier sampled as bead chain with sin-envelope taper |
| **Reuses shared system** | `pathOrganicVacuole`, `svgOrganicVacuole` |
| **Wrong zoom scaling** | Uses `sqrt(zm)` for sizes (good, only spice that does this); but `lineWidth: max(0.6, lineWidth * 0.7)` — NO zoom scaling at all → inconsistent with Louro/Alho/Pimenta (which DO scale lineWidth × zm). Membrane outlines vanish at large zoom because the canvas is far bigger than 0.7px strokes |
| **Light/dark consistency** | ✅ |
| **Hardcoded/hacked** | All layer multipliers (×1.5, ×2.5, ×22, ×45, ×55), cluster bias values (0.55, 0.82, 0.90, 0.40), size tier thresholds (0.30/0.80, 0.60/0.92) |

---

### 🌿 **OREGANO (Orégano)** (`renderOreganoMicroscopeGrid` + `generateOreganoSporePositions`)

| Question | Finding |
|---|---|
| **Affects geometry** | `zoom`, `density`, `rotation` (per-capsule angle bias), `layoutSeed` |
| **Rendering only** | `themeMode` |
| **Fake-global / silent** | `voronoiRoundedness`, `lineWidth` (no strokes!), `noise`, `fillAlpha`, `lightingAngle`, `gridScale`, `gridMode` |
| **Conflicts** | `targetCount = max(8, round((density * 2.5) / max(0.5, zm)))` — yet another formula variant. Spacing uses `minDist = baseH * 1.1` — coupling between size and spacing causes density slider to feel inert when zoom is high |
| **Unique procedural logic** | Clustered Poisson-disc with O(1) grid neighbor checks. 2–4 cluster centers, scatter around them. Per-spore aspect/rot wobble |
| **Reuses shared system** | `buildOrganicCapsulePts`, `pathOrganicCapsuleCanvas`, `svgOrganicCapsulePath` |
| **Wrong zoom scaling** | `baseH = minDim * 0.046 * zm` — linear zoom scaling. At 1200x zoom each capsule is ~660px → 1 capsule fills canvas |
| **Light/dark consistency** | ✅ |
| **Hardcoded/hacked** | `baseH = 0.046 * minDim`, `targetCount` multiplier `2.5`, attempts cap `50`, cluster count `2-4`, spread range `0.08–0.46` |

---

## Cross-Cutting Observations

### Dead Parameters (defined in `PatternConfig`, never read)
- `fillAlpha` — **completely dead**
- `lightingAngle` — **completely dead**
- `gridScale` — **completely dead** (legacy from old tile system)
- `gridMode` — **completely dead in renderers** (only used in `renderCombinedMural` quadrant logic which itself is unreachable)
- `noise` — only consumed in the fallback particle path → effectively Salt-only

### Live Parameters
| Param | Salt | Louro | Alho | Pimenta | Basil | Oregano |
|---|---|---|---|---|---|---|
| `zoom` | ✓ size | ✓ count | ✓ count | ✓ count | ✓ size only | ✓ size+count |
| `density` | ✓ count | ✓ count | ✓ count | ✓ count | ✓ count | ✓ count |
| `rotation` | ❌ | ✓ anisotropy | ✓ anisotropy | ✓ anisotropy | ✓ trichome axis | ✓ per-capsule |
| `lineWidth` | ❌ | ✓ scaled | ✓ scaled | ✓ scaled | ✓ flat | ❌ |
| `voronoiRoundedness` | ❌ | ✓ | ✓ | ✓ | ❌ (slider exposed!) | ❌ |
| `noise` | ✓ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Mathematical Conflicts
1. **Three different M formulas** for the same conceptual question "how many cells per viewport":
   - Louro/Alho: `(density/3) / zm`, clamped [3, 22]
   - Pimenta: `(density * 0.45) / zm`, clamped [3, 11]
   - Oregano: `(density * 2.5) / max(0.5, zm)`, no upper clamp
   - Basil: doesn't divide by zoom at all
   - Salt: just `round(density)` — zoom doesn't affect count
2. **Stroke width** scales differently per spice: Louro ×1.5×zm, Alho ×1.3×zm, Pimenta ×1.5×zm, Basil ×0.7 flat, Oregano none, Salt none. The user's session-6 spec says "constant in both themes" but it's not even constant across spices or zoom levels.
3. **`zoom` semantically inconsistent**: For Voronoi spices it's a divisor on count (more zoom = fewer cells). For Salt/Basil/Oregano it's a multiplier on size only. Same slider, two opposite meanings.
4. **`density` semantically inconsistent**: For Voronoi it's a numerator on M (cells). For Basil it's a multiplier on 5 different layer counts simultaneously. For Salt it's absolute count.

### Generators That Share Reusable Systems
- **Voronoi machinery** is duplicated across Louro / Alho / Pimenta (near-identical code blocks for `clipPolygon` calls + anisotropic transform + jittered grid). Pimenta diverges with multi-scale seeding.
- **Organic blob/vacuole helpers** (`pathOrganicBlob`, `pathOrganicVacuole`, `pathOrganicCapsule`, `buildOrganicBlobPoints`) — all do the same thing with slight variants. **At least 3 redundant implementations**.
- **`buildOrganicBlobPoints` + `pathFromBlobPoints` + `svgFromBlobPoints`** (session 7) is the cleanest abstraction — Basil-only. Should replace all the others.
- **Canvas/SVG twin pattern**: every spice has `renderXMicroscopeGrid` + `generateXSVGPatternString` — heavy duplication. Could be unified through a single intermediate-representation list of draw operations.

### Generators That Use Unique Procedural Logic
- **Pimenta**: only spice with multi-scale Voronoi seeding (sparse + clustered)
- **Pimenta**: only spice with intra-cell micro-particle placement
- **Oregano**: only spice with Poisson-disc spatial hashing
- **Basil**: only spice with multi-layer pipeline + biomass density centers + trichome filaments
- **Salt**: only spice still using the legacy particle dispatch system
- **Louro / Alho**: structurally identical (near-clones), differ only in stretch constant, jitter, lineWidth multiplier, and Alho's nucleus overlay

### Parameters That Scale Incorrectly With Zoom
| Issue | Spice | Effect |
|---|---|---|
| stroke width grows linearly with zoom | Louro, Alho, Pimenta | at 1200x → 12× thicker strokes than at 100x |
| capsule size grows linearly with zoom | Oregano | single capsule fills canvas at 1200x |
| micro-particle inset stays constant (8px) | Pimenta | at high zoom, inset disappears relative to cells |
| micro-particle radii in absolute pixels | Pimenta | invisible at high zoom relative to giant cells |
| Basil does NOT reduce count with zoom | Basil | violates spec "higher zoom = fewer structures" |
| Salt does NOT reduce count with zoom | Salt | same violation |

### Parameters That Break Light/Dark Consistency
- **None currently** ✓ — all spices were normalized in session 4 to pure color inversion + bg-colored stroke.
- **Hidden risk**: `lineWidth` flat in Basil + scaled in Voronoi spices means a "stroke=2" looks different across spices but is *consistent within a spice across themes* — so the consistency rule holds, but the slider's perceptual meaning shifts when changing spice.

### Hardcoded / Hacked Constants (the major ones)
- `CREAM = 'oklch(96% 0.008 88.75)'` — fine, intentional canonical
- `stretch` constants: Louro 1.6, Alho 1.35, Pimenta 1.22 — arbitrary
- Jitter ranges: Louro ±0.35, Alho ±0.32 — arbitrary
- All "M = density × ?" multipliers — arbitrary
- All Basil layer multipliers (×1.5, ×2.5, ×22, ×45, ×55) — arbitrary
- Oregano `baseH = 0.046 * minDim` — magic
- Particle size in `generateParticles`: `(16, 42)` — magic
- Pimenta sparse/cluster ratios `0.20 / 0.85` — magic
- Per-shape "size multipliers" (1.10, 1.15, 1.25, 1.35) sprinkled in particle drawers — magic
- Particle min-spacing `12px` constant in Pimenta — magic

### Currently Hidden Behaviors That Should Be Exposed Or Removed
- **Stretch / anisotropy ratio** is currently fixed per spice but conceptually it's part of "rotation/elongation". Could be exposed as a "Anisotropy" slider, or removed and replaced with `rotation`-only.
- **Pimenta sparse-vs-cluster mix ratio** could be a slider (large cells vs micro-clusters)
- **Basil layer balance** (membranes/chloroplasts/grains ratios) is hidden — could be exposed as one slider "tissue density" decoupled from `density`
- **`noise` is dead** for 5/6 spices but slider isn't even shown in UI (per current UI it's not shown — so silently dead)

---

================
# FINAL PROPOSAL
================

## A. GLOBAL PARAMETER LIST (shared, perceptually consistent)

| Parameter | Range | Semantic |
|---|---|---|
| `magnification` (Zoom) | 40–1200x, log scale | **Only affects sizes**, never count. Higher = larger structures. |
| `density` | 2–40 | **Only affects count**, never size. Cells/structures visible in viewport. |
| `tissueOrientation` (Rotation) | 0–180° | **Internal anisotropy bias only**. Affects elongation direction, filament flow, cluster orientation. NEVER rotates the canvas. |
| `membraneThickness` (Stroke) | 0.5–6.0 px | **Absolute pixel value**, identical across spices, identical across themes, **does NOT scale with zoom**. |
| `cellSoftness` (Rounding) | 0–100% | **Cubic ease-in interpolation** from rigid to organic, applied uniformly to any polygon-edged spice. |
| `themeMode` | light/dark | Pure color inversion only. |
| `layoutSeed` | int | Determinism. |

## B. SPICE-SPECIFIC PARAMETERS (unique morphology)

| Spice | Unique Slider | Range | Why it's spice-specific |
|---|---|---|---|
| **Salt** | `crystalSpread` | 0.5–2.0 | Mix between cubic vs spheroid vs pebble shapes |
| **Bay Leaf** | `cellElongation` (stretch) | 1.0–2.5 | Currently hardcoded `1.6`; controls leaf-cell elongation |
| **Garlic** | `mitosisRatio` | 0–1 | Frequency of telophase pairs vs interphase nuclei (currently `0.85` magic) |
| **Pepper** | `clusterDensity` | 0–1 | Ratio of sparse-cell to clustered-cell seeding (currently `0.20`/`0.85` magic) |
| **Basil** | `chloroplastBalance` | 0–1 | Bias between membrane-outline density vs filled-grain density |
| **Oregano** | `clusterTightness` | 0.05–0.5 | Spread radius around cluster centers (currently `0.08–0.46` magic) |

## C. INTERNAL HIDDEN PARAMETERS (engine-only, not exposed)

| Constant | Reason hidden |
|---|---|
| `CREAM` color | Identity / brand canonical |
| SEASONINGS_OKLCH per-spice palette | Brand identity |
| Per-spice baseline size in pixels | Calibrated reference (one unit = "average cell at 100x") |
| Voronoi clipping math constants | Implementation detail |
| Trichome bezier sample count | Implementation detail |
| Spatial hashing cell size | Optimization detail |
| Micro-particle Poisson min-spacing | Optimization detail |

## D. PARAMETER NORMALIZATION STRATEGY

1. **Magnification is log-scaled** internally: `effectiveScale = 2^((zoom - 100) / 200)` so 100→1×, 300→~3×, 1000→~22× — gives perceptual smoothness instead of linear feel.
2. **Density is "structures-per-viewport"** as a direct target count. Every spice converts via the same canonical function `targetStructures(density, viewportArea)` regardless of underlying engine.
3. **Stroke is pixel-absolute** — never multiplied by zoom. The same `2.0` slider produces a 2px line at 40x AND at 1200x. (Visual "thickness" in absolute terms.)
4. **Rounding uses one shared easing curve** (`cubic ease-in`) for all polygon-edged spices.
5. **Rotation is bidirectional axis** (0–180°): for all spices it produces the same directional bias; spices interpret it as anisotropy direction internally.
6. **Theme is binary, pure color swap** — no thickness, no opacity, no geometry changes. (Already enforced.)
7. **Spice-specific slider** is always the 6th slot; identical visual treatment in UI; range normalized 0–100% in UI but mapped internally.

## E. PARAMETER DEPENDENCY MAP

```
magnification ──> structure_size (all spices)
              └─> NOT count, NOT stroke, NOT roundness

density ──────> structure_count (all spices)
            └─> NOT size, NOT stroke

rotation ─────> anisotropy_direction (Louro/Alho/Pimenta = stretch axis)
            └─> filament_axis (Basil trichomes, Oregano capsules)
            └─> nothing (Salt — currently dead)

stroke ───────> outline_thickness_absolute_pixels (Louro/Alho/Pimenta/Basil)
            └─> NOT size, NOT count

rounding ─────> polygon_corner_radius_eased (Louro/Alho/Pimenta only)
            └─> nothing on amorphous spices (Salt/Basil/Oregano)

theme ────────> color_swap_only

spice_specific ──> per-spice morphology bias only

[REMOVED] fillAlpha, lightingAngle, gridScale, gridMode, noise (Basil/Louro/Alho/Pimenta/Oregano)
```

## F. CURRENT TECHNICAL DEBT (ranked by impact)

1. **Two parallel rendering systems coexist** (legacy particle dispatch + new microscope grids). Salt is the only consumer of the legacy path; everything else uses the new path. The fallback in `renderPatternTile` is now mostly dead code. **Fix: collapse Salt into a microscope-grid renderer or formally archive the legacy path**.

2. **Density formula is duplicated 5 ways** with different magic constants (`density/3`, `density*0.45`, `density*2.5`, layer multipliers, absolute). The same slider position produces wildly different "amounts" per spice. **Fix: one shared `targetCount(density, zoom, spice_base_count)` function**.

3. **Stroke width inconsistency** — 4 different formulas for the "same" slider. **Fix: stroke is always absolute pixels, never multiplied by zoom**.

4. **Three near-duplicate Voronoi renderers** (Louro/Alho/Pimenta) — ~500 lines of repeated tessellation code. Each diverges in only ~10–20 parameters. **Fix: one `renderVoronoiMicroscopeGrid(config, hooks)` that takes spice-specific hooks for: seed-placement strategy, cell-content overlay (nuclei/particles), stretch constant, etc.**

5. **Canvas/SVG twin functions** double the code surface and the bug surface. Currently held in sync by careful seed reuse, but any change to one risks drift. **Fix: one render pipeline that emits an intermediate display list `(shapes[])`, then trivial canvas + SVG consumers.**

6. **`voronoiRoundedness` slider visible for Basil but ignored** — direct regression from session 7's UI conditional change. **Fix: either remove from Basil UI or implement (Basil has no polygons — would have to mean something else, so remove)**.

7. **`generateParticles` hardcodes `size = rng.range(16, 42)`** and is consumed only by Salt now. Magic constant baked into shared utility. **Fix: pass size-range as parameter, or absorb into Salt-specific generator.**

8. **PatternConfig has 4 completely dead fields** (`fillAlpha`, `lightingAngle`, `gridScale`, `gridMode`). **Fix: delete from type + everywhere that constructs configs.**

9. **`getCuratedConfigForSeasoning` is the only place per-spice defaults exist**, but the UI hardcodes slider ranges separately, and `PARAMETER_PRESETS` is yet another source of truth — three places to keep in sync. **Fix: single source `PARAMETER_PRESETS`; UI reads ranges from it; curated config reads defaults from it.**

10. **Organic-blob helper proliferation**: `pathOrganicBlob`, `pathOrganicVacuole`, `pathOrganicCapsule`, `buildOrganicBlobPoints` — 4 functions doing essentially the same thing. **Fix: collapse to one parameterized `organicShape(n_points, dent, aspect, rng)`.**

---

## Production-Readiness Ranking

| Spice | State | Notes |
|---|---|---|
| **Pepper (Pimenta)** | 🟢 Production-ready | Most polished. Multi-scale Voronoi + intra-cell particles + canvas/SVG parity + theme inversion verified pixel-level. Only issue: stroke scales wrong with zoom. |
| **Basil (Manjericão)** | 🟡 Beta — fresh redesign, needs polish | Engine is sound, but `voronoiRoundedness` slider is fake, lineWidth doesn't scale, count never reduces with zoom. Visually strong. |
| **Oregano (Orégano)** | 🟡 Beta | Clean code, but capsules grow uncontrollably at high zoom; rotation barely visible. |
| **Bay Leaf (Louro)** | 🟢 Production-ready (with caveats) | Solid Voronoi, anisotropy works. Near-duplicate of Garlic. |
| **Garlic (Alho)** | 🟢 Production-ready (with caveats) | Same as Louro + working mitosis nuclei. |
| **Salt** | 🔴 Needs rewrite | Last user of legacy particle path. Rotation slider is silently dead. No microscopy feel — looks like an abstract dot pattern. |

## Generators Closest To Production
- **Pepper, Garlic, Bay Leaf** — all could ship as-is after the global stroke fix.

## Generators Needing Full Rewrites
- **Salt** — needs a microscopy-style engine like the other 5; currently still on the legacy particle dispatch
- **Oregano** — engine is OK but the scaling math needs to switch to `sqrt(zm)` like Basil; also could benefit from internal vesicle/pollen detail to be perceptually distinct from "just ovals"

## Systems To Abstract Into Reusable Utilities
1. **`organicShape(rng, params)`** — replaces `pathOrganicBlob` + `pathOrganicVacuole` + `pathOrganicCapsule` + `buildOrganicBlobPoints`
2. **`VoronoiGrid(seeds, stretch, rotation, clipFn) → Polygons[]`** — replaces 3 near-duplicate Voronoi code blocks
3. **`drawList = [{kind, points, fill, stroke, strokeWidth}]`** — intermediate format, then `renderToCanvas(drawList, ctx)` + `renderToSvg(drawList)` consumers
4. **`targetCount(density, zoom, baselineCount) → int`** — single density formula
5. **`scaleAtZoom(value, zoom, mode: 'linear'|'sqrt'|'absolute') → number`** — single zoom-scaling utility
6. **`samplePointBiased(clusters, biasWeight, rng) → {x,y}`** — extracted from Basil, reusable for any cluster-biased layout

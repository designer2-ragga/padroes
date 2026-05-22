# Post-P7 Audit — Engine State After Legacy Cleanup

**Branch:** `refactor/morphology-engine`
**As of commit:** `ed87ba5` (P7-B addendum)
**Snapshot parity:** 12/12 byte-identical at seed=42 across all 6 spices × 2 themes

---

## Verification gates

| Check | Status |
|---|---|
| TypeScript `--noEmit` | ✅ clean |
| 12/12 baseline snapshots byte-identical | ✅ verified |
| No unreachable code from legacy particle pipeline | ✅ verified |
| No remaining references to `particleType` (non-comment) | ✅ |
| No remaining references to `noise` field (non-comment) | ✅ |
| No remaining references to `gridScale`/`gridMode`/`fillAlpha`/`lightingAngle` | ✅ |
| No dead imports in any active file | ✅ |
| No dead exported types | ✅ |
| Two `gridMode` mentions remain — both comments documenting prior deletions | ✅ intentional |

---

## Net LOC removed since baseline

| File | Pre-baseline (5e6826c) | Post-P7 (ed87ba5) | Δ |
|---|---:|---:|---:|
| `src/utils/patternRenderer.ts` | 2691 | **1858** | **−833** (−31%) |
| `src/types.ts` | 145 | **92** | **−53** (−37%) |
| `src/components/PatternWorkspace.tsx` | 431 | 431 | 0 |
| `src/App.tsx` | 99 | 99 | 0 |
| `src/engine/parameters.ts` | 0 (new) | 134 | +134 |
| `src/engine/scaling.ts` | 0 (new) | 168 | +168 |
| `src/engine/voronoi.ts` | 0 (new) | 175 | +175 |
| **Total** | 3366 | **2957** | **−409 net** |

**Engine work decomposes as:**
- Legacy code deleted: ~886 lines
- New canonical engine modules: ~477 lines
- Net architectural reduction: **−409 lines** while replacing 6 distinct renderer architectures with 1 canonical pattern.

---

## Remaining helpers in `patternRenderer.ts` — grouped by category

### A. Shared utilities — candidates for `src/renderers/shared/`

| Helper | Lines | Used by | Stable? |
|---|---:|---|---|
| `SeededRandom` class | ~25 | every renderer + sub-helpers | ✅ canonical |
| `pathOrganicVacuole` (canvas) | ~16 | Alho nuclei, Pimenta particles, Manjericão grains | 🔄 organicShape target |
| `svgOrganicVacuole` (SVG) | ~14 | Alho SVG nuclei, Pimenta SVG particles, Manjericão SVG grains | 🔄 organicShape target |
| `getThemeColors` | ~5 | all 6 renderers | ✅ canonical |
| `easingRounding` | ~5 | `drawRoundedPolygon` + SVG variant | ✅ canonical |
| `drawRoundedPolygon` (canvas) | ~37 | Louro, Alho, Pimenta | ✅ canonical |
| `getRoundedPolygonSvgPath` | ~36 | Louro SVG, Alho SVG, Pimenta SVG | ✅ canonical |
| `getPolygonCentroid` (alias) | ~5 | Alho canvas+SVG | ✅ thin wrapper around `engine/voronoi.polygonCentroid` |
| `calculatePolygonArea` (alias) | ~1 | Pimenta canvas+SVG | ✅ thin wrapper around `engine/voronoi.polygonArea` |
| `CREAM` constant | 1 | every renderer | ✅ canonical |
| `SEASONINGS_OKLCH` | ~15 | every renderer | ✅ brand data |

### B. Spice-specific morphology — keep per-spice procedural identity

| Spice | Helpers (canvas + SVG combined) | Approx LOC | Topology |
|---|---|---:|---|
| **Louro** | `renderLouro…` + `generateLouroSVG…` | ~165 | Voronoi jittered grid |
| **Alho** | renderer pair + `drawMitosisNucleus` + `generateMitosisNucleusSvg` | ~290 | Voronoi + nucleus overlay |
| **Pimenta** | renderer pair + `generateParticlesInPolygon` + `insetPolygonForParticles` | ~430 | Voronoi multi-scale + intra-cell particles |
| **Orégano** | renderer pair + `generateOreganoSporePositions` + `buildOrganicCapsulePts` + `pathOrganicCapsuleCanvas` + `svgOrganicCapsulePath` | ~225 | Poisson-disc clustered capsules |
| **Sal** | renderer pair + `generateSalCrystalPositions` + `buildCrystalPolygonPts` + `pathCrystalCanvas` + `svgCrystalPath` | ~242 | Poisson-disc clustered crystals (cubic/hex/octagonal) |
| **Manjericão** | renderer pair + `generateBasilLayout` + `buildOrganicBlobPoints` + `pathFromBlobPoints` + `svgFromBlobPoints` + `buildTrichomeSamples` | ~360 | 5-layer organic system |

### C. Top-level dispatchers

| Function | Lines | Purpose |
|---|---:|---|
| `renderPatternTile` | ~37 | Spice id → canvas renderer (6 ifs + safeguard) |
| `generateSVGPatternString` | ~37 | Spice id → SVG generator (6 ifs + throw) |
| `getCuratedConfigForSeasoning` | ~36 | Per-spice curated defaults with RNG variance ±5%/±15%/±10% |

---

## Remaining duplicated logic

### High-priority duplications (organicShape target)

| Duplicated Pattern | Instances | Why duplicated | Deletable LOC if unified |
|---|---|---|---:|
| **`pathOrganicVacuole` vs `buildOrganicBlobPoints`+`pathFromBlobPoints`** | 2 representations of the same idea (n-pt organic blob via quadratic curves) | Different evolution paths — vacuole was older, blob points came with Manjericão | ~30 |
| **`svgOrganicVacuole` vs `svgFromBlobPoints`** | Same as above for SVG | Same | ~14 |
| **Canvas + SVG twin functions per spice** | 6 spices × 2 = 12 functions, ~50% of their bodies are identical layout code (just emit-target differs) | Pre-Scene-IR architecture | ~300 (deferred, scope = Scene IR) |

### Lower-priority similarities (NOT worth unifying)

| Pattern | Instances | Why keep separate |
|---|---|---|
| `buildOrganicCapsulePts` (Orégano) vs `buildOrganicBlobPoints` (Manjericão) | 2 | Capsule has unique bending math + 8-pt symmetry; collapsing loses morphology identity |
| `buildCrystalPolygonPts` (Sal) vs the organic builders | 1 | Crystalline = sharp edges, intentionally distinct; sharing impl would erase Sal's identity |
| `buildTrichomeSamples` (Manjericão trichomes) | 1 | Cubic Bezier with sin-envelope taper — unique to filament-style features |
| Voronoi loops in Louro/Alho/Pimenta | 3 | Per-spice anisotropy + neighbor strategies differ enough; primitives already shared via `engine/voronoi` |

### Estimated LOC deletable after organicShape() unification

- **Strict unification (rename + delete dual API):** ~44 lines (`pathOrganicVacuole` + `svgOrganicVacuole`)
- **Aggressive unification (also collapse aliases):** add ~6 lines (`getPolygonCentroid` + `calculatePolygonArea` aliases — could re-export from engine instead)
- **Total realistic gain:** ~50 lines

Modest gain. The bigger win from `organicShape()` is conceptual, not LOC: **one mental model for "an n-sided organic shape with rng-driven jitter"** instead of three.

---

## Should `patternRenderer.ts` be split physically?

**Recommendation: YES, but AFTER organicShape unification.**

At 1858 lines, the file violates the "scroll-readable" threshold (~500 lines for human navigation). It contains:
- 1 RNG class
- 11 shared utility helpers (~140 lines)
- 1858 − 140 = **~1718 lines of spice-specific morphology** = 6 spices × ~286 lines avg

Proposed split (deferred — do AFTER organicShape):

```
src/renderers/
├── shared/
│   ├── organicShape.ts    (unified organic builder + canvas/SVG path emitters)
│   ├── polygon.ts          (drawRoundedPolygon, getRoundedPolygonSvgPath, easingRounding)
│   ├── theme.ts            (SEASONINGS_OKLCH, CREAM, getThemeColors)
│   └── rng.ts              (SeededRandom)
├── louro.ts                (~165 lines)
├── alho.ts                 (~290 lines, includes mitosis helpers)
├── pimenta.ts              (~430 lines, includes intra-cell particles)
├── oregano.ts              (~225 lines, includes capsule helpers)
├── sal.ts                  (~242 lines, includes crystal helpers)
├── manjericao.ts           (~360 lines, includes basil layout + trichome samples)
└── dispatch.ts             (~110 lines — renderPatternTile + generateSVGPatternString + getCuratedConfigForSeasoning)
```

**Why deferring is correct:** organicShape unification may relocate some helpers across spices. Doing the split first would mean immediately moving things between the new files. Cleaner to split once organicShape lands.

---

## Current architecture map

```
src/
├── App.tsx                      (99   — pattern selector + theme + workspace mount)
├── components/
│   └── PatternWorkspace.tsx     (431  — frame presets + sliders driven by PARAMETERS registry)
├── types.ts                     (92   — Seasoning, PatternConfig, TEMPEROS_RAGGA only)
├── engine/                      ← canonical pipeline
│   ├── parameters.ts            (134  — PARAMETERS registry: zoom/density/rotation/lineWidth/voronoiRoundedness)
│   ├── scaling.ts               (168  — scaleAtZoom + targetCount + strokeWidth + SPICE_DENSITY_FACTORS)
│   └── voronoi.ts               (175  — clipPolygon + createAnisotropicTransform + polygon helpers)
└── utils/
    └── patternRenderer.ts       (1858 — RNG + theme + 6 spice renderers + dispatchers)

calibration/                     ← perceptual ruler (24 reference PNGs)
baseline-snapshots/              ← regression-test PNGs (12 spice/theme combos at seed=42)
scripts/
├── decode-baseline.cjs          (regenerate baseline-snapshots from preview-eval dump)
├── decode-calibration.cjs       (regenerate calibration/ from preview-eval dump)
└── diff-snapshots.cjs           (MD5-compare fresh capture vs baseline-snapshots/)

VISUAL_CALIBRATION.md            (engine-wide perceptual ruler: Louro/Manjericão/Orégano/Sal at 100/300/800/1200x)
ARCHITECTURE_AUDIT.md            (pre-refactor analysis)
REFACTOR_PROPOSAL.md             (20-point refactor plan)
POST_P7_AUDIT.md                 (this file)
```

---

## Proposed organicShape() migration order — safest first

### A. Safest migration order

1. **Establish the canonical signature** (no code change yet — types/comments only):
   ```typescript
   organicShape(opts: {
     cx: number; cy: number;
     rx: number; ry: number;
     points: number;
     dent: number;   // 0..1 — per-vertex radius jitter amount
     rng: SeededRandom;
   }): Vec2[]
   ```
   Equivalent to current `buildOrganicBlobPoints` + signature normalization.

2. **Rename `buildOrganicBlobPoints` → `organicShape`** (in-place rename, no callsite changes other than the import). Manjericão keeps working via the new name. Snapshot must remain 12/12.

3. **Migrate `pathOrganicVacuole` callers** (3 callers): switch to `organicShape({...}) + pathFromBlobPoints(...)`. **RISK: medium** — current `pathOrganicVacuole` consumes rng directly in a loop; canonical pattern does the same but with extra build/trace separation. Per-vertex RNG order must stay IDENTICAL.

4. **Delete `pathOrganicVacuole` + `svgOrganicVacuole`** once all 3 callers migrated.

5. **Leave capsule, crystal, trichome helpers untouched.** They have intrinsic morphology that doesn't compose into the canonical organic-blob pattern.

### B. Which helper should become canonical

**`buildOrganicBlobPoints` + `pathFromBlobPoints` + `svgFromBlobPoints`** (the Manjericão trio) is already the cleanest separation. Promote it to engine, rename `build` → `organicShape`, keep `pathFromBlobPoints` / `svgFromBlobPoints` as canonical emitters.

Reasons:
- Already separates "produce vertex list" from "trace to context" — composable.
- Generic on cx/cy + rx/ry → handles both circular (rx=ry) and elliptical cases.
- Takes seed string OR rng (both supported by signature).
- Already used by Manjericão membranes (3-tier sizes) + chloroplasts (3-tier sizes) without modification — proves flexibility.

### C. Exact RNG-risk points

Migration MUST preserve RNG consumption order to keep pixel parity. Risk points:

| Location | Risk | Mitigation |
|---|---|---|
| `pathOrganicVacuole` consumes rng inline in a `for` loop | If the canonical version moves the rng consumption to a different point (e.g., bulk-precomputes), pixel parity breaks. | Verify the canonical version still consumes rng one-call-per-vertex in the same order |
| `drawMitosisNucleus` (Alho) seeds a fresh `SeededRandom` per cell then calls `pathOrganicVacuole(ctx, r, 7, rng, 0.07)` | If canonical signature requires a different RNG entry point, must adapt | Pass rng-as-parameter (already supported in `buildOrganicBlobPoints` when using seedStr, but parameter passing differs) |
| `generateParticlesInPolygon` (Pimenta) creates rng before vacuole calls | Same as above | Same |
| `generateBasilLayout` grain layer uses `'basil_g_' + i + '_' + seed` as seedStr | If `organicShape` doesn't accept seedStr param, must reshape callsite | Either keep seedStr-based API or migrate Manjericão callers to inject rng |

### D. Recommended module split (post-organicShape)

The split structure under "Should patternRenderer.ts be split physically?" above. Do it AFTER organicShape lands so the file boundaries reflect the post-unification reality.

---

## Next safest commit sequence

1. **`refactor(organic): rename buildOrganicBlobPoints → organicShape`**
   Pure rename. 12/12 byte-identical guaranteed.

2. **`refactor(organic): migrate drawMitosisNucleus to organicShape`** (Alho only)
   Convert `pathOrganicVacuole(ctx, r, 7, rng, 0.07)` callsites to
   `pathFromBlobPoints(ctx, organicShape({cx:0, cy:0, rx:r, ry:r, points:7, dent:0.07, rng}))`.
   Snapshot must remain 12/12.

3. **`refactor(organic): migrate Pimenta particles to organicShape`**
   Same conversion in `renderPimentaMicroscopeGrid` + `generatePimentaSVGPatternString`.
   Snapshot 12/12.

4. **`refactor(organic): migrate Manjericão grains to organicShape`**
   Grains layer in `generateBasilLayout` — currently uses pathOrganicVacuole. Migrate.
   Snapshot expectations: 12/12 (these callsites are direct one-to-one conversions).

5. **`refactor(organic): delete pathOrganicVacuole + svgOrganicVacuole`**
   Now orphans. Delete. Snapshot 12/12.

6. **`refactor(split): extract shared helpers to src/renderers/shared/`**
   Move organicShape + pathFromBlobPoints + svgFromBlobPoints + SeededRandom +
   getThemeColors + drawRoundedPolygon + getRoundedPolygonSvgPath + easingRounding +
   getPolygonCentroid + calculatePolygonArea + SEASONINGS_OKLCH + CREAM.
   Snapshot 12/12.

7. **`refactor(split): extract per-spice renderers to src/renderers/{spice}.ts`**
   6 commits, one per spice. Each preserves pixel parity. Snapshot 12/12 each time.

8. **`refactor(split): patternRenderer.ts → utils/dispatch.ts`**
   Final cleanup — what's left becomes the thin dispatcher.

After this sequence, expect:
- `patternRenderer.ts` deleted (or renamed `dispatch.ts`) — ~100 lines
- `src/renderers/` directory with 6 spice files + shared subdirectory
- Mental model: open one file per spice, edit morphology there, no scrolling 1858-line file

---

## Stop point

P7 cleanup phase is complete. Tasks #12, #13, #14 closed. Awaiting user direction before starting organicShape unification (proposed step 1 of the next sequence above).

# Architectural Refactor Proposal — Ragga Micro Pattern Engine

**GOAL:**
Transform the engine from "6 separate renderers" into "1 morphology system with spice-specific behaviors".
Keep visual identity. Remove duplicated logic. Normalize all sliders.

---

## 1. CREATE A CORE MORPHOLOGY ENGINE

Instead of:

```
renderSalt()
renderGarlic()
renderPepper()
renderOregano()
```

Create:

```
renderMorphology({
  structureGenerator,
  placementGenerator,
  internalDetailGenerator,
  renderStyle
})
```

Every spice becomes a configuration layer.

This removes:
- duplicated SVG/canvas logic
- duplicated Voronoi code
- duplicated organic shape code
- inconsistent zoom behavior

---

## 2. UNIFY ALL ORGANIC SHAPES

Replace:
- `pathOrganicBlob`
- `pathOrganicVacuole`
- `pathOrganicCapsule`
- `buildOrganicBlobPoints`

With:

```
generateOrganicShape({
  points,
  irregularity,
  aspect,
  softness,
  inset,
  noise,
  rng
})
```

Then every spice simply configures it differently.

**Examples:**

Salt:
- low softness
- low irregularity

Pepper:
- medium softness
- high irregularity

Oregano:
- elongated aspect
- low irregularity

Garlic nuclei:
- high softness
- medium aspect

This alone removes huge code duplication.

---

## 3. CREATE A UNIVERSAL ZOOM SYSTEM

**Current problem:**
Every spice interprets zoom differently.

**Fix:**

`magnification` ONLY changes:
- structure scale

Never:
- count
- stroke width
- spacing

**Internal:**

```
zoomScale = pow(2, (zoom - 100) / 220)
```

**Benefits:**
- perceptually smooth
- microscopy-feeling
- identical behavior across spices

---

## 4. CREATE A UNIVERSAL DENSITY SYSTEM

**Current:**
5 different formulas.

**Replace with:**

```
targetCount({
  density,
  viewportArea,
  spiceFactor
})
```

**Examples:**
- Salt `spiceFactor = 1.4`
- Pepper = 0.8
- Basil = 1.8

But SAME SYSTEM.

**Benefits:**
- sliders finally feel consistent
- user intuition improves massively

---

## 5. CREATE A SHARED VORONOI ENGINE

Merge:
- Louro
- Garlic
- Pepper

Into:

```
generateVoronoiCells({
  seedStrategy,
  anisotropy,
  softness,
  density
})
```

Then:

Pepper:
- clustered seeds

Garlic:
- nuclei overlays

Bay Leaf:
- elongated anisotropy

This removes hundreds of duplicated lines.

---

## 6. CREATE A DISPLAY LIST PIPELINE

**Current:**
Canvas renderer and SVG renderer are duplicated.

**Instead:**

```
scene = [
  {
    kind: 'shape',
    points,
    fill,
    stroke,
    width
  }
]
```

Then:

```
renderSceneCanvas(scene)
renderSceneSVG(scene)
```

**Massive advantages:**
- SVG parity guaranteed
- easier exports
- future animation possible
- easier debugging

---

## 7. CREATE A PARAMETER REGISTRY

**Current:**
Ranges exist in:
- UI
- defaults
- presets

**Create:**

```
PARAMETERS = {
  density: {
    min,
    max,
    default,
    uiLabel
  }
}
```

Single source of truth.

**Then:**
- UI auto-generates sliders
- presets auto-sync
- future spices easier

---

## 8. REMOVE DEAD PARAMETERS

**DELETE:**
- `fillAlpha`
- `lightingAngle`
- `gridScale`
- `gridMode`

**Potentially remove:**
- `noise`

**Benefits:**
- simpler UI
- less cognitive load
- smaller config object
- easier prompting

---

## 9. CREATE A MORPHOLOGY LAYER SYSTEM

Instead of hardcoding internals.

**Use layers:**

```
layers: [
  membranes,
  nuclei,
  particles,
  vacuoles,
  fibers
]
```

Pepper:
`[membrane, vacuoles, microdots]`

Basil:
`[membrane, chloroplasts, trichomes]`

Garlic:
`[membrane, nuclei]`

This becomes EXTREMELY scalable.

---

## 10. FIX STROKE PHILOSOPHY GLOBALLY

**RULE:**
Stroke width NEVER scales with zoom.

Current system breaks microscopy illusion.

**Use:**

```
strokePx = uiStroke
```

Always absolute.

This is critical.

---

## 11. NORMALIZE THEME SYSTEM

**Current:**
Mostly solved.

**Formalize:**

LIGHT:
- background = keyColor
- shape = cream

DARK:
- background = cream
- shape = keyColor

Nothing else changes.
No opacity changes.
No thicker strokes.
No glow.

Pure inversion only.

---

## 12. CREATE SPICE DNA CONFIGS

Instead of giant renderer logic:

```
SPICE_DNA = {
  pepper: {
    morphology: 'voronoi_clustered',
    anisotropy: 1.2,
    internalDots: true,
    vacuoles: true,
    edgeSoftness: 0.72
  }
}
```

This makes:
- adding new spices trivial
- behavior consistent
- AI prompting MUCH easier

---

## 13. REWRITE SALT COMPLETELY

Current Salt is legacy.

**Should become:**
"crystalline microscopy"

**Ideas:**
- fractured mineral plates
- clustered crystal fractures
- jagged translucent grains
- crystallographic edges

**Should use:**
same morphology engine.

---

## 14. ADD TRUE MICROSCOPY SCALE LOGIC

**Right now:**
Zoom is abstract.

**Instead:**
Every spice gets:
`baseMicronScale`

**Then:**
- 40x
- 100x
- 400x
- 1000x

Actually feel different biologically.

**Examples:**

1000x Pepper:
- fewer giant membranes
- more visible microdots

100x Oregano:
- more capsules visible

This is HUGE perceptually.

---

## 15. CREATE BIOLOGICAL NOISE FIELDS

**Instead of pure random.**

**Use:**
flow fields / scalar noise maps

**Benefits:**
- natural clustering
- tissue-like continuity
- less procedural feeling

**Especially useful for:**
- Basil
- Pepper
- Garlic

---

## 16. CREATE SPATIAL ECOLOGY

**Currently:**
objects independent.

**Instead:**
structures influence neighbors.

**Examples:**
- oregano capsules align locally
- pepper cells compress together
- garlic membranes stretch against neighbors

This creates:
REAL tissue feeling.

---

## 17. ADD STRUCTURAL HIERARCHY

**Current:**
all objects same importance.

**Add:**
macro/mid/micro hierarchy.

Pepper:
- big vacuoles
- medium organelles
- tiny dots

Basil:
- large membranes
- medium chloroplasts
- micro particles

This massively increases realism.

---

## 18. MAKE PARAMETERS PERCEPTUAL

**Never expose:**
- multipliers
- jitter
- cluster ratios

**Expose:**
- softness
- fragmentation
- elongation
- clustering
- tissue density

User thinks biologically.
Engine translates technically.

---

## 19. PREP FOR FUTURE FEATURES

This architecture enables:
- animated microscopy
- zoom transitions
- live morphing
- vector exports
- motion graphics
- print-scale murals
- procedural branding systems

Without rewrites later.

---

## 20. MOST IMPORTANT REFACTOR ORDER

1. display list pipeline
2. organic shape abstraction
3. unified zoom/density
4. shared voronoi engine
5. parameter registry
6. salt rewrite
7. morphology layer system
8. biological field system

This gives maximum impact with minimum breakage.

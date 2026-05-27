/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Parameter Registry — single source of truth for the entire engine.
 *
 * Replaces three previously-scattered sources:
 *  1. PARAMETER_PRESETS in types.ts (defaults + ranges)
 *  2. Hardcoded slider min/max/step in PatternWorkspace.tsx
 *  3. Manual default selection in getCuratedConfigForSeasoning
 *
 * Each parameter has:
 *  - ui metadata (label, unit, format) for slider rendering
 *  - range (min, max, step) shared across all spices
 *  - per-spice defaults (curated calibration from session 6)
 *  - per-spice visibility (which slider shows for which spice)
 *  - semantic notes (engineering reference, kept for future refactor passes)
 *
 * Adding a new spice = add an entry to every `defaults` map.
 * Adding a new param = add a new entry here.
 * No other file should hardcode parameter ranges or defaults.
 */

export type SpiceId = 'sal' | 'louro' | 'alho' | 'pimenta' | 'manjericao' | 'oregano';

export const SPICE_IDS: SpiceId[] = ['sal', 'louro', 'alho', 'pimenta', 'manjericao', 'oregano'];

export type ParamId =
  | 'zoom' | 'density' | 'rotation' | 'lineWidth' | 'voronoiRoundedness'
  // Spice-specific contextual parameters
  | 'faceting' | 'crystalShape'                                  // Sal
  | 'anisotropy'                                                 // Louro
  | 'mitoticActivity'                                            // Alho
  | 'curvature' | 'flowCohesion'                                 // Pimenta
  | 'leavesPerRosette' | 'leafShape' | 'rosetteVariation'        // Manjericão
  | 'clusterSpread' | 'capsuleElongation';                       // Orégano

export interface ParamSpec {
  id: ParamId;
  uiLabel: string;
  uiUnit: string;                            // suffix shown in slider value (e.g. 'x', '°', '%')
  format: (value: number) => string;         // how to render the numeric value in UI
  min: number;
  max: number;
  step: number;
  defaults: Record<SpiceId, number>;         // per-spice default
  visibleFor: Record<SpiceId, boolean>;      // which spices show this slider
  semantic: string;                          // engineering notes
  labelOverride?: Partial<Record<SpiceId, string>>; // optional per-spice rename of uiLabel
}

export const PARAMETERS: Record<ParamId, ParamSpec> = {
  zoom: {
    id: 'zoom',
    uiLabel: 'Magnificação (Zoom)',
    uiUnit: 'x',
    format: (v) => `${Math.round(v)}`,
    min: 40,
    max: 1200,
    step: 1,
    defaults: { sal: 120, louro: 220, alho: 180, pimenta: 340, manjericao: 260, oregano: 140 },
    visibleFor: { sal: true, louro: true, alho: true, pimenta: true, manjericao: true, oregano: true },
    semantic: 'Microscope magnification. Affects ONLY structure size — never count, stroke, or spacing. Log-scaled internally for perceptual smoothness.',
  },
  density: {
    id: 'density',
    uiLabel: 'Densidade do Desenho',
    uiUnit: '',
    format: (v) => `${Math.round(v)}`,
    min: 2,
    max: 40,
    step: 1,
    defaults: { sal: 18, louro: 9, alho: 14, pimenta: 22, manjericao: 16, oregano: 28 },
    visibleFor: { sal: true, louro: true, alho: true, pimenta: true, manjericao: true, oregano: true },
    semantic: 'Average structures visible in viewport. Affects ONLY count — never size or spacing directly.',
  },
  rotation: {
    id: 'rotation',
    uiLabel: 'Inclinação Angular',
    uiUnit: '°',
    format: (v) => `${Math.round(v)}`,
    min: 0,
    max: 180,
    step: 1,
    defaults: { sal: 0, louro: 0, alho: 0, pimenta: 0, manjericao: 0, oregano: 0 },
    // Manjericão's rosettes have per-rosette random rotation — global rotation is meaningless
    visibleFor: { sal: true, louro: true, alho: true, pimenta: true, manjericao: false, oregano: true },
    semantic: 'Internal tissue anisotropy axis (0–180°). For Pimenta this is the wind-flow direction bias.',
    labelOverride: { pimenta: 'Direção do Vento' },
  },
  lineWidth: {
    id: 'lineWidth',
    uiLabel: 'Espessura do Contorno',
    uiUnit: '',
    format: (v) => v.toFixed(1),
    min: 0.5,
    max: 6.0,
    step: 0.1,
    defaults: { sal: 1.6, louro: 2.2, alho: 1.4, pimenta: 1.8, manjericao: 1.5, oregano: 1.3 },
    // Hidden for spices that don't render strokes (pure fill shapes)
    visibleFor: { sal: false, louro: true, alho: true, pimenta: false, manjericao: false, oregano: false },
    semantic: 'Absolute pixel stroke thickness. MUST stay constant across zoom levels and themes — only colors invert.',
  },
  voronoiRoundedness: {
    id: 'voronoiRoundedness',
    uiLabel: 'Arredondamento das Células',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0,
    max: 100,
    step: 1,
    defaults: { sal: 0, louro: 44, alho: 28, pimenta: 52, manjericao: 40, oregano: 35 },
    // Only Voronoi-mesh spices expose this (Pimenta is no longer a Voronoi)
    visibleFor: { sal: false, louro: true, alho: true, pimenta: false, manjericao: false, oregano: false },
    semantic: 'Polygon corner softness (0 = rigid, 100 = fully organic). Applied via cubic ease-in for perceptual smoothness.',
  },

  // ─── Spice-specific contextual parameters ────────────────────────────────

  faceting: {
    id: 'faceting',
    uiLabel: 'Faceting',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 50, louro: 0, alho: 0, pimenta: 0, manjericao: 0, oregano: 0 },
    visibleFor: { sal: true, louro: false, alho: false, pimenta: false, manjericao: false, oregano: false },
    semantic: 'Sal: per-vertex jaggedness multiplier. 0 = perfectly smooth polygon; 100 = heavily fractured edges.',
  },
  crystalShape: {
    id: 'crystalShape',
    uiLabel: 'Forma do Cristal',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 50, louro: 0, alho: 0, pimenta: 0, manjericao: 0, oregano: 0 },
    visibleFor: { sal: true, louro: false, alho: false, pimenta: false, manjericao: false, oregano: false },
    semantic: 'Sal: bias tier distribution. 0 = all 5-sided (cubic); 50 = current 60/25/15 mix; 100 = all 9-sided (octagonal).',
  },
  anisotropy: {
    id: 'anisotropy',
    uiLabel: 'Anisotropia',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 40, alho: 0, pimenta: 0, manjericao: 0, oregano: 0 },
    visibleFor: { sal: false, louro: true, alho: false, pimenta: false, manjericao: false, oregano: false },
    semantic: 'Louro: anisotropic stretch (0 = circular cells; 100 = elongated cells along rotation axis).',
  },
  mitoticActivity: {
    id: 'mitoticActivity',
    uiLabel: 'Atividade Mitótica',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 0, alho: 15, pimenta: 0, manjericao: 0, oregano: 0 },
    visibleFor: { sal: false, louro: false, alho: true, pimenta: false, manjericao: false, oregano: false },
    semantic: 'Alho: telophase probability. 0 = all interphase (single nuclei); 100 = all telophase (dividing pairs).',
  },
  curvature: {
    id: 'curvature',
    uiLabel: 'Curvatura',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 0, alho: 0, pimenta: 50, manjericao: 0, oregano: 0 },
    visibleFor: { sal: false, louro: false, alho: false, pimenta: true, manjericao: false, oregano: false },
    semantic: 'Pimenta: hook intensity of chili swooshes. 0 = straight needles; 100 = strong curved hooks.',
  },
  flowCohesion: {
    id: 'flowCohesion',
    uiLabel: 'Coesão do Fluxo',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 0, alho: 0, pimenta: 30, manjericao: 0, oregano: 0 },
    visibleFor: { sal: false, louro: false, alho: false, pimenta: true, manjericao: false, oregano: false },
    semantic: 'Pimenta: how aligned to the flow field. 0 = chaotic tumbling; 100 = perfectly aligned ranks.',
  },
  leavesPerRosette: {
    id: 'leavesPerRosette',
    uiLabel: 'Folhas por Roseta',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 0, alho: 0, pimenta: 0, manjericao: 50, oregano: 0 },
    visibleFor: { sal: false, louro: false, alho: false, pimenta: false, manjericao: true, oregano: false },
    semantic: 'Manjericão: biases the 4/6/8 leaf-count tier distribution. 0 = all young 4-leaf; 100 = all mature 8-leaf.',
  },
  leafShape: {
    id: 'leafShape',
    uiLabel: 'Forma da Folha',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 0, alho: 0, pimenta: 0, manjericao: 50, oregano: 0 },
    visibleFor: { sal: false, louro: false, alho: false, pimenta: false, manjericao: true, oregano: false },
    semantic: 'Manjericão: leaf width ratio. 0 = thin lanceolate; 50 = current ovate; 100 = wide rounded.',
  },
  rosetteVariation: {
    id: 'rosetteVariation',
    uiLabel: 'Variação por Roseta',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 0, alho: 0, pimenta: 0, manjericao: 30, oregano: 0 },
    visibleFor: { sal: false, louro: false, alho: false, pimenta: false, manjericao: true, oregano: false },
    semantic: 'Manjericão: per-leaf angular jitter within a rosette. 0 = perfectly symmetric; 100 = chaotic asymmetry.',
  },
  clusterSpread: {
    id: 'clusterSpread',
    uiLabel: 'Espalhamento',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 0, alho: 0, pimenta: 0, manjericao: 0, oregano: 50 },
    visibleFor: { sal: false, louro: false, alho: false, pimenta: false, manjericao: false, oregano: true },
    semantic: 'Orégano: spore spread radius. 0 = tightly packed clusters; 100 = wide dispersion across canvas.',
  },
  capsuleElongation: {
    id: 'capsuleElongation',
    uiLabel: 'Alongamento',
    uiUnit: '%',
    format: (v) => `${Math.round(v)}`,
    min: 0, max: 100, step: 1,
    defaults: { sal: 0, louro: 0, alho: 0, pimenta: 0, manjericao: 0, oregano: 50 },
    visibleFor: { sal: false, louro: false, alho: false, pimenta: false, manjericao: false, oregano: true },
    semantic: 'Orégano: capsule aspect ratio. 0 = round dots; 100 = elongated ellipses.',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getParamRange(paramId: ParamId): { min: number; max: number; step: number } {
  const p = PARAMETERS[paramId];
  return { min: p.min, max: p.max, step: p.step };
}

export function getParamDefault(paramId: ParamId, spiceId: SpiceId): number {
  return PARAMETERS[paramId].defaults[spiceId];
}

export function isParamVisibleFor(paramId: ParamId, spiceId: SpiceId): boolean {
  return PARAMETERS[paramId].visibleFor[spiceId];
}

export function getAllDefaultsForSpice(spiceId: SpiceId): Record<ParamId, number> {
  const result = {} as Record<ParamId, number>;
  (Object.keys(PARAMETERS) as ParamId[]).forEach((pid) => {
    result[pid] = PARAMETERS[pid].defaults[spiceId];
  });
  return result;
}

export function formatParamValue(paramId: ParamId, value: number): string {
  const p = PARAMETERS[paramId];
  return `${p.format(value)}${p.uiUnit}`;
}

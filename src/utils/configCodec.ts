/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Config codec — encodes/decodes the full PatternConfig as a compact tag
 * suitable for embedding in export filenames. Only values that DIFFER from
 * the spice's curated default are emitted — so a clean curated export gets
 * just `s42` (seed), while a heavily-tweaked export gets `s42~z340~cu65~ls70`.
 *
 * Format: `<shortKey><value>` tokens separated by `~`.
 * Round-trip: `decodeConfig(encodeConfig(c, spice), spice)` reconstructs c.
 */

import { PatternConfig, ShaderId } from '../types';
import { PARAMETERS, ParamId, SpiceId } from '../engine/parameters';

// Short-key registry for all encoded params.
// `mul` is the multiplier used to convert float → integer (for lineWidth: 10).
interface CodecField {
  short: string;
  pid: ParamId;
  mul: number;
}

const FIELDS: CodecField[] = [
  { short: 'z',  pid: 'zoom',              mul: 1 },
  { short: 'd',  pid: 'density',           mul: 1 },
  { short: 'r',  pid: 'rotation',          mul: 1 },
  { short: 'l',  pid: 'lineWidth',         mul: 10 }, // float, encode ×10
  { short: 'v',  pid: 'voronoiRoundedness',mul: 1 },
  { short: 'fc', pid: 'faceting',          mul: 1 },
  { short: 'cs', pid: 'crystalShape',      mul: 1 },
  { short: 'an', pid: 'anisotropy',        mul: 1 },
  { short: 'mt', pid: 'mitoticActivity',   mul: 1 },
  { short: 'cu', pid: 'curvature',         mul: 1 },
  { short: 'fl', pid: 'flowCohesion',      mul: 1 },
  { short: 'lp', pid: 'leavesPerRosette',  mul: 1 },
  { short: 'ls', pid: 'leafShape',         mul: 1 },
  { short: 'rv', pid: 'rosetteVariation',  mul: 1 },
  { short: 'sp', pid: 'clusterSpread',     mul: 1 },
  { short: 'ce', pid: 'capsuleElongation', mul: 1 },
  { short: 'ra', pid: 'armCount',          mul: 1 },
  { short: 'ga', pid: 'branchCount',       mul: 1 },
  { short: 'eg', pid: 'branchSpacing',     mul: 1 },
  { short: 'pv', pid: 'piecesVariation',   mul: 1 },
  { short: 'pe', pid: 'piecesSpacing',     mul: 1 },
  { short: 'pg', pid: 'piecesRotation',    mul: 1 },
];

const SHADER_SHORT: Record<ShaderId, string> = {
  none: '',
  ascii: 'A',
  halftone: 'H',
};

const SHADER_FROM_SHORT: Record<string, ShaderId> = {
  A: 'ascii',
  H: 'halftone',
};

/**
 * Encode a config into a compact tag string.
 * Only includes deltas from the spice's curated default (except seed, which
 * is always emitted because it has no fixed default).
 */
export function encodeConfig(c: PatternConfig, spiceId: SpiceId): string {
  const tokens: string[] = [];

  // Always emit the seed
  tokens.push(`s${Math.round(c.layoutSeed ?? 1)}`);

  // Emit numeric params that differ from curated default
  for (const f of FIELDS) {
    const val = (c as unknown as Record<string, number | undefined>)[f.pid];
    if (val === undefined) continue;
    const def = PARAMETERS[f.pid].defaults[spiceId];
    const encoded = Math.round(val * f.mul);
    const encodedDef = Math.round(def * f.mul);
    if (encoded !== encodedDef) {
      tokens.push(`${f.short}${encoded}`);
    }
  }

  // Theme override (default is 'light' after polarity fix)
  if (c.themeMode === 'dark') tokens.push('td');

  // Shader (only if not 'none')
  const sh = c.shader ?? 'none';
  if (sh !== 'none') tokens.push(`sh${SHADER_SHORT[sh]}`);

  return tokens.join('~');
}

/**
 * Decode a config tag back into a partial PatternConfig.
 * Tokens not present fall back to curated defaults at the consumer level.
 * Returns null if the tag is malformed.
 */
export function decodeConfig(tag: string, spiceId: SpiceId): Partial<PatternConfig> | null {
  const partial: Partial<PatternConfig> = {};
  if (!tag || typeof tag !== 'string') return null;

  // Build a map from short → field (longest first to avoid prefix collision)
  const sortedFields = [...FIELDS].sort((a, b) => b.short.length - a.short.length);

  let parsed = false;
  for (const rawTok of tag.split('~')) {
    const tok = rawTok.trim();
    if (!tok) continue;

    // Special tokens
    if (tok === 'td') {
      partial.themeMode = 'dark';
      parsed = true;
      continue;
    }
    if (tok.startsWith('sh')) {
      const code = tok.slice(2);
      const sh = SHADER_FROM_SHORT[code];
      if (sh) { partial.shader = sh; parsed = true; }
      continue;
    }
    if (tok.startsWith('s') && /^s\d+$/.test(tok)) {
      partial.layoutSeed = parseInt(tok.slice(1), 10);
      parsed = true;
      continue;
    }

    // Numeric field by short-key match
    let matched: CodecField | undefined;
    for (const f of sortedFields) {
      if (tok.startsWith(f.short) && /^-?\d+(\.\d+)?$/.test(tok.slice(f.short.length))) {
        matched = f;
        break;
      }
    }
    if (matched) {
      const raw = parseFloat(tok.slice(matched.short.length));
      (partial as unknown as Record<string, number>)[matched.pid] = raw / matched.mul;
      parsed = true;
    }
  }

  return parsed ? partial : null;
}

/**
 * Merge a decoded partial config onto a base config (filling unknowns with
 * curated defaults). Used by "Load from tag" UI.
 */
export function applyTagOverlay(
  base: PatternConfig,
  overlay: Partial<PatternConfig>
): PatternConfig {
  return { ...base, ...overlay };
}

// Helper: ensures the spice ID is valid (defensive type narrowing)
export function isSpiceId(s: string): s is SpiceId {
  return s === 'grupo' || s === 'sal' || s === 'louro' || s === 'alho' || s === 'pimenta' || s === 'manjericao' || s === 'oregano' || s === 'alecrim';
}

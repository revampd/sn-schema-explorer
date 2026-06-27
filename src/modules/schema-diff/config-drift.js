/* ============================================================================
 * schema-diff/config-drift.js — config drift as a layer on the Diff (#139)
 * ============================================================================
 *
 * Pairwise config drift between the Diff's base and compare instances, keyed by
 * application scope via the shared entity spine. Pure (no DOM): the inspector and
 * the canvas badge both feed off it.
 *
 * Two hard rules from the design (see memory: layers-opt-in-on-available-data):
 *   1. Config is an OPT-IN enrichment; the schema diff is the baseline. The layer
 *      is `comparable` only when BOTH sides actually exported app metadata. If
 *      either side omits it, there is nothing to compare — never infer findings
 *      from unexported data.
 *   2. Pairwise (base vs compare). N-way drift stays in the Config Data table.
 *
 * Scope→app join covers store + custom apps only (plugins are name-keyed,
 * properties are global) and excludes the global scope (buildAppIndex drops it).
 * ============================================================================ */

import { buildAppIndex, normKey } from '../../core/state.js';
import { classifyAppDrift } from '../config-data/reconcile.js';

const PAIR = [{ id: 'base' }, { id: 'compare' }];

/** Does this instance's export carry a non-empty store/custom app section? */
export function hasAppMetadata(data) {
  const md = data && data._metadata;
  return !!(
    md &&
    ((Array.isArray(md.storeApps) && md.storeApps.length) ||
      (Array.isArray(md.customApps) && md.customApps.length))
  );
}

/**
 * Build a pairwise config-drift resolver for base vs compare instance data.
 *
 *   { comparable, forScope(scope) → { status, app, base, compare } | null }
 *
 * `comparable` is false when either side lacks app metadata (opt-in gate) — in
 * that case `forScope` always returns null and callers render no config UI.
 * `forScope` returns null for the global scope or a scope that owns no app.
 */
export function makeConfigDrift(baseData, compareData) {
  if (!hasAppMetadata(baseData) || !hasAppMetadata(compareData)) {
    return { comparable: false, forScope: () => null };
  }
  const baseIdx = buildAppIndex(baseData);
  const compIdx = buildAppIndex(compareData);
  return {
    comparable: true,
    forScope(scope) {
      const k = normKey(scope);
      if (!k) return null;
      const base = baseIdx.get(k) || null;
      const compare = compIdx.get(k) || null;
      if (!base && !compare) return null; // no owning app — nothing to show
      return {
        status: classifyAppDrift({ base, compare }, PAIR),
        app: base || compare,
        base,
        compare,
      };
    },
  };
}

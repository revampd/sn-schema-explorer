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
import { classifyAppDrift, reconcile } from '../config-data/reconcile.js';

const PAIR = [{ id: 'base' }, { id: 'compare' }];

function zeroCounts() {
  return { sync: 0, drift: 0, missing: 0, active: 0, inactive: 0 };
}

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

/**
 * App-level drift summary for the Diff sidebar (#139b): every store/custom app in
 * base ∪ compare, with its per-side record and drift status, plus counts. Built
 * from `reconcile` (the N-way reconciler restricted to base+compare) so the
 * sidebar agrees with the inspector, the map, and the Config Data table.
 *
 *   { comparable, apps: [{ key, name, section, status, base, compare }], counts }
 *
 * `comparable` follows the same opt-in gate as makeConfigDrift: both sides must
 * carry app metadata, else there is nothing to compare.
 */
export function appDriftSummary(baseData, compareData) {
  if (!hasAppMetadata(baseData) || !hasAppMetadata(compareData)) {
    return { comparable: false, apps: [], counts: zeroCounts() };
  }
  const insts = [
    { id: 'base', label: 'Base', data: baseData },
    { id: 'compare', label: 'Compare', data: compareData },
  ];
  const apps = [];
  for (const section of ['storeApps', 'customApps']) {
    const r = reconcile(section, insts);
    for (const row of r.rows) {
      apps.push({
        key: row.key,
        name: row.name,
        section,
        status: row.status,
        base: row.cells.base || null,
        compare: row.cells.compare || null,
      });
    }
  }
  apps.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const counts = zeroCounts();
  for (const a of apps) if (counts[a.status] !== undefined) counts[a.status]++;
  return { comparable: true, apps, counts };
}

/**
 * Map an app-drift row to the unified change vocabulary (#150) so config findings
 * fold into the same Added / Removed / Changed axis as structural changes — it's
 * one schema+config comparison, not two. Returns null for an in-sync app (no
 * change). An app present on only one side is added/removed by direction; a
 * version/state difference is a change.
 */
export function appChangeCategory(app) {
  if (app.base && !app.compare) return 'removed';
  if (!app.base && app.compare) return 'added';
  if (app.status === 'sync') return null;
  return 'changed';
}

/**
 * The table ids owned by an app, by matching the app's technical scope OR display
 * name against node scopes (nodes carry the display name today; the dual match is
 * future-proof). Used to highlight an app's tables when its sidebar row is picked.
 */
export function tablesForApp(app, nodes) {
  if (!app || !Array.isArray(nodes)) return [];
  const keys = new Set([normKey(app.key), normKey(app.name)].filter(Boolean));
  return nodes.filter(n => keys.has(normKey(n.scope))).map(n => n.id);
}

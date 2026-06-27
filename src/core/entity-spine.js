/* ============================================================================
 * entity-spine.js — shared entity addressing across lenses (#132)
 * ============================================================================
 *
 * The integrated-lenses epic (#130) treats the tools as LENSES over a shared
 * model. For one lens to ask "what do the others know about this entity?", every
 * lens must address entities by the SAME keys. ServiceNow gives us the spine:
 *
 *     application / scope / plugin  →  table  →  field  →  record (table+sys_id)
 *
 * This module owns the cross-lens JOIN between the Structure lens (schema nodes)
 * and the Config lens (store / custom apps). That join key is the application
 * SCOPE — but the two sides spell scope differently in today's exports:
 *
 *   • a schema node carries `scope` = sys_scope.displayValue — a DISPLAY name
 *     (e.g. "Secrets Management").
 *   • an app record carries `scope` = the TECHNICAL scope (e.g. "sn_sm") AND
 *     `name` = the display name.
 *
 * So we index every app under BOTH its technical `scope` and its display `name`
 * (normalised), then resolve a node by its (normalised) `scope` against that
 * index. This works with TODAY's exports via the display-name match, and becomes
 * more robust automatically if nodes later also carry the technical scope
 * (an optional exporter hardening — see CHANGELOG / epic #130).
 *
 * Scope is the ONLY structure↔config bridge available: plugins are name-keyed
 * with no scope, and properties are global — neither links to a table. So the
 * bridge covers store apps + custom apps only. table↔table and field→reference
 * linkage already live in the graph indexes (graph-state.js `_adj` / node.fields)
 * — the spine composes with those rather than duplicating them.
 *
 * Pure module: no DOM, no globals, no rendering. Everything takes explicit
 * inputs so it is fully unit-testable (mirrors instances-state / reconcile).
 * ============================================================================ */

// App sections that carry a scope and therefore link to tables. storeApps are
// listed first so they win key ties — they carry the update-available signal.
const APP_SECTIONS = ['storeApps', 'customApps'];

/** Normalise a scope / name key for case-insensitive matching. */
export function normKey(s) {
  return s == null ? '' : String(s).trim().toLowerCase();
}

/** Is this scope the global (unscoped) one? */
export function isGlobalScope(s) {
  const k = normKey(s);
  return k === '' || k === 'global';
}

/**
 * Structure side: index a loaded graph by scope.
 *   → { tablesByScope: Map<normScope, tableId[]>, scopeOfTable: Map<tableId, normScope> }
 */
export function buildScopeIndex(graphData) {
  const tablesByScope = new Map();
  const scopeOfTable = new Map();
  const nodes = (graphData && graphData.nodes) || [];
  for (const n of nodes) {
    const s = normKey(n.scope);
    scopeOfTable.set(n.id, s);
    if (!tablesByScope.has(s)) tablesByScope.set(s, []);
    tablesByScope.get(s).push(n.id);
  }
  return { tablesByScope, scopeOfTable };
}

/**
 * Config side: index one instance's app records under both their technical
 * `scope` and their display `name` (normalised). storeApps win key ties.
 *   → Map<normKey, appRecord & { _section }>
 */
export function buildAppIndex(data) {
  const byKey = new Map();
  const md = (data && data._metadata) || {};
  for (const section of APP_SECTIONS) {
    const list = Array.isArray(md[section]) ? md[section] : [];
    for (const app of list) {
      const rec = { ...app, _section: section };
      for (const candidate of [app.scope, app.name]) {
        const k = normKey(candidate);
        // Never index under a global key: the global scope is a shared bucket of
        // thousands of platform tables, so a global-scoped app would falsely
        // "own" every global table and light them all up. Global tables have no
        // single owning app.
        if (k && !isGlobalScope(k) && !byKey.has(k)) byKey.set(k, rec);
      }
    }
  }
  return byKey;
}

/**
 * Build a resolver over a graph + a set of instances. Pre-computes the scope
 * index and a per-instance app index once, so per-table lookups during a render
 * pass (#133) are cheap.
 *
 *   graphData — graphState.graphData (or any { nodes } shape)
 *   instances — [{ id, label, data }] (e.g. instancesState.instances)
 *
 * Returns:
 *   tablesByScope, scopeOfTable   — the structure index (see buildScopeIndex)
 *   appsForScope(scope)           — { [instanceId]: appRecord | null }
 *   resolveTable(tableId)         — { id, node, scope, apps }
 *   resolveScope(scope)           — { scope, tables, apps }
 */
export function buildSpine(graphData, instances) {
  const { tablesByScope, scopeOfTable } = buildScopeIndex(graphData);
  const nodes = (graphData && graphData.nodes) || [];
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const appIndexes = (instances || []).map(inst => ({
    id: inst.id,
    label: inst.label,
    idx: buildAppIndex(inst.data),
  }));

  function appsForScope(scope) {
    const k = normKey(scope);
    const out = {};
    for (const e of appIndexes) out[e.id] = (k && e.idx.get(k)) || null;
    return out;
  }

  function resolveTable(tableId) {
    const node = nodeById.get(tableId) || null;
    const scope = node ? normKey(node.scope) : '';
    return { id: tableId, node, scope, apps: appsForScope(scope) };
  }

  function resolveScope(scope) {
    const k = normKey(scope);
    return { scope: k, tables: tablesByScope.get(k) || [], apps: appsForScope(k) };
  }

  return { tablesByScope, scopeOfTable, appsForScope, resolveTable, resolveScope };
}

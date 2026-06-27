/**
 * Advanced-filter evaluation core — extracted from core/advanced-filter.js (#73).
 *
 * DOM-free: the per-node condition evaluator (_evalOne), the AND/OR group
 * matcher (filterOk, memoised), the cascading-candidate helper used by the panel
 * UI (_nodesPassingBefore), and the small derived-state helpers. Reads the
 * graphState/uiState singletons and Settings; no document access — unit-tested
 * in tests/unit/advanced-filter.test.js. The panel-builder UI lives in
 * advanced-filter.js, which re-exports the public names from here.
 */
import { graphState, uiState } from './state.js';
import { Settings } from '../modules/settings/index.js';

// ── Edge-set accessors keyed by the 8 hasEdge condition types ─────────────────

export const EDGE_SETS = {
  'ref-out': gd => gd._refOutIds,
  'ref-in': gd => gd._refInIds,
  'ext-out': gd => gd._extOutIds,
  'ext-in': gd => gd._extInIds,
  m2m: gd => gd._m2mIds,
  rel: gd => gd._relIds,
  view: gd => gd._viewIds,
  // "Has Edge: CMDB CI Topology" = tables that actually have a cmdb_rel topology
  // edge (_cmdbRelIds). This is deliberately NARROWER than the Table Type "CMDB"
  // option, which uses the _cmdbCiIds class hierarchy (every CI class, whether or
  // not it has an explicit topology edge). The two answer different questions.
  cmdb_rel: gd => gd._cmdbRelIds,
};

// ── Cascading helper — nodes passing all conditions BEFORE condIndex ───────────
//
// Returns the set of nodes that would survive applying conditions 0..(condIndex-1)
// as a simple AND chain (ignoring connectors for the purpose of narrowing UI choices).
// This lets later condition UI show only values/options that are actually reachable.

export function _nodesPassingBefore(condIndex) {
  const gd = graphState.graphData;
  if (!gd?.nodes) return [];
  if (condIndex === 0) return gd.nodes;

  const conds = uiState.filterConditions;

  // An OR condition opens a new independent AND-group → always cascade from all nodes,
  // not from the previous group's result set.
  if ((conds[condIndex]?.connector ?? 'AND') === 'OR') return gd.nodes;

  // AND condition: find where the current OR-group begins (the last OR boundary before
  // condIndex, which marks the first condition of this group).
  let groupStart = 0;
  for (let i = 1; i < condIndex; i++) {
    if ((conds[i].connector ?? 'AND') === 'OR') groupStart = i;
  }

  // Apply only the conditions within this OR-group that precede condIndex.
  const priorConds = conds.slice(groupStart, condIndex);
  return gd.nodes.filter(n => priorConds.every(c => _evalOne(c, n)));
}

// ── Single-condition evaluator ────────────────────────────────────────────────

export function _evalOne(c, node) {
  const gd = graphState.graphData;
  switch (c.type) {
    case 'scope':
      return !c.values?.length || c.values.includes(node.scope);

    case 'tableType':
      if (c.value === 'regular') return !node._isView;
      if (c.value === 'views') return !!node._isView;
      if (c.value === 'custom') return Settings.isCustomName(node.id);
      if (c.value === 'cmdb') return !!gd?._cmdbCiIds?.has(node.id); // backward compat
      return true;

    case 'name': {
      if (!c.value?.trim()) return true;
      const term = c.value.trim().toLowerCase();
      const nid = node.id.toLowerCase();
      const nlb = (node.label || '').toLowerCase();
      const op = c.operator ?? 'startsWith';
      if (op === 'is') return nid === term || nlb === term;
      if (op === 'startsWith') return nid.startsWith(term) || nlb.startsWith(term);
      return nid.includes(term) || nlb.includes(term);
    }

    case 'hasField': {
      if (!c.value?.trim()) return true;
      const term = c.value.trim().toLowerCase();
      const op = c.operator ?? 'contains';
      return (node.fields || []).some(f => {
        const fn = (f.name || '').toLowerCase();
        const fl = (f.label || '').toLowerCase();
        if (op === 'is') return fn === term || fl === term;
        if (op === 'startsWith') return fn.startsWith(term) || fl.startsWith(term);
        return fn.includes(term) || fl.includes(term);
      });
    }

    case 'hasEdge':
      return !!EDGE_SETS[c.edgeType]?.(gd)?.has(node.id);

    case 'fieldCount': {
      const fc = node.fields?.length ?? 0;
      if (c.min !== null && c.min !== '' && fc < Number(c.min)) return false;
      if (c.max !== null && c.max !== '' && fc > Number(c.max)) return false;
      return true;
    }

    case 'isCustom':
      return Settings.isCustomName(node.id);

    case 'access':
      // node.access is 'package_private' on cross-scope-restricted tables and
      // null/'' otherwise. "public" therefore means "not package_private" — this
      // matches null public tables, which a literal `=== 'public'` would miss.
      if (c.value === 'package_private') return node.access === 'package_private';
      if (c.value === 'public') return node.access !== 'package_private';
      return true;

    default:
      return true;
  }
}

// ── filterOk — evaluates AND/OR groups with standard precedence ───────────────
//
// Each condition (index ≥ 1) carries a `connector` field: 'AND' (default) or 'OR'.
// OR splits the condition list into AND-groups; a node passes if it satisfies
// ALL conditions in ANY one group.  Example:
//   A  AND  B  OR  C  AND  D  →  (A AND B) OR (C AND D)

// Memoisation: nodes are immutable after load, so a node's filter result only
// changes when the conditions change. We cache the OR/AND partition and the
// per-node verdicts, keyed by a signature of the active conditions. A render
// pass over N nodes with unchanged filters then re-evaluates each node at most
// once; subsequent re-renders (pan/zoom/hop change) hit the cache outright.
const _filterCache = { sig: null, graph: null, groups: null, results: new Map() };

function _partitionGroups(conds) {
  const groups = [];
  let group = [conds[0]];
  for (let i = 1; i < conds.length; i++) {
    if ((conds[i].connector ?? 'AND') === 'OR') {
      groups.push(group);
      group = [];
    }
    group.push(conds[i]);
  }
  groups.push(group);
  return groups;
}

export function filterOk(node) {
  const conds = uiState.filterConditions;
  if (!conds?.length) return true;

  // The condition list is tiny, so stringifying it per call is cheap relative to
  // the substring/array work _evalOne does — and it correctly detects in-place
  // edits that a reference/length check would miss.
  const sig = JSON.stringify(conds);
  if (sig !== _filterCache.sig || graphState.graphData !== _filterCache.graph) {
    _filterCache.sig = sig;
    _filterCache.graph = graphState.graphData;
    _filterCache.groups = _partitionGroups(conds);
    _filterCache.results = new Map();
  }

  const cached = _filterCache.results.get(node.id);
  if (cached !== undefined) return cached;

  // Pass if every condition in any one group is satisfied
  const ok = _filterCache.groups.some(g => g.every(c => _evalOne(c, node)));
  _filterCache.results.set(node.id, ok);
  return ok;
}

// ── Sync selectedScopes (derived) from filterConditions ───────────────────────

export function syncSelectedScopes() {
  const c = uiState.filterConditions.find(x => x.type === 'scope');
  uiState.selectedScopes = new Set(c?.values ?? []);
}

// ── Count active filters ──────────────────────────────────────────────────────

export function countActiveFilters() {
  return uiState.filterConditions.length;
}

// ── Clear all filter conditions ───────────────────────────────────────────────

export function clearAllFilters() {
  uiState.filterConditions = [];
  syncSelectedScopes();
}

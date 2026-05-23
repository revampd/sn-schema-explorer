import { graphState, uiState, diffState } from '../core/state.js';
import { Settings } from '../modules/settings/index.js';

export function computeNeighbourhood({ applyHiddenNodes = true, countOnly = false } = {}) {
  const { nodes, edges } = graphState.graphData;
  const scopeOk = n => uiState.selectedScopes.size === 0 || uiState.selectedScopes.has(n.scope);

  const edgeTypeOk = e =>
    (e.type === 'reference' && (uiState.showRefTo || uiState.showRefFrom)) ||
    (e.type === 'extends'   && uiState.showExt)  ||
    (e.type === 'm2m'       && uiState.showM2M)  ||
    (e.type === 'rel'       && uiState.showRel)  ||
    (e.type === 'view'      && uiState.showView) ||
    (e.type === 'cmdb_rel'  && uiState.showCmdbRel);

  const _adj = graphState.graphData._adj;
  const _nb  = graphState.graphData._nodeById;

  let visNodeIds;
  let reached = new Set();
  let hopDist = {};

  if (uiState.selectedNode) {
    let frontier = new Set([uiState.selectedNode]);
    reached = new Set([uiState.selectedNode]);
    hopDist = { [uiState.selectedNode]: 0 };

    const inheritedSeeds = new Set();
    if (!countOnly && Settings.isEnabled('inheritedRefsCanvas') &&
        Settings.isEnabled('inheritedRefsInspector')) {
      const seen = new Set([uiState.selectedNode]);
      let cur = uiState.selectedNode;
      for (let depth = 0; depth < 20; depth++) {
        const curAdj = _adj ? _adj.get(cur) : null;
        const extEdge = curAdj
          ? curAdj.out.find(e => e.type === 'extends')
          : edges.find(e => (e.source?.id ?? e.source) === cur && e.type === 'extends');
        if (!extEdge) break;
        const parentId = extEdge.target?.id ?? extEdge.target;
        if (!parentId || seen.has(parentId)) break;
        seen.add(parentId);
        inheritedSeeds.add(parentId);
        frontier.add(parentId);
        reached.add(parentId);
        hopDist[parentId] = 0;
        cur = parentId;
      }
    }

    if (_adj) {
      // Fast path: iterate only edges adjacent to frontier nodes — O(Σ degree of frontier)
      for (let hop = 0; hop < uiState.hopDepth; hop++) {
        const next = new Set();
        for (const fid of frontier) {
          const na = _adj.get(fid);
          if (!na) continue;
          for (const e of na.out) {
            if (!edgeTypeOk(e)) continue;
            const t = e.target?.id ?? e.target;
            if (t === fid) continue;
            if (e.type === 'reference') {
              if (uiState.showRefTo   && !reached.has(t)) { next.add(t); hopDist[t] = hop + 1; }
            } else {
              if (!reached.has(t)) { next.add(t); hopDist[t] = hop + 1; }
            }
          }
          for (const e of na.in) {
            if (!edgeTypeOk(e)) continue;
            const s = e.source?.id ?? e.source;
            if (s === fid) continue;
            if (e.type === 'reference') {
              if (uiState.showRefFrom && !reached.has(s)) { next.add(s); hopDist[s] = hop + 1; }
            } else {
              if (!reached.has(s)) { next.add(s); hopDist[s] = hop + 1; }
            }
          }
        }
        next.forEach(id => reached.add(id));
        frontier = next;
      }
    } else {
      // Fallback: scan all edges per hop
      for (let hop = 0; hop < uiState.hopDepth; hop++) {
        const next = new Set();
        edges.forEach(e => {
          if (!edgeTypeOk(e)) return;
          const s = e.source?.id ?? e.source, t = e.target?.id ?? e.target;
          if (s === t) return;
          if (e.type === 'reference') {
            if (uiState.showRefTo   && frontier.has(s) && !reached.has(t)) { next.add(t); hopDist[t] = hop + 1; }
            if (uiState.showRefFrom && frontier.has(t) && !reached.has(s)) { next.add(s); hopDist[s] = hop + 1; }
          } else {
            if (frontier.has(s) && !reached.has(t)) { next.add(t); hopDist[t] = hop + 1; }
            if (frontier.has(t) && !reached.has(s)) { next.add(s); hopDist[s] = hop + 1; }
          }
        });
        next.forEach(id => reached.add(id));
        frontier = next;
      }
    }

    // Reuse the pre-computed global edge count for sorting
    const edgeCnt = graphState.graphData._edgeCnt || {};

    const reachedFiltered = [...reached]
      .filter(id => {
        const n = _nb ? _nb.get(id) : nodes.find(x => x.id === id);
        return n && scopeOk(n);
      })
      .sort((a, b) => {
        if (a === uiState.selectedNode) return -1;
        if (b === uiState.selectedNode) return  1;
        return (edgeCnt[b] || 0) - (edgeCnt[a] || 0);
      });
    const reachedArr = countOnly ? reachedFiltered : reachedFiltered.slice(0, uiState.maxNodes);
    visNodeIds = new Set(reachedArr);
    uiState._lastInheritedSeeds = inheritedSeeds;

    if (!countOnly && uiState.selectedNode) {
      const toAdd = new Set();
      if (_adj) {
        // Fast path: O(|visNodeIds| × avg_degree) instead of O(|visNodeIds| × |edges|)
        for (const id of visNodeIds) {
          const depth = hopDist[id] ?? 0;
          if (depth < 2) continue;
          const na = _adj.get(id) || { out: [], in: [] };
          for (const e of [...na.out, ...na.in]) {
            if (!edgeTypeOk(e)) continue;
            const s = e.source?.id ?? e.source, t = e.target?.id ?? e.target;
            let parentId = null;
            if (t === id && hopDist[s] === depth - 1) {
              // incoming edge s→id: valid ref direction is showRefTo (shallow→deep)
              if (e.type !== 'reference' || uiState.showRefTo) parentId = s;
            } else if (s === id && hopDist[t] === depth - 1) {
              // outgoing edge id→t: valid ref direction is showRefFrom (deep→shallow)
              if (e.type !== 'reference' || uiState.showRefFrom) parentId = t;
            }
            if (parentId && !visNodeIds.has(parentId)) {
              toAdd.add(parentId);
              break;
            }
          }
        }
      } else {
        for (const id of visNodeIds) {
          const depth = hopDist[id] ?? 0;
          if (depth < 2) continue;
          for (const e of edges) {
            if (!edgeTypeOk(e)) continue;
            const s = e.source?.id ?? e.source, t = e.target?.id ?? e.target;
            let parentId = null;
            if (t === id && hopDist[s] === depth - 1) {
              // incoming edge s→id: valid ref direction is showRefTo (shallow→deep)
              if (e.type !== 'reference' || uiState.showRefTo) parentId = s;
            } else if (s === id && hopDist[t] === depth - 1) {
              // outgoing edge id→t: valid ref direction is showRefFrom (deep→shallow)
              if (e.type !== 'reference' || uiState.showRefFrom) parentId = t;
            }
            if (parentId && !visNodeIds.has(parentId)) {
              toAdd.add(parentId);
              break;
            }
          }
        }
      }
      toAdd.forEach(id => visNodeIds.add(id));
    }
  } else {
    const edgeCnt = graphState.graphData._edgeCnt || {};
    const sorted = nodes.filter(scopeOk)
      .sort((a, b) => (edgeCnt[b.id] || 0) - (edgeCnt[a.id] || 0));
    const capped = countOnly ? sorted : sorted.slice(0, uiState.maxNodes);
    visNodeIds = new Set(capped.map(n => n.id));
    uiState._lastInheritedSeeds = new Set();
  }

  if (applyHiddenNodes) {
    uiState.hiddenNodes.forEach(id => visNodeIds.delete(id));
  }

  if (uiState.viewMode === 'diff' && diffState._diffData && !diffState._diffShowAll && !countOnly) {
    const diffIds = new Set([
      ...diffState._diffData.added,
      ...diffState._diffData.removed,
      ...diffState._diffData.changed.keys()
    ]);
    for (const id of visNodeIds) {
      if (!diffIds.has(id) && id !== uiState.selectedNode) visNodeIds.delete(id);
    }
  }

  uiState.connectedNodes = uiState.selectedNode ? reached : new Set(visNodeIds);

  if (countOnly) return { visNodeIds, connectedNodes: uiState.connectedNodes };

  const visEdges = edges.filter(e => {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    if (s === t) return false;
    if (!visNodeIds.has(s) || !visNodeIds.has(t)) return false;
    if (e.type === 'reference') {
      if (!uiState.showRefTo && !uiState.showRefFrom) return false;
    } else {
      if (!(  (e.type === 'extends'  && uiState.showExt) ||
              (e.type === 'm2m'      && uiState.showM2M) ||
              (e.type === 'rel'      && uiState.showRel) ||
              (e.type === 'view'     && uiState.showView) ||
              (e.type === 'cmdb_rel' && uiState.showCmdbRel) )) return false;
    }
    if (!uiState.selectedNode) return true;
    const ds = hopDist[s] ?? Infinity;
    const dt = hopDist[t] ?? Infinity;
    if (e.type === 'reference') {
      if (uiState.showRefTo && uiState.showRefFrom) return Math.abs(ds - dt) === 1;
      if (uiState.showRefTo)   return dt === ds + 1;
      return ds === dt + 1;
    }
    return Math.abs(ds - dt) === 1;
  });

  const edgeKey = e => {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    return `${s}||${t}||${e.type}`;
  };
  const collapsed = new Map();
  for (const e of visEdges) {
    const key = edgeKey(e);
    if (!collapsed.has(key)) {
      collapsed.set(key, { ...e, _count: 1, _fields: e.field ? [e.field] : [],
                                             _fieldLabels: e.label ? [e.label] : [] });
    } else {
      const c = collapsed.get(key);
      c._count++;
      if (e.field)  c._fields.push(e.field);
      if (e.label)  c._fieldLabels.push(e.label);
    }
  }
  const collapsedEdges = [...collapsed.values()];

  return { visNodeIds, connectedNodes: uiState.connectedNodes, visEdges: collapsedEdges };
}

export const Neighbourhood = Object.freeze({ compute: computeNeighbourhood });

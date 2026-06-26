import { SCOPE_PALETTE } from './constants.js';

export const graphState = {
  graphData:    null,
  simulation:   null,
  scopeColorMap:{},
  snInstance:   '',
};

export function buildScopeColorMap(nodes) {
  graphState.scopeColorMap = {};
  graphState.scopeColorMap['global'] = '#0EA5E9';
  let paletteIdx = 0;
  nodes.forEach(n => {
    if (graphState.scopeColorMap[n.scope]) return;
    if (n.scope === 'global') return;
    graphState.scopeColorMap[n.scope] = SCOPE_PALETTE[paletteIdx % SCOPE_PALETTE.length];
    paletteIdx++;
  });
}

export function nodeColor(n) {
  if (n.core) return '#63DF4E';
  return graphState.scopeColorMap[n.scope] ?? '#0EA5E9';
}

// Edge endpoints are ambiguous: D3's forceLink mutates edge.source/target from
// an id string into the resolved node object during simulation. These helpers
// always return the id string regardless of which form the edge is currently in.
export function edgeSourceId(e) {
  return e.source?.id ?? e.source;
}
export function edgeTargetId(e) {
  return e.target?.id ?? e.target;
}

// Build (or rebuild) the per-graph indexes shared by the loader and the diff
// module. Stamps each edge with stable _sourceId/_targetId (so later code never
// has to re-derive them from the D3-mutated source/target), then builds the
// _nodeById lookup and the _adj adjacency map (Map<id, {out, in}>) for
// O(degree) neighbour lookups.
export function buildIndexes(data) {
  for (const e of data.edges) {
    e._sourceId = edgeSourceId(e);
    e._targetId = edgeTargetId(e);
  }
  const nodeById = new Map();
  data.nodes.forEach(n => nodeById.set(n.id, n));
  data._nodeById = nodeById;

  const adj = new Map();
  data.nodes.forEach(n => adj.set(n.id, { out: [], in: [] }));
  for (const e of data.edges) {
    if (adj.has(e._sourceId)) adj.get(e._sourceId).out.push(e);
    if (adj.has(e._targetId)) adj.get(e._targetId).in.push(e);
  }
  data._adj = adj;
}

import { graphState, diffState, buildIndexes } from '../../core/state.js';
import { buildTableList } from '../../core/table-list.js';

// ── Graft helpers ─────────────────────────────────────────────────────────────
//
// Graft / ungraft the compare schema's added nodes+edges into the base graph
// (marked `_diffOnly`) so they render in diff view. Extracted verbatim from
// schema-diff/index.js (#73). Both rebuild the graph indexes and edge counts
// after mutating graphState.graphData, then refresh the sidebar table list.

export function diffGraftAddedIntoBase() {
  if (!diffState._diffData || !graphState.graphData) return;
  for (const id of diffState._diffData.added) {
    const cmpNode = diffState._diffData.compareMap.get(id);
    if (!cmpNode) continue;
    graphState.graphData.nodes.push({ ...cmpNode, _diffOnly: true });
  }
  for (const e of diffState._diffData.allAddedEdges || []) {
    graphState.graphData.edges.push({ ...e, _diffOnly: true });
  }
  buildIndexes(graphState.graphData);
  const _ec = {};
  graphState.graphData.edges.forEach(e => {
    _ec[e._sourceId] = (_ec[e._sourceId] || 0) + 1;
    _ec[e._targetId] = (_ec[e._targetId] || 0) + 1;
  });
  graphState.graphData._edgeCnt = _ec;
  buildTableList();
}

export function diffUngraftAddedFromBase() {
  if (!graphState.graphData) return;
  const hadAny =
    graphState.graphData.nodes.some(n => n._diffOnly) ||
    graphState.graphData.edges.some(e => e._diffOnly);
  if (!hadAny) return;
  graphState.graphData.nodes = graphState.graphData.nodes.filter(n => !n._diffOnly);
  graphState.graphData.edges = graphState.graphData.edges.filter(e => !e._diffOnly);
  // Rebuild _sourceId/_targetId, _nodeById and _adj after edge/node mutations
  // (graft/ungraft), then recompute edge counts from the normalized ids.
  buildIndexes(graphState.graphData);
  const _ec = {};
  graphState.graphData.edges.forEach(e => {
    _ec[e._sourceId] = (_ec[e._sourceId] || 0) + 1;
    _ec[e._targetId] = (_ec[e._targetId] || 0) + 1;
  });
  graphState.graphData._edgeCnt = _ec;
  buildTableList();
}

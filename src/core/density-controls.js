import { graphState, uiState } from './state.js';
import { Dom } from './dom.js';
import { computeNeighbourhood } from './compute.js';
import { filterOk } from './advanced-filter.js';
import { h } from './template.js';

// ── Pure DOM updaters (no render.js import — render.js can import these directly) ──

export function updateDensityInfo() {
  const el = Dom.densityInfo;
  if (!el || !graphState.graphData) return;
  if (uiState.selectedNode) {
    const total = uiState.connectedNodes.size;
    const shown = Math.min(uiState.maxNodes, total);
    if (uiState._lastInheritedSeeds.size > 0) {
      const _dcNb = graphState.graphData._nodeById;
      const ancNames = [...uiState._lastInheritedSeeds]
        .map(
          id =>
            (_dcNb ? _dcNb.get(id) : graphState.graphData.nodes.find(n => n.id === id))?.label || id
        )
        .join(', ');
      const ownTotal = total;
      // Built with h() so schema-derived values (selectedNode, ancNames) become
      // text nodes — never interpreted as HTML.
      el.replaceChildren(
        h(
          'span',
          null,
          'Showing ',
          h('strong', null, shown),
          ' of ',
          h('strong', null, ownTotal),
          ' reachable tables for ',
          h('strong', null, uiState.selectedNode),
          ' ',
          h(
            'span',
            { style: 'opacity:.6;font-style:italic' },
            `(includes inherited from: ${ancNames})`
          ),
          '. Raise Max nodes to see more.'
        )
      );
    } else {
      el.replaceChildren(
        h(
          'span',
          null,
          'Showing ',
          h('strong', null, shown),
          ' of ',
          h('strong', null, total),
          ' neighbours for ',
          h('strong', null, uiState.selectedNode),
          '.'
        )
      );
    }
  } else {
    const scopePassing = graphState.graphData.nodes.filter(filterOk).length;
    const shown = Math.min(uiState.maxNodes, scopePassing);
    el.innerHTML = `Showing <strong>${shown}</strong> of <strong>${scopePassing}</strong> tables (most connected first). Select a table to explore its neighbourhood.`;
  }
}

// ── Hop-depth max computation ─────────────────────────────────────────────────
//
// Replicates compute.js BFS traversal rules exactly:
//   • reference out-edges: traversed forward  only when showRefTo is on
//   • reference  in-edges: traversed backward only when showRefFrom is on
//   • extends / m2m / rel / view / cmdb_rel: bidirectional (both out and in)
//
// Algorithm — hybrid for directed vs bidirectional graphs:
//
//   Step 1  Compute BFS in-degree for every node:
//             forward  (S→T via out-edge, active): T.inDegree++
//             backward (S←T via in-edge,  active): S.inDegree++
//
//   Step 2  Source nodes = BFS in-degree 0 AND has ≥1 active outgoing step.
//           These are the natural "starting corners" of the active subgraph.
//           Example: showRefTo  → tables that no one references (forward sources).
//                    showRefFrom→ tables that reference nothing (backward sources).
//
//   Step 3a Sources found → multi-source BFS from all of them simultaneously.
//           Exact for DAGs (reference chains, mixed ref+extends), O(N+E).
//
//   Step 3b No sources (purely bidirectional, e.g. extends-only, or fully cyclic):
//           Double-BFS diameter approximation — BFS from most-active-degree node
//           to find the periphery, then BFS from there for the true extent.
//           Exact for trees, close approximation for graphs.
//
// Called only on schema load and edge-type filter change — NOT on every render.

function _edgeTypeActive(e, isIncoming) {
  if (e.type === 'reference') return isIncoming ? uiState.showRefFrom : uiState.showRefTo;
  if (e.type === 'extends') return uiState.showExt;
  if (e.type === 'm2m') return uiState.showM2M;
  if (e.type === 'rel') return uiState.showRel;
  if (e.type === 'view') return uiState.showView;
  if (e.type === 'cmdb_rel') return uiState.showCmdbRel;
  return false;
}

function _bfsFromNode(startId, adj) {
  const visited = new Set([startId]);
  let frontier = [startId];
  let depth = 0,
    farthest = startId;
  while (frontier.length > 0) {
    const next = [];
    for (const id of frontier) {
      const { out, in: inc } = adj.get(id) || { out: [], in: [] };
      for (const e of out) {
        const t = e.target?.id ?? e.target;
        if (t !== id && !visited.has(t) && _edgeTypeActive(e, false)) {
          visited.add(t);
          next.push(t);
          farthest = t;
        }
      }
      for (const e of inc) {
        const s = e.source?.id ?? e.source;
        if (s !== id && !visited.has(s) && _edgeTypeActive(e, true)) {
          visited.add(s);
          next.push(s);
          farthest = s;
        }
      }
    }
    if (next.length > 0) depth++;
    frontier = next;
  }
  return { depth, farthest };
}

function _bfsMultiDepth(startIds, adj) {
  const visited = new Set(startIds);
  let frontier = [...startIds];
  let depth = 0;
  while (frontier.length > 0) {
    const next = [];
    for (const id of frontier) {
      const { out, in: inc } = adj.get(id) || { out: [], in: [] };
      for (const e of out) {
        const t = e.target?.id ?? e.target;
        if (t !== id && !visited.has(t) && _edgeTypeActive(e, false)) {
          visited.add(t);
          next.push(t);
        }
      }
      for (const e of inc) {
        const s = e.source?.id ?? e.source;
        if (s !== id && !visited.has(s) && _edgeTypeActive(e, true)) {
          visited.add(s);
          next.push(s);
        }
      }
    }
    if (next.length > 0) depth++;
    frontier = next;
  }
  return depth;
}

function _computeMaxHopDepth() {
  const data = graphState.graphData;
  if (!data) return 5;
  const adj = data._adj;
  if (!adj || adj.size === 0) return 5;

  // When a node is selected: single BFS from it — exact max reachable depth for
  // this specific table under the current active edge types.
  if (uiState.selectedNode && adj.has(uiState.selectedNode)) {
    const { depth } = _bfsFromNode(uiState.selectedNode, adj);
    return Math.max(1, depth);
  }

  // No selection: global computation.
  //
  // Step 1 — BFS in-degree per node (each edge processed once via its out-entry).
  //   forward  (S→T via out, active): T.inDegree++
  //   backward (S←T via in,  active): S.inDegree++
  const inDeg = new Map();
  for (const [id] of adj) inDeg.set(id, 0);
  for (const [, { out }] of adj) {
    for (const e of out) {
      const s = e.source?.id ?? e.source;
      const t = e.target?.id ?? e.target;
      if (_edgeTypeActive(e, false)) inDeg.set(t, (inDeg.get(t) || 0) + 1);
      if (_edgeTypeActive(e, true)) inDeg.set(s, (inDeg.get(s) || 0) + 1);
    }
  }

  // Step 2 — Source nodes: BFS in-degree 0 AND has ≥1 active outgoing step.
  const sources = [];
  for (const [id, deg] of inDeg) {
    if (deg !== 0) continue;
    const { out, in: inc } = adj.get(id) || { out: [], in: [] };
    const active =
      out.some(e => _edgeTypeActive(e, false)) || inc.some(e => _edgeTypeActive(e, true));
    if (active) sources.push(id);
  }

  if (sources.length > 0) {
    // Step 3a — Directed / mixed: multi-source BFS from all source nodes.
    return Math.max(1, _bfsMultiDepth(sources, adj));
  }

  // Step 3b — Purely bidirectional (extends-only, all-cyclic ref, etc.):
  // double-BFS using most-active-degree node as seed.
  let seedId = null,
    maxActiveDeg = -1;
  for (const [id, { out, in: inc }] of adj) {
    let deg = 0;
    for (const e of out) if (_edgeTypeActive(e, false) || _edgeTypeActive(e, true)) deg++;
    for (const e of inc) if (_edgeTypeActive(e, false) || _edgeTypeActive(e, true)) deg++;
    if (deg > maxActiveDeg) {
      maxActiveDeg = deg;
      seedId = id;
    }
  }
  if (!seedId || maxActiveDeg === 0) return 1;
  const { farthest } = _bfsFromNode(seedId, adj);
  const { depth } = _bfsFromNode(farthest, adj);
  return Math.max(1, depth);
}

export function updateHopDepthSlider() {
  if (!graphState.graphData) return;
  const newMax = _computeMaxHopDepth();
  const sl = Dom.slHopDepth;
  sl.max = newMax;
  if (uiState.hopDepth > newMax) {
    uiState.hopDepth = newMax;
    sl.value = newMax;
    Dom.valHopDepth.textContent = newMax;
  }
}

export function updateMaxNodesSlider() {
  if (!graphState.graphData) return;
  const slMax = Dom.slMaxNodes;
  const { visNodeIds: _sliderVis } = computeNeighbourhood({
    applyHiddenNodes: false,
    countOnly: true,
  });
  let filtered = _sliderVis.size;
  filtered = Math.max(1, filtered);
  slMax.max = filtered;
  if (uiState.maxNodes > filtered) {
    uiState.maxNodes = filtered;
    slMax.value = filtered;
    Dom.valMaxNodes.textContent = filtered;
  } else {
    slMax.value = uiState.maxNodes;
  }
}

// ── Event-wiring factory ──────────────────────────────────────────────────────
//
// Accepts an onRender callback so the caller controls when render() fires.
// schema-map/controls.js passes: initDensityControls({ onRender: () => render() })
// Any future view can do the same with its own render function.

export function initDensityControls({ onRender, onCommit }) {
  let _sliderRenderTimer = null;
  const SLIDER_DEBOUNCE_MS = 90;

  function scheduleRender() {
    if (_sliderRenderTimer) clearTimeout(_sliderRenderTimer);
    _sliderRenderTimer = setTimeout(() => {
      _sliderRenderTimer = null;
      onRender();
    }, SLIDER_DEBOUNCE_MS);
  }

  Dom.slMaxNodes.addEventListener('input', function () {
    uiState.maxNodes = +this.value;
    Dom.valMaxNodes.textContent = uiState.maxNodes;
    scheduleRender();
  });
  Dom.slHopDepth.addEventListener('input', function () {
    uiState.hopDepth = +this.value;
    Dom.valHopDepth.textContent = uiState.hopDepth;
    scheduleRender();
  });
  Dom.slMaxNodes.addEventListener('change', function () {
    if (_sliderRenderTimer) {
      clearTimeout(_sliderRenderTimer);
      _sliderRenderTimer = null;
    }
    onRender();
    if (onCommit) onCommit();
  });
  Dom.slHopDepth.addEventListener('change', function () {
    if (_sliderRenderTimer) {
      clearTimeout(_sliderRenderTimer);
      _sliderRenderTimer = null;
    }
    onRender();
    if (onCommit) onCommit();
  });
}

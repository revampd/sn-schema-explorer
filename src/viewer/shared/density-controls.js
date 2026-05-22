import { graphState, uiState } from '../core/state.js';
import { Dom } from '../core/dom.js';
import { computeNeighbourhood } from '../engine/compute.js';

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
        .map(id => (_dcNb ? _dcNb.get(id) : graphState.graphData.nodes.find(n => n.id === id))?.label || id)
        .join(', ');
      const ownTotal = total;
      el.innerHTML = `Showing <strong>${shown}</strong> of <strong>${ownTotal}</strong> reachable tables for <strong>${uiState.selectedNode}</strong> <span style="opacity:.6;font-style:italic">(includes inherited from: ${ancNames})</span>. Raise Max nodes to see more.`;
    } else {
      el.innerHTML = `Showing <strong>${shown}</strong> of <strong>${total}</strong> neighbours for <strong>${uiState.selectedNode}</strong>.`;
    }
  } else {
    const scopePassing = uiState.selectedScopes.size === 0
      ? graphState.graphData.nodes.length
      : graphState.graphData.nodes.filter(n => uiState.selectedScopes.has(n.scope)).length;
    const shown = Math.min(uiState.maxNodes, scopePassing);
    el.innerHTML = `Showing <strong>${shown}</strong> of <strong>${scopePassing}</strong> tables (most connected first). Select a table to explore its neighbourhood.`;
  }
}

export function updateMaxNodesSlider() {
  if (!graphState.graphData) return;
  const slMax = Dom.slMaxNodes;
  const { visNodeIds: _sliderVis } = computeNeighbourhood({ applyHiddenNodes: false, countOnly: true });
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

  Dom.slMaxNodes.addEventListener('input', function() {
    uiState.maxNodes = +this.value;
    Dom.valMaxNodes.textContent = uiState.maxNodes;
    scheduleRender();
  });
  Dom.slHopDepth.addEventListener('input', function() {
    uiState.hopDepth = +this.value;
    Dom.valHopDepth.textContent = uiState.hopDepth;
    scheduleRender();
  });
  Dom.slMaxNodes.addEventListener('change', function() {
    if (_sliderRenderTimer) { clearTimeout(_sliderRenderTimer); _sliderRenderTimer = null; }
    onRender();
    if (onCommit) onCommit();
  });
  Dom.slHopDepth.addEventListener('change', function() {
    if (_sliderRenderTimer) { clearTimeout(_sliderRenderTimer); _sliderRenderTimer = null; }
    onRender();
    if (onCommit) onCommit();
  });
}

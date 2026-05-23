import { graphState, uiState } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { Settings } from '../settings/index.js';
import { render } from '../../engine/render.js';
import { applyTableFilter } from '../search/index.js';
import { fillInspector } from '../../shared/inspector.js';
import { syncLegendRows, LEGEND_TYPE_MAP } from '../graph-view/controls.js';
import { updateMaxNodesSlider, updateHopDepthSlider, initDensityControls } from '../../shared/density-controls.js';
import { pushHistory } from '../history/index.js';

export function applyFilters() {
  if (!graphState.graphData) return;
  // updateMaxNodesSlider before render so uiState.maxNodes is correct when renderGraph runs
  updateMaxNodesSlider();
  render();
  applyTableFilter();
  pushHistory();
}

export function initControlsListeners() {
  // Edge legend toggle — handled here because it triggers render + filter pass
  Dom.edgeLegend.addEventListener('click', e => {
    const row = e.target.closest('.fl-row[data-etype]');
    if (!row) return;
    const def = LEGEND_TYPE_MAP[row.dataset.etype];
    if (!def) return;
    const newVal = !def.get();
    def.set(newVal);
    syncLegendRows();
    updateMaxNodesSlider();
    updateHopDepthSlider();
    render();
    pushHistory();
  });

  // Density sliders — delegated to shared component; render() is the callback
  initDensityControls({ onRender: () => render(), onCommit: () => pushHistory() });

  // Scope filter — delegated to shared component; applyFilters() is the callback
  // (called lazily on first graph load via buildScopeFilter in load/index.js too)

  // Settings-driven re-renders
  uiState.showLabels = Settings.isEnabled('showEdgeLabels');
  uiState.showFields = Settings.isEnabled('expandedFields');
  if (Dom.fieldLegend) Dom.fieldLegend.classList.toggle('visible', uiState.showFields);
  Settings.onChange('showEdgeLabels', v => {
    uiState.showLabels = !!v;
    if (graphState.graphData) { render(); pushHistory(); }
  });
  Settings.onChange('expandedFields', v => {
    uiState.showFields = !!v;
    if (Dom.fieldLegend) Dom.fieldLegend.classList.toggle('visible', uiState.showFields);
    if (graphState.graphData) { render(); pushHistory(); }
  });
  Settings.onChange('dimOnHover', () => {});
  Settings.onChange('customHighlight', () => {
    if (graphState.graphData) render();
    if (graphState.graphData && uiState.selectedNode) {
      const node = graphState.graphData.nodes.find(n => n.id === uiState.selectedNode);
      if (node) fillInspector(node);
    }
  });
  Settings.onChange('inheritedRefsInspector', () => {
    if (graphState.graphData && uiState.selectedNode) {
      const node = graphState.graphData.nodes.find(n => n.id === uiState.selectedNode);
      if (node) fillInspector(node);
    }
  });
  Settings.onChange('inheritedRefsCanvas', () => {
    if (graphState.graphData) { render(); pushHistory(); }
  });
}


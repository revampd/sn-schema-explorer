export { graphState, buildScopeColorMap, nodeColor } from './graph-state.js';
export { uiState } from './ui-state.js';
export { diffState } from './diff-state.js';

import { graphState } from './graph-state.js';
import { uiState } from './ui-state.js';

// ── Serialisation ─────────────────────────────────────────────────────────────

export function serializeState() {
  return JSON.stringify({
    selectedNode:   uiState.selectedNode,
    viewMode:       uiState.viewMode,
    maxNodes:       uiState.maxNodes,
    hopDepth:       uiState.hopDepth,
    sortMode:       uiState.sortMode,
    showRefTo:      uiState.showRefTo,
    showRefFrom:    uiState.showRefFrom,
    showExt:        uiState.showExt,
    showM2M:        uiState.showM2M,
    showRel:        uiState.showRel,
    showView:       uiState.showView,
    showCmdbRel:    uiState.showCmdbRel,
    showLabels:     uiState.showLabels,
    showFields:     uiState.showFields,
    selectedScopes: [...uiState.selectedScopes],
    hiddenNodes:    [...uiState.hiddenNodes],
  });
}

let _restoreCallback = null;

export function setRestoreCallback(fn) { _restoreCallback = fn; }

function _postRestoreCallback(selectedNode) {
  if (_restoreCallback) _restoreCallback(selectedNode);
}

export function restoreState(json) {
  try {
    const s = JSON.parse(json);
    if (s.showRefTo    !== undefined) uiState.showRefTo    = s.showRefTo;
    if (s.showRefFrom  !== undefined) uiState.showRefFrom  = s.showRefFrom;
    if (s.showExt      !== undefined) uiState.showExt      = s.showExt;
    if (s.showM2M      !== undefined) uiState.showM2M      = s.showM2M;
    if (s.showRel      !== undefined) uiState.showRel      = s.showRel;
    if (s.showView     !== undefined) uiState.showView     = s.showView;
    if (s.showCmdbRel  !== undefined) uiState.showCmdbRel  = s.showCmdbRel;
    if (s.showLabels   !== undefined) uiState.showLabels   = s.showLabels;
    if (s.showFields   !== undefined) uiState.showFields   = s.showFields;
    if (s.viewMode     !== undefined) uiState.viewMode     = s.viewMode;
    if (s.maxNodes     !== undefined) uiState.maxNodes     = s.maxNodes;
    if (s.hopDepth     !== undefined) uiState.hopDepth     = s.hopDepth;
    if (s.sortMode     !== undefined) uiState.sortMode     = s.sortMode;
    if (s.selectedScopes) uiState.selectedScopes = new Set(s.selectedScopes);
    uiState.hiddenNodes.clear();
    if (s.hiddenNodes) s.hiddenNodes.forEach(id => uiState.hiddenNodes.add(id));
    _postRestoreCallback(s.selectedNode);
  } catch(e) { console.warn('restoreState failed:', e); }
}

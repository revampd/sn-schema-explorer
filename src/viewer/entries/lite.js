import { setRenderImports } from '../engine/render.js';
import { selectNode, clearSel, fillInspector, clearSelection } from '../shared/inspector.js';
import { initSearchListeners } from '../modules/search/index.js';
import { initExportListeners } from '../modules/export/index.js';
import { initControlsListeners } from '../modules/schema-map/controls.js';
import { syncLegendRows, updateActiveFilter } from '../modules/graph-view/controls.js';
import { initMinimapListeners } from '../modules/graph-view/minimap.js';
import { initIndicatorsListeners } from '../shared/indicators.js';
import { initCanvasUI } from '../shared/canvas-ui.js';
import { showCtx, initInteractionsListeners } from '../modules/schema-map/interactions.js';
import { initLoadOverlay } from '../modules/load/index.js';
import { initModals } from '../core/modals.js';
import { initReferenceInteractivity } from '../modules/reference/index.js';
import {
  initHistoryListeners,
  setHistoryViewModeHook,
  setHistoryClearSelFn,
  pushHistory,
} from '../modules/history/index.js';
import { setViewModeHistoryHook, setViewMode } from '../engine/view-mode.js';

// ── Genuine circular dependencies wired at startup ───────────────────────────
//
// These 6 functions cannot be direct imports in render.js because each of their
// source modules already imports `render` (inspector, graph-view/controls,
// interactions), creating a cycle that esbuild's IIFE live-bindings handle safely
// but only when the calls happen at runtime — never at module evaluation time.
//
// updateDensityInfo and updateMaxNodesSlider moved to shared/density-controls.js
// (no render import there) so render.js can now import them directly.
// updateMinimap is a direct import in render.js from graph-view/minimap.js.
setRenderImports({
  updateActiveFilter,
  syncLegendRows,
  selectNode,
  clearSel,
  fillInspector,
  showCtx,
});

// ── History hooks (no circular imports: history ← these modules, not the reverse) ──
setViewModeHistoryHook(pushHistory);   // view-mode.js calls pushHistory after setViewMode
setHistoryViewModeHook(setViewMode);   // history uses setViewMode to sync DOM during restore
setHistoryClearSelFn(clearSelection);  // history calls clearSelection for null-selection restores

initLoadOverlay();
initSearchListeners();
initExportListeners();
initControlsListeners();
initMinimapListeners();
initIndicatorsListeners();
initCanvasUI();
initInteractionsListeners();
initModals();
initReferenceInteractivity();
initHistoryListeners();

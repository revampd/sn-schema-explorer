/* ============================================================================
 * main.js — the single app entry (collapses the old entries/lite.js + full.js)
 * ============================================================================
 *
 * This module imports the core platform, performs the circular-dependency hook
 * injection (render ↔ inspector/graph-view/interactions, history ↔ view-mode),
 * and runs core init. The self-registering FEATURE modules (path-finder,
 * schema-diff, config-data) are imported *after* this file by the build:
 * build.js synthesizes the esbuild entry as `import 'main.js'` followed by each
 * feature module's `entryImports` (from its module.meta.js), so this file's init
 * runs before the feature modules evaluate — exactly as full.js did.
 * ============================================================================ */
import { setRenderImports } from '../core/render.js';
import { selectNode, clearSel, fillInspector, clearSelection } from '../core/inspector.js';
import { initSearchListeners } from '../modules/search/index.js';
import { initExportListeners } from '../modules/export/index.js';
import { initControlsListeners } from '../modules/schema-map/controls.js';
import { syncLegendRows, updateActiveFilter } from '../modules/graph-view/controls.js';
import { initMinimapListeners } from '../modules/graph-view/minimap.js';
import { initIndicatorsListeners } from '../core/indicators.js';
import { initCanvasUI } from '../core/canvas-ui.js';
import { showCtx, initInteractionsListeners } from '../modules/schema-map/interactions.js';
import { initLanding } from '../modules/landing/index.js';
import { initModals } from '../core/modals.js';
import { initReferenceInteractivity } from '../modules/reference/index.js';
import { initUpdateCheck } from '../core/update-check.js';
import {
  initHistoryListeners,
  setHistoryViewModeHook,
  setHistoryClearSelFn,
  pushHistory,
} from '../modules/history/index.js';
import { setViewModeHistoryHook, setViewMode } from '../core/view-mode.js';
import { initWorkspaces } from '../core/workspace.js';

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
setViewModeHistoryHook(pushHistory); // view-mode.js calls pushHistory after setViewMode
setHistoryViewModeHook(setViewMode); // history uses setViewMode to sync DOM during restore
setHistoryClearSelFn(clearSelection); // history calls clearSelection for null-selection restores

initWorkspaces();
initLanding();
initSearchListeners();
initExportListeners();
initControlsListeners();
initMinimapListeners();
initIndicatorsListeners();
initCanvasUI();
initInteractionsListeners();
initModals();
initReferenceInteractivity();
initUpdateCheck();
initHistoryListeners();

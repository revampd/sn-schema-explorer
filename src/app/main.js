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
import { initUpdateCheck, initAbout } from '../core/update-check.js';
import {
  initHistoryListeners,
  setHistoryViewModeHook,
  setHistoryClearSelFn,
  pushHistory,
} from '../modules/history/index.js';
import { setViewModeHistoryHook, setViewMode, onViewModeChange } from '../core/view-mode.js';
import { initWorkspaces, setWorkspace, getWorkspace } from '../core/workspace.js';
import { uiState, graphState } from '../core/state.js';
import { instancesState, getInstance } from '../core/instances-state.js';
import { selectInstanceForGraph } from '../modules/load/index.js';
import {
  registerSwitcherTool,
  initToolSwitcher,
  refreshToolSwitcher,
} from '../core/tool-switcher.js';
import {
  initHeaderInstance,
  setInstanceSelectHandler,
  refreshHeaderInstance,
} from '../core/header-instance.js';

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

// ── Header tool switcher + instance dropdown ─────────────────────────────────
// The header switcher replaces the old view-mode segment. Schema Map is the
// baseline tool registered here; the feature modules (path-finder, schema-diff,
// config-data) register their own switcher entries when they evaluate. The
// header instance dropdown switches the loaded instance (load wires the handler;
// schema-diff wires the diff-base handler when it evaluates).
const selectedHasSchema = () => {
  const e = instancesState.selectedId && getInstance(instancesState.selectedId);
  return !!(e && e.capabilities && e.capabilities.schema);
};
registerSwitcherTool({
  key: 'schema-map',
  label: 'Schema Map',
  icon: '◎',
  order: 10,
  enabled: selectedHasSchema,
  isActive: () => getWorkspace() === 'schema-explorer' && uiState.viewMode === 'force',
  activate: () => {
    setWorkspace('schema-explorer');
    setViewMode('force');
    // Ensure the selected instance's graph is actually loaded — the switcher can
    // be reached from Config Data, which sets the base without loading the graph.
    // Done after setViewMode so the focus change selectInstanceForGraph fires sees
    // viewMode==='force', letting Schema Diff materialize a comparison selection
    // carried over from Config Data.
    const id = instancesState.selectedId;
    if (id && graphState.graphData !== getInstance(id)?.data) {
      selectInstanceForGraph(id);
    }
  },
});
setInstanceSelectHandler(selectInstanceForGraph);

initWorkspaces();
initLanding();
initToolSwitcher();
initHeaderInstance();
// The header switcher + instance dropdown reflect the active view-mode; wire the
// re-render here so those core modules stay off the view-mode → canvas import chain.
onViewModeChange(() => {
  refreshToolSwitcher();
  refreshHeaderInstance();
});
initSearchListeners();
initExportListeners();
initControlsListeners();
initMinimapListeners();
initIndicatorsListeners();
initCanvasUI();
initInteractionsListeners();
initModals();
initReferenceInteractivity();
initAbout();
initUpdateCheck();
initHistoryListeners();

import { graphState, uiState } from './state.js';
import { root } from './canvas.js';
import { render, updateInstancePill } from './render.js';

const _listeners = []; // (mode, prevMode) => void
const _validators = []; // (mode) => bool — returning false blocks the transition

export function onViewModeChange(fn) {
  _listeners.push(fn);
}
export function registerModeValidator(fn) {
  _validators.push(fn);
}

// Injected by entries/lite.js to avoid a circular import (history → render → …)
let _historyHook = null;
export function setViewModeHistoryHook(fn) {
  _historyHook = fn;
}

export function setViewMode(mode, opts = {}) {
  // #141: Diff is now a LAYER on the Schema Map, not a view-mode. The only modes
  // are the force (map) view and the Path Finder's separate DAG view.
  if (mode !== 'force' && mode !== 'path') return;
  if (!_validators.every(fn => fn(mode))) return;

  const prevMode = uiState.viewMode;

  // Capture current view's node positions into the per-mode cache
  if (graphState.graphData && prevMode === 'force' && prevMode !== mode) {
    const snap = new Map();
    root.selectAll('g.node-group').each(function (d) {
      if (d && d.id && typeof d.x === 'number' && typeof d.y === 'number')
        snap.set(d.id, { x: d.x, y: d.y });
    });
    if (snap.size > 0) uiState._viewPositionCache[prevMode] = snap;
  }

  uiState.viewMode = mode;
  // Stamp the active view on <body> so CSS can react (e.g. the table search bar is
  // hidden in Path Finder, which has its own source/target inputs).
  if (typeof document !== 'undefined') document.body.dataset.view = mode;

  // (The header tool switcher reflects the active mode via its onViewModeChange
  // listener — no segmented control to sync here anymore.)

  // Sync sidebar title
  const titleEl = document.getElementById('sidebar-title');
  if (titleEl) {
    titleEl.textContent = mode === 'path' ? 'Path Finder' : 'Tables';
  }

  // Notify all registered listeners
  _listeners.forEach(fn => fn(mode, prevMode));

  // Restore cached positions for the destination view
  if (graphState.graphData && mode === 'force') {
    const snap = uiState._viewPositionCache[mode];
    if (snap) {
      graphState.graphData.nodes.forEach(n => {
        const pos = snap.get(n.id);
        if (pos) {
          n.x = pos.x;
          n.y = pos.y;
        }
      });
    }
  }

  render();
  updateInstancePill();
  if (opts.historyPush !== false && _historyHook) _historyHook();
}

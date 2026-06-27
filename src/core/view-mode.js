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
  if (mode !== 'force' && mode !== 'path' && mode !== 'diff') return;
  if (!_validators.every(fn => fn(mode))) return;

  const prevMode = uiState.viewMode;

  // Capture current view's node positions into the per-mode cache
  if (graphState.graphData && (prevMode === 'force' || prevMode === 'diff') && prevMode !== mode) {
    const snap = new Map();
    root.selectAll('g.node-group').each(function (d) {
      if (d && d.id && typeof d.x === 'number' && typeof d.y === 'number')
        snap.set(d.id, { x: d.x, y: d.y });
    });
    if (snap.size > 0) uiState._viewPositionCache[prevMode] = snap;
  }

  uiState.viewMode = mode;

  // Sync segmented control active state
  document.querySelectorAll('#view-mode-seg .vms-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.vm === mode);
  });

  // Sync sidebar title
  const titleEl = document.getElementById('sidebar-title');
  if (titleEl) {
    titleEl.textContent =
      mode === 'path' ? 'Path Finder' : mode === 'diff' ? 'Schema Diff' : 'Tables';
  }

  // Notify all registered listeners
  _listeners.forEach(fn => fn(mode, prevMode));

  // Restore cached positions for the destination view
  if (graphState.graphData && (mode === 'force' || mode === 'diff')) {
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

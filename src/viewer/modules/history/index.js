import { serializeState, restoreState, graphState, uiState } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { render } from '../../engine/render.js';
import { updateMaxNodesSlider } from '../../shared/density-controls.js';

// ── Navigation History ────────────────────────────────────────────────────────
//
// Push-at-END model: state is captured *after* a navigation is applied, matching
// browser history behaviour. The stack holds up to MAX serialised uiState snapshots.
// Module-specific state (e.g. diffState fields) is captured via registered hooks.

const MAX = 10;
let _stack = []; // JSON strings — each is serializeState() output + extras
let _ptr = -1; // current position; -1 = empty
let _isRestoring = false;

const _extractors = []; // (snapObj) => void  — add module-specific keys before stringify
const _restorers = []; // (snapObj) => void  — read those keys back during restore

// Cross-module hooks injected from entries/lite.js to avoid circular imports
let _viewModeHook = null; // setViewMode fn
let _clearSelFn = null; // clearSelection fn

export function registerHistoryExtractor(fn) {
  _extractors.push(fn);
}
export function registerHistoryRestorer(fn) {
  _restorers.push(fn);
}
export function setHistoryViewModeHook(fn) {
  _viewModeHook = fn;
}
export function setHistoryClearSelFn(fn) {
  _clearSelFn = fn;
}

// ── Core push / back / forward ────────────────────────────────────────────────

export function pushHistory() {
  if (_isRestoring) return;
  if (!graphState.graphData) return; // nothing loaded yet

  const snap = JSON.parse(serializeState());
  _extractors.forEach(fn => fn(snap));

  // Truncate any forward history (same as browser)
  if (_ptr < _stack.length - 1) _stack = _stack.slice(0, _ptr + 1);

  _stack.push(JSON.stringify(snap));
  if (_stack.length > MAX) {
    _stack.shift();
  } else {
    _ptr++;
  }

  _updateButtons();
}

export function historyBack() {
  if (_ptr <= 0) return;
  _ptr--;
  _doRestore(_stack[_ptr]);
}

export function historyForward() {
  if (_ptr >= _stack.length - 1) return;
  _ptr++;
  _doRestore(_stack[_ptr]);
}

export function resetHistory() {
  _stack = [];
  _ptr = -1;
  _isRestoring = false;
  _updateButtons();
}

// ── Internal restore ──────────────────────────────────────────────────────────

function _doRestore(json) {
  _isRestoring = true;
  const snap = JSON.parse(json);

  // 1. If restoring to a null-selection state, run clearSelection first so its
  //    DOM + slider cleanup happens *before* restoreState overrides maxNodes/scopes.
  //    clearSelection's internal pushHistory call is blocked by _isRestoring.
  if (!snap.selectedNode && _clearSelFn) _clearSelFn();

  // 2. Switch view mode so the DOM (segmented control, sidebar panels) is correct
  //    before focusTable triggers a render.
  if (snap.viewMode && snap.viewMode !== uiState.viewMode && _viewModeHook) {
    _viewModeHook(snap.viewMode, { historyPush: false });
  }

  // 3. Restore all core uiState fields.  For a non-null selectedNode this fires
  //    the registered _restoreCallback (focusTable) which sets selectedNode + renders.
  //    For null, focusTable(null) returns early — handled below.
  restoreState(json);

  // 4. For null-selection restores, focusTable was a no-op (selectedNode not set).
  //    Force a render so scope / filter / hop-depth changes are visible.
  if (!snap.selectedNode) render();

  // 5. Module-specific restorers (e.g. diffState fields)
  _restorers.forEach(fn => fn(snap));

  // 6. Sync density control widgets.
  //    restoreState writes uiState.hopDepth / uiState.maxNodes but never touches the DOM.
  //    updateMaxNodesSlider recomputes the slider ceiling for the restored selection/filters
  //    and sets slMaxNodes.value; we also force the text labels to match.
  Dom.slHopDepth.value = uiState.hopDepth;
  Dom.valHopDepth.textContent = uiState.hopDepth;
  updateMaxNodesSlider();
  Dom.valMaxNodes.textContent = uiState.maxNodes; // updateMaxNodesSlider skips this when not capping

  _isRestoring = false;
  _updateButtons();
}

// ── Button state ──────────────────────────────────────────────────────────────

function _updateButtons() {
  const back = Dom.btnHistBack;
  const fwd = Dom.btnHistFwd;
  if (!back || !fwd) return;
  const canBack = _ptr > 0;
  const canFwd = _ptr < _stack.length - 1;
  back.disabled = !canBack;
  fwd.disabled = !canFwd;
  back.classList.toggle('btn-nav-disabled', !canBack);
  fwd.classList.toggle('btn-nav-disabled', !canFwd);
}

// ── Listener wiring (called once from entries/lite.js) ────────────────────────

export function initHistoryListeners() {
  _updateButtons();

  Dom.btnHistBack?.addEventListener('click', historyBack);
  Dom.btnHistFwd?.addEventListener('click', historyForward);

  document.addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        historyBack();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        historyForward();
      }
    }
  });
}

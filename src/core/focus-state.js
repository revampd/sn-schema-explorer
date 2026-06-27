/* ============================================================================
 * focus-state.js — the shared "focus": what the user is looking at (#131)
 * ============================================================================
 *
 * The integration thesis (epic #130) treats the tools as LENSES over a shared
 * subject, not separate apps. For that, every lens needs one name for "what the
 * user is currently focused on" — and one event to react when it changes.
 *
 * That focus already exists today, but scattered across three singletons with no
 * unifying convention:
 *   • current instance  → instancesState.selectedId
 *   • compare instance  → diffState._compareId   (diff's right-hand side)
 *   • current table     → uiState.selectedNode
 *
 * This module is a THIN FACADE over those singletons — it introduces NO new
 * storage, so nothing migrates and existing reads/writes keep working. It only
 * adds: a single read surface (`focusState`), a single change event
 * (`onFocusChange`), and a notifying `table` setter. It is a LEAF module — it
 * imports the three state singletons (which never import back), so there is no
 * cycle.
 *
 * Focus has two tiers: instance-level (always meaningful) and table-level (only
 * meaningful for lenses that have a table — Schema Map, Path Finder, Schema Diff;
 * Configuration Data is instance-level and ignores `table`).
 * ============================================================================ */

import { instancesState } from './instances-state.js';
import { diffState } from './diff-state.js';
import { uiState } from './ui-state.js';

const _listeners = []; // (snapshot) => void

/**
 * Subscribe to focus changes. The callback receives the current focus snapshot.
 * Returns an unsubscribe function.
 */
export function onFocusChange(fn) {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i !== -1) _listeners.splice(i, 1);
  };
}

/** A plain, point-in-time copy of the focus — safe to pass to listeners. */
export function focusSnapshot() {
  return {
    instanceId: instancesState.selectedId,
    compareId: diffState._compareId,
    table: uiState.selectedNode,
  };
}

/**
 * Notify subscribers that the focus changed. Callers that mutate one of the
 * underlying singletons directly (the existing selection code paths) call this
 * afterwards so the change becomes observable through the facade.
 */
export function notifyFocusChange() {
  const snap = focusSnapshot();
  _listeners.forEach(fn => {
    try {
      fn(snap);
    } catch (e) {
      console.warn('onFocusChange listener failed:', e);
    }
  });
}

/**
 * The read facade. Getters resolve live from the underlying singletons (no
 * caching), so it can never drift from them. The `table` setter writes through
 * to uiState and fires the change event when the value actually changes.
 */
export const focusState = {
  get instanceId() {
    return instancesState.selectedId;
  },
  get table() {
    return uiState.selectedNode;
  },
  set table(id) {
    if (uiState.selectedNode === id) return;
    uiState.selectedNode = id;
    notifyFocusChange();
  },
  get compareId() {
    return diffState._compareId;
  },
  set compareId(id) {
    setCompareId(id);
  },
};

/**
 * The single writer for the comparison instance — the "compare against" side
 * shared by Schema Diff and the config-drift layer (#138). Writes through to
 * diffState and fires the change event when the value actually changes, so any
 * lens reacting to `onFocusChange` re-hydrates against the new comparison.
 */
export function setCompareId(id) {
  const next = id == null ? null : id;
  if (diffState._compareId === next) return;
  diffState._compareId = next;
  notifyFocusChange();
}

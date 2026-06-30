/* ============================================================================
 * core/header-instance.js — header instance dropdown
 * ============================================================================
 * A custom dropdown in the header that shows / switches the currently-loaded
 * instance. In Schema Map / Path Finder it loads the picked instance into the
 * graph; in Schema Diff it sets the Base (and stays in sync with the diff
 * sidebar's Base picker, which reads the same instancesState.selectedId).
 *
 * Handlers are injected to keep core free of feature imports:
 *   setInstanceSelectHandler(fn) — load module wires selectInstanceForGraph
 *   setDiffBaseHandler(fn)       — schema-diff wires its base setter (optional)
 *
 * Visible only in the schema-explorer workspace (the graph tools); hidden on the
 * landing and Configuration Data (which compares across all instances).
 * ============================================================================ */

import { isComparing } from './state.js';
import { instancesState } from './instances-state.js';
import { createDropdown } from './dropdown.js';
import { getWorkspace, onWorkspaceChange } from './workspace.js';

let _dd = null;
let _selectHandler = null;
let _diffBaseHandler = null;
let _configBaseHandler = null;

export function setInstanceSelectHandler(fn) {
  _selectHandler = fn;
}
export function setDiffBaseHandler(fn) {
  _diffBaseHandler = fn;
}
// Configuration Data wires its base setter — the dropdown picks the base column
// there (the same instancesState.selectedId), without loading the graph.
export function setConfigBaseHandler(fn) {
  _configBaseHandler = fn;
}

// Schema-capable instances are the only ones loadable into the graph.
function schemaInstances() {
  return instancesState.instances.filter(e => e.capabilities && e.capabilities.schema);
}

function onPick(id) {
  if (!id) return;
  // In Configuration Data the dropdown sets the base column (no graph load).
  if (getWorkspace() === 'config-data') {
    if (_configBaseHandler) _configBaseHandler(id);
    return;
  }
  // The dropdown switches the BASE instance. If a comparison is active, re-run it
  // against the same compare so the diff layer follows the new base (#141).
  if (isComparing() && _diffBaseHandler) _diffBaseHandler(id);
  else if (_selectHandler) _selectHandler(id);
}

export function renderHeaderInstance() {
  const host = document.getElementById('header-instance');
  if (!host) return;

  // Shown in the graph tools (schema-capable instances) and in Configuration Data
  // (any registered instance can be the base column). Hidden elsewhere (landing).
  const ws = getWorkspace();
  const insts =
    ws === 'config-data'
      ? instancesState.instances
      : ws === 'schema-explorer'
        ? schemaInstances()
        : [];
  const show = insts.length > 0;
  host.style.display = show ? '' : 'none';
  if (!show) return;

  if (!_dd) {
    _dd = createDropdown({
      ariaLabel: 'Loaded instance',
      title: 'Switch the loaded instance',
      onChange: onPick,
    });
  }
  // (Re)attach if the host was replaced (e.g. a re-rendered shell).
  if (_dd.el.parentElement !== host) host.appendChild(_dd.el);
  _dd.setOptions(
    insts.map(e => ({ value: e.id, label: e.label })),
    instancesState.selectedId
  );
}

export const refreshHeaderInstance = renderHeaderInstance;

// View-mode re-render is wired by the app entry (main.js) via onViewModeChange,
// keeping this module off the view-mode → render → canvas (d3) import chain.
export function initHeaderInstance() {
  onWorkspaceChange(() => renderHeaderInstance());
  renderHeaderInstance();
}

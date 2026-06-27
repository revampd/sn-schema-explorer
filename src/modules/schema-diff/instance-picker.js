import { instancesState, diffState } from '../../core/state.js';
import { createDropdown } from '../../core/dropdown.js';
import { refreshHeaderInstance } from '../../core/header-instance.js';

// ── Diff instance picker ──────────────────────────────────────────────────────
//
// Replaces the old compare-file drop zone (file-input.js). Schema Diff now picks
// its Base and Compare from the registered instances (instances-state). Base is
// the instance currently loaded into the graph; Compare is any other
// schema-capable instance. Selecting a Compare runs the diff; clearing it (the
// blank option) removes the comparison. A swap button flips the two sides.
//
// The pickers are custom dropdowns (core/dropdown.js) rather than native
// <select>s so the open option list is app-themed, not OS-native.
//
// loadDiffFromInstances(baseId, compareId) is injected from the diff module (it
// closes over the diff state machinery); this module only owns the two controls
// and keeps them in sync with the registry.

let baseDD = null;
let cmpDD = null;
let onLoad = null;

export function refreshDiffPicker() {
  if (!baseDD || !cmpDD) return;

  const schemaInstances = instancesState.instances.filter(
    e => e.capabilities && e.capabilities.schema
  );
  const baseId = instancesState.selectedId;
  // Drive the compare side from the actual diff state, not the dropdown's own
  // value — during a base switch (e.g. the swap button) the dropdown value is
  // transiently cleared, but diffState._compareId reflects the true comparison.
  const prevCmp = diffState._compareId || '';

  baseDD.setOptions(
    schemaInstances.map(e => ({ value: e.id, label: e.label })),
    baseId
  );

  const cmpStillValid = schemaInstances.some(e => e.id === prevCmp && e.id !== baseId);
  cmpDD.setOptions(
    [
      { value: '', label: '— select compare —' },
      ...schemaInstances.filter(e => e.id !== baseId).map(e => ({ value: e.id, label: e.label })),
    ],
    cmpStillValid ? prevCmp : ''
  );

  const empty = document.getElementById('diff-picker-empty');
  if (empty) empty.style.display = schemaInstances.length < 2 ? '' : 'none';

  const swapBtn = document.getElementById('diff-swap-btn');
  if (swapBtn) swapBtn.disabled = !cmpDD.getValue();

  // Keep the header instance dropdown (which shows the Base in diff view) in sync.
  refreshHeaderInstance();
}

export function initDiffInstancePicker({ loadDiffFromInstances }) {
  const baseMount = document.getElementById('diff-base-mount');
  const cmpMount = document.getElementById('diff-compare-mount');
  if (!baseMount || !cmpMount) return;
  onLoad = loadDiffFromInstances;

  baseDD = createDropdown({
    title: 'The instance loaded into the graph',
    ariaLabel: 'Base instance',
    onChange: () => onLoad(baseDD.getValue(), cmpDD.getValue()),
  });
  cmpDD = createDropdown({
    title: 'Compare against this instance',
    ariaLabel: 'Compare instance',
    // Empty value clears the comparison (handled by loadDiffFromInstances).
    onChange: () => onLoad(baseDD.getValue(), cmpDD.getValue()),
  });
  baseMount.appendChild(baseDD.el);
  cmpMount.appendChild(cmpDD.el);

  const swapBtn = document.getElementById('diff-swap-btn');
  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      const base = baseDD.getValue();
      const cmp = cmpDD.getValue();
      if (!cmp) return; // nothing to swap into the base slot
      onLoad(cmp, base);
    });
  }

  refreshDiffPicker();
}

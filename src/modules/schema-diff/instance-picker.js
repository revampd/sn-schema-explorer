import { instancesState } from '../../core/state.js';

// ── Diff instance picker ──────────────────────────────────────────────────────
//
// Replaces the old compare-file drop zone (file-input.js). Schema Diff now picks
// its Base and Compare from the registered instances (instances-state). Base is
// the instance currently loaded into the graph; Compare is any other
// schema-capable instance. Selecting a Compare runs the diff; clearing it (the
// blank option) removes the comparison.
//
// loadDiffFromInstances(baseId, compareId) is injected from the diff module (it
// closes over the diff state machinery); this module only owns the two <select>
// controls and keeps them in sync with the registry.

function option(value, label, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

export function refreshDiffPicker() {
  const baseSel = document.getElementById('diff-base-select');
  const cmpSel = document.getElementById('diff-compare-select');
  if (!baseSel || !cmpSel) return;

  const schemaInstances = instancesState.instances.filter(
    e => e.capabilities && e.capabilities.schema
  );
  const baseId = instancesState.selectedId;
  const prevCmp = cmpSel.value;

  baseSel.textContent = '';
  schemaInstances.forEach(e => baseSel.appendChild(option(e.id, e.label, e.id === baseId)));

  cmpSel.textContent = '';
  cmpSel.appendChild(option('', '— select compare —', !prevCmp));
  schemaInstances
    .filter(e => e.id !== baseId)
    .forEach(e => cmpSel.appendChild(option(e.id, e.label, e.id === prevCmp)));

  const empty = document.getElementById('diff-picker-empty');
  if (empty) empty.style.display = schemaInstances.length < 2 ? '' : 'none';
}

export function initDiffInstancePicker({ loadDiffFromInstances }) {
  const baseSel = document.getElementById('diff-base-select');
  const cmpSel = document.getElementById('diff-compare-select');
  if (!baseSel || !cmpSel) return;

  baseSel.addEventListener('change', () => {
    loadDiffFromInstances(baseSel.value, cmpSel.value);
  });
  cmpSel.addEventListener('change', () => {
    // Empty value clears the comparison (handled by loadDiffFromInstances).
    loadDiffFromInstances(baseSel.value, cmpSel.value);
  });

  refreshDiffPicker();
}

import { graphState, uiState } from '../../core/state.js';
import { focusTable } from '../../core/inspector.js';
import { setViewMode } from '../../core/view-mode.js';
import { Dom } from '../../core/dom.js';

// ── Reference modal — table-link interactivity ────────────────────────────────
//
// Any <span class="ref-tbl" data-table="TABLE_NAME"> in the reference modal
// gets an "available" class when that table exists in the loaded schema.
// Clicking an available link closes the modal and focuses the table in the map.

export function refreshReferenceTableLinks() {
  const modal = Dom.refModal;
  if (!modal) return;
  modal.querySelectorAll('.ref-tbl[data-table]').forEach(el => {
    const id = el.dataset.table;
    const available = !!graphState.graphData?._nodeById?.has(id);
    el.classList.toggle('available', available);
    el.title = available ? `Navigate to ${id} in schema map ↗` : `${id} — not in current schema`;
  });
}

export function initReferenceInteractivity() {
  // Refresh availability just before the modal becomes visible (capture phase
  // so it runs before modals.js shows the panel).
  Dom.btnRefGuide?.addEventListener('click', refreshReferenceTableLinks, true);

  // Delegate table-link clicks inside the reference modal
  Dom.refModal?.addEventListener('click', e => {
    const tbl = e.target.closest('.ref-tbl');
    if (!tbl || !tbl.classList.contains('available')) return;
    const id = tbl.dataset.table;
    if (!id) return;
    // Close modal, switch to force/schema-map view if needed, focus the table
    Dom.refModal.classList.remove('visible');
    if (uiState.viewMode !== 'force') setViewMode('force', { historyPush: false });
    focusTable(id);
  });
}

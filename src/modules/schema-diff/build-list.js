import { uiState, diffState } from '../../core/state.js';
import { Settings } from '../settings/index.js';
import { Dom } from '../../core/dom.js';
import { h } from '../../core/template.js';
import { getSearchMode } from '../search/index.js';
import { filterOk } from '../../core/advanced-filter.js';
import { clearDiffCursor } from './list-cursor.js';
import { rollupMatrix } from './compute-matrix.js';

// ── diffBuildList ─────────────────────────────────────────────────────────────
//
// Renders the diff sidebar list (Added / Removed / Changed groups, with per-table
// relationship-change subgroups). Extracted verbatim from schema-diff/index.js
// (#73); reads diffState/uiState directly and clears the shared keyboard cursor.

export function diffBuildList() {
  clearDiffCursor();
  const list = document.getElementById('diff-list');
  if (!list) return;
  list.classList.toggle('visible', !!diffState._diffData);
  list.innerHTML = '';
  if (!diffState._diffData) return;

  // #150 — with more than one compare, the pairwise Added/Removed/Changed grouping
  // no longer holds (a table can be added in one instance and changed in another),
  // so render the N-column roll-up: one row per differing table with a per-instance
  // status strip. A single compare keeps the classic grouped list below.
  const matrix = diffState._diffMatrix;
  if (matrix && matrix.length > 1) {
    buildMatrixList(list, matrix);
    return;
  }

  const frag = document.createDocumentFragment();

  function appendEdgeSubgroup(tableId, addedEdges, removedEdges) {
    if (!addedEdges.length && !removedEdges.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'diff-edge-subgroup';
    const hdr = document.createElement('div');
    hdr.className = 'diff-edge-subgroup-header';
    hdr.textContent = 'Relationship changes (' + (addedEdges.length + removedEdges.length) + ')';
    wrap.appendChild(hdr);
    const renderEdges = (edges, sign, signCls) => {
      for (const e of edges) {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        const otherId = s === tableId ? t : s;
        const row = document.createElement('div');
        row.className = 'diff-edge-item';
        row.dataset.id = otherId;
        row.title = otherId;
        // Built with h() so schema-derived edge fields (type, source, target,
        // field) become text nodes — never interpreted as HTML.
        row.append(
          h('span', { class: `diff-edge-sign ${signCls}` }, sign),
          h('span', { class: 'diff-edge-type' }, e.type),
          h(
            'span',
            { class: 'diff-edge-target' },
            `${s} → ${t}${e.field ? ' (' + e.field + ')' : ''}`
          )
        );
        wrap.appendChild(row);
      }
    };
    renderEdges(addedEdges, '+', 'des-added');
    renderEdges(removedEdges, '−', 'des-removed');
    frag.appendChild(wrap);
  }

  function makeGroup(label, items, kind) {
    if (!items.length) return;
    // Apply advanced filter conditions (same predicate as the schema map)
    if (uiState.filterConditions?.length) {
      const nodeMap =
        kind === 'added' ? diffState._diffData.compareMap : diffState._diffData.baseMap;
      items = items.filter(({ id }) => {
        const n = nodeMap?.get(id);
        return !n || filterOk(n);
      });
      if (!items.length) return;
    }
    // Apply header search bar filter (Tbl mode only) when in diff view
    if (Dom.searchBox && getSearchMode() === 'tables') {
      const q = Dom.searchBox.value.toLowerCase().trim();
      if (q) {
        items = items.filter(
          ({ id, nodeLabel }) =>
            id.toLowerCase().includes(q) || (nodeLabel && nodeLabel.toLowerCase().includes(q))
        );
        if (!items.length) return;
      }
    }
    const header = document.createElement('div');
    header.className = 'diff-group-header dgh-' + kind;
    header.textContent = label + ' (' + items.length + ')';
    frag.appendChild(header);
    for (const { id, nodeLabel, count, addedEdges, removedEdges } of items) {
      const item = document.createElement('div');
      item.className = 'diff-item';
      item.dataset.id = id;
      item.dataset.kind = kind;
      if (uiState.selectedNode === id) item.classList.add('selected');
      const pill = document.createElement('div');
      pill.className = `diff-item-pill dp-${kind}`;
      const names = document.createElement('div');
      names.className = 'diff-item-names';
      const lbl = document.createElement('div');
      lbl.className = 'diff-item-label';
      lbl.textContent = nodeLabel || id;
      if (Settings.isEnabled('customHighlight') && Settings.isCustomName(id)) {
        const badge = document.createElement('span');
        badge.className = 'ti-custom-badge';
        badge.textContent = 'custom';
        lbl.appendChild(badge);
      }
      const tid = document.createElement('div');
      tid.className = 'diff-item-id';
      tid.textContent = id;
      names.appendChild(lbl);
      names.appendChild(tid);
      item.appendChild(pill);
      item.appendChild(names);
      if (count !== undefined) {
        const cnt = document.createElement('div');
        cnt.className = 'diff-item-count';
        cnt.textContent = (count > 0 ? '+' : '') + count;
        item.appendChild(cnt);
      }
      frag.appendChild(item);
      if (addedEdges || removedEdges) {
        appendEdgeSubgroup(id, addedEdges || [], removedEdges || []);
      }
    }
  }

  const filter = diffState._diffFilter;

  if (filter === 'all' || filter === 'added') {
    const items = [...diffState._diffData.added].sort().map(id => {
      const n = diffState._diffData.compareMap.get(id);
      return { id, nodeLabel: n?.label || id };
    });
    makeGroup('Added', items, 'added');
  }

  if (filter === 'all' || filter === 'removed') {
    const items = [...diffState._diffData.removed].sort().map(id => {
      const n = diffState._diffData.baseMap.get(id);
      return { id, nodeLabel: n?.label || id };
    });
    makeGroup('Removed', items, 'removed');
  }

  if (filter === 'all' || filter === 'changed') {
    const items = [...diffState._diffData.changed.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, ch]) => {
        const n = diffState._diffData.baseMap.get(id);
        const fieldDelta = ch.addedFields.length - ch.removedFields.length;
        return {
          id,
          nodeLabel: n?.label || id,
          count: fieldDelta,
          addedEdges: ch.addedEdges,
          removedEdges: ch.removedEdges,
        };
      });
    makeGroup('Changed', items, 'changed');
  }

  list.appendChild(frag);
}

// ── N-column roll-up list (#150) ────────────────────────────────────────────────
//
// One row per table that differs in at least one compare, with a per-instance
// status strip (a chip per compare, coloured by that table's status there). The
// row keeps the `.diff-item` shape + `data-id` so the existing click handler and
// keyboard cursor navigate it exactly like the single-compare list.

const STATUS_CHIP = {
  added: 'dic-added',
  removed: 'dic-removed',
  changed: 'dic-changed',
  same: 'dic-same',
  absent: 'dic-absent',
};
// Overall pill colour for the row: changed dominates, then added, then removed.
function overallKind(row) {
  if (row.anyChanged) return 'changed';
  if (row.anyAdded) return 'added';
  if (row.anyRemoved) return 'removed';
  return 'changed';
}

function buildMatrixList(list, matrix) {
  const { tables } = rollupMatrix(matrix);
  const frag = document.createDocumentFragment();

  // Resolve a display label + a node for filtering (base side, else any compare).
  const baseMap = matrix[0].baseMap;
  const nodeFor = id => baseMap.get(id) || matrix.map(m => m.compareMap.get(id)).find(Boolean);

  const filter = diffState._diffFilter;
  const q =
    Dom.searchBox && getSearchMode() === 'tables' ? Dom.searchBox.value.toLowerCase().trim() : '';
  const advanced = uiState.filterConditions?.length;

  let rows = [...tables.entries()].map(([id, info]) => ({ id, ...info, node: nodeFor(id) }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  rows = rows.filter(r => {
    if (filter === 'added' && !r.anyAdded) return false;
    if (filter === 'removed' && !r.anyRemoved) return false;
    if (filter === 'changed' && !r.anyChanged) return false;
    if (advanced && r.node && !filterOk(r.node)) return false;
    if (q) {
      const label = (r.node?.label || '').toLowerCase();
      if (!r.id.toLowerCase().includes(q) && !label.includes(q)) return false;
    }
    return true;
  });

  const header = document.createElement('div');
  header.className = 'diff-group-header dgh-changed';
  header.textContent = 'Differs across instances (' + rows.length + ')';
  frag.appendChild(header);

  for (const r of rows) {
    const item = document.createElement('div');
    item.className = 'diff-item';
    item.dataset.id = r.id;
    item.dataset.kind = overallKind(r);
    if (uiState.selectedNode === r.id) item.classList.add('selected');

    const pill = document.createElement('div');
    pill.className = 'diff-item-pill dp-' + overallKind(r);

    const names = document.createElement('div');
    names.className = 'diff-item-names';
    const lbl = document.createElement('div');
    lbl.className = 'diff-item-label';
    lbl.textContent = r.node?.label || r.id;
    if (Settings.isEnabled('customHighlight') && Settings.isCustomName(r.id)) {
      const badge = document.createElement('span');
      badge.className = 'ti-custom-badge';
      badge.textContent = 'custom';
      lbl.appendChild(badge);
    }
    const tid = document.createElement('div');
    tid.className = 'diff-item-id';
    tid.textContent = r.id;
    names.append(lbl, tid);

    // Per-instance status strip: one chip per compare, in matrix order.
    const strip = document.createElement('div');
    strip.className = 'diff-item-cols';
    for (const diff of matrix) {
      const st = r.statuses.get(diff._compareId) || 'same';
      const chip = document.createElement('span');
      chip.className = 'dic-chip ' + (STATUS_CHIP[st] || 'dic-same');
      chip.title = (diff._compareLabel || diff._compareId) + ': ' + st;
      strip.appendChild(chip);
    }

    item.append(pill, names, strip);
    frag.appendChild(item);
  }

  list.appendChild(frag);
}

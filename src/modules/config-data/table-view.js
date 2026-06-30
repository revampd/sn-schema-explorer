/* ============================================================================
 * config-data/table-view.js — N-column comparison table (pure DOM)
 * ============================================================================
 * Builds the comparison table from a reconcile() result. No D3; uses core
 * template h(). One column per loaded instance, plus Name / Key / Status.
 * ============================================================================ */

import { h } from '../../core/template.js';
import { SECTION_CONFIG, STATUS_LABELS } from './reconcile.js';

// ── Column resize ─────────────────────────────────────────────────────────────

function initResizableColumns(table) {
  const ths = Array.from(table.querySelectorAll('thead th'));

  ths.forEach(th => {
    const handle = document.createElement('div');
    handle.className = 'cd-col-resize';
    th.appendChild(handle);

    let startX, startW;
    handle.addEventListener('dragstart', e => e.stopPropagation());
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      startX = e.clientX;
      startW = th.offsetWidth;
      handle.setPointerCapture(e.pointerId);

      function onMove(e) {
        th.style.width = Math.max(60, startW + e.clientX - startX) + 'px';
      }
      function onUp() {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  });
}

function buildColgroup(colCount) {
  // Percentage-based widths so the table always fills 100% of the container.
  // NAME: 30%, STATUS: 8%, remaining split evenly among other columns (key + instances).
  const namePct   = 30;
  const statusPct = 8;
  const otherCount = colCount - 2; // exclude name + status
  const otherPct  = Math.floor((100 - namePct - statusPct) / Math.max(1, otherCount));
  // Give any rounding remainder to the last "other" col
  const lastOtherPct = 100 - namePct - statusPct - otherPct * (otherCount - 1);

  const colgroup = document.createElement('colgroup');
  const addCol = pct => {
    const col = document.createElement('col');
    col.style.width = pct + '%';
    colgroup.appendChild(col);
  };

  addCol(namePct);
  for (let i = 0; i < otherCount - 1; i++) addCol(otherPct);
  if (otherCount > 0) addCol(lastOtherPct);
  addCol(statusPct);
  return colgroup;
}

const STATUS_PILL = {
  sync: 'pill-on',
  drift: 'pill-warn',
  missing: 'pill-err',
  active: 'pill-info',
  inactive: 'pill-muted',
};

function dateShort(s) {
  return String(s || '')
    .trim()
    .split(/[ T]/)[0];
}

// Build one instance's cell for a row, shaped by the section's fields.
function instanceCell(rec, cfg, showDates) {
  if (!rec) return h('td', { class: 'cd-miss' }, '—');

  const children = [];

  if (cfg.fields.includes('active')) {
    const state = rec.active === true ? 'on' : rec.active === false ? 'off' : 'unk';
    children.push(h('span', { class: 'cd-dot cd-dot-' + state }));
  }

  if (cfg.fields.includes('version')) {
    children.push(h('span', { class: 'cd-ver' }, rec.version || '—'));
  } else if (cfg.fields.includes('value')) {
    // properties: show the value (or a redacted/none marker). The cell is
    // ellipsis-truncated in CSS, so carry the full value on a title for hover.
    const v = rec.value == null ? '«no value»' : String(rec.value);
    children.push(h('span', { class: 'cd-val', title: v }, v));
  }

  // Store-app "update available" signal.
  if (cfg.fields.includes('updateAvailable')) {
    if (rec.updateAvailable === true) {
      const txt =
        rec.latestVersion && rec.latestVersion !== rec.version
          ? '↑ ' + rec.latestVersion
          : '↑ update';
      children.push(h('span', { class: 'cd-update', title: 'update_available' }, txt));
    } else if (rec.latestVersion && rec.latestVersion !== rec.version) {
      children.push(
        h(
          'span',
          { class: 'cd-update', title: 'latest_version ahead of installed' },
          '↑ ' + rec.latestVersion
        )
      );
    }
  }

  if (showDates && (rec.installDate || rec.updateDate)) {
    const parts = [];
    if (rec.installDate) parts.push('inst ' + dateShort(rec.installDate));
    if (rec.updateDate) parts.push('upd ' + dateShort(rec.updateDate));
    children.push(h('div', { class: 'cd-dates' }, parts.join(' · ')));
  }

  return h('td', {}, ...children);
}

function passesFilter(row, filter) {
  if (filter === 'all') return true;
  if (filter === 'diff') return row.status !== 'sync';
  return row.status === filter;
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

function sortRows(rows, sort, loaded) {
  const { col, dir } = sort;
  const mul = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    let av, bv;
    if (col === 'name') { av = a.name; bv = b.name; }
    else if (col === 'key') { av = a.key; bv = b.key; }
    else if (col === 'status') { av = a.status; bv = b.status; }
    else {
      // instance column — sort by version/value text
      const inst = loaded.find(i => i.id === col);
      const ra = inst && a.cells[inst.id];
      const rb = inst && b.cells[inst.id];
      av = ra ? (ra.version || ra.value || '') : '';
      bv = rb ? (rb.version || rb.value || '') : '';
    }
    return String(av || '').localeCompare(String(bv || '')) * mul;
  });
}

// ── Column reorder drag ───────────────────────────────────────────────────────

function initColReorder(table, instIds, onReorder) {
  const ths = Array.from(table.querySelectorAll('thead th'));
  // Only instance columns are reorderable (skip name, key, status).
  // We identify them by data-inst-id set below.
  let dragIdx = null;

  ths.forEach((th, i) => {
    if (!th.dataset.instId) return;
    th.draggable = true;

    th.addEventListener('dragstart', e => {
      dragIdx = i;
      e.dataTransfer.effectAllowed = 'move';
      th.classList.add('cd-col-dragging');
    });
    th.addEventListener('dragend', () => {
      dragIdx = null;
      ths.forEach(t => t.classList.remove('cd-col-dragging', 'cd-col-dragover'));
    });
    th.addEventListener('dragover', e => {
      if (dragIdx === null || dragIdx === i) return;
      e.preventDefault();
      ths.forEach(t => t.classList.remove('cd-col-dragover'));
      th.classList.add('cd-col-dragover');
    });
    th.addEventListener('dragleave', () => th.classList.remove('cd-col-dragover'));
    th.addEventListener('drop', e => {
      e.preventDefault();
      th.classList.remove('cd-col-dragover');
      if (dragIdx === null || dragIdx === i) return;
      // Build new order from instIds
      const instThs = ths.filter(t => t.dataset.instId);
      const fromInst = ths[dragIdx].dataset.instId;
      const toInst = th.dataset.instId;
      const newOrder = instIds.slice();
      const fi = newOrder.indexOf(fromInst);
      const ti = newOrder.indexOf(toInst);
      if (fi < 0 || ti < 0) return;
      newOrder.splice(fi, 1);
      newOrder.splice(ti, 0, fromInst);
      onReorder(newOrder);
    });
  });
}

/**
 * Render the comparison <table> for a reconcile() result.
 * @returns {HTMLTableElement}
 */
export function renderComparisonTable(
  result,
  {
    search = '',
    filter = 'all',
    showDates = false,
    sort = { col: 'name', dir: 'asc' },
    colOrder = null,
    onSort = null,
    onReorder = null,
  } = {}
) {
  const cfg = SECTION_CONFIG[result.section];
  const q = search.trim().toLowerCase();

  // Apply column order — colOrder is an array of instance ids.
  const naturalOrder = result.instances;
  let loaded = naturalOrder;
  if (colOrder && colOrder.length) {
    const byId = new Map(naturalOrder.map(i => [i.id, i]));
    const ordered = colOrder.map(id => byId.get(id)).filter(Boolean);
    // append any instances not in colOrder (safety net)
    naturalOrder.forEach(i => { if (!ordered.includes(i)) ordered.push(i); });
    loaded = ordered;
  }

  // Key column: hidden when cfg.showKey is false, or when key === name (properties).
  const showKey = cfg.showKey !== false && cfg.key !== cfg.name;

  // Sort indicator arrow
  function sortArrow(col) {
    if (sort.col !== col) return h('span', { class: 'cd-sort-arrow cd-sort-none' }, '⇅');
    return h('span', { class: 'cd-sort-arrow' }, sort.dir === 'asc' ? '↑' : '↓');
  }

  function makeSortHandler(col) {
    if (!onSort) return {};
    return {
      onClick: () => {
        const dir = sort.col === col && sort.dir === 'asc' ? 'desc' : 'asc';
        onSort(col, dir);
      },
    };
  }

  const headCells = [
    h('th', { class: 'cd-th-sortable', ...makeSortHandler('name') }, 'Name', sortArrow('name')),
  ];
  if (showKey) headCells.push(
    h('th', { class: 'cd-th-sortable', ...makeSortHandler('key') }, 'Key', sortArrow('key'))
  );
  loaded.forEach(i => {
    const th = h(
      'th',
      { class: 'cd-th-sortable cd-th-inst', 'data-inst-id': i.id, ...makeSortHandler(i.id) },
      i.label,
      sortArrow(i.id)
    );
    headCells.push(th);
  });
  headCells.push(
    h('th', { class: 'cd-th-sortable', ...makeSortHandler('status') }, 'Status', sortArrow('status'))
  );

  const filtered = result.rows.filter(
    r =>
      passesFilter(r, filter) &&
      (!q || r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q))
  );
  const sorted = sortRows(filtered, sort, loaded);

  const bodyRows = sorted.map(r =>
    h(
      'tr',
      {},
      h('td', { class: 'cd-name', title: r.name }, r.name),
      ...(showKey ? [h('td', { class: 'cd-key', title: r.key }, r.key)] : []),
      ...loaded.map(i => instanceCell(r.cells[i.id], cfg, showDates)),
      h(
        'td',
        {},
        h(
          'span',
          { class: 'pill-badge ' + (STATUS_PILL[r.status] || 'pill-muted') },
          STATUS_LABELS[r.status] || r.status
        )
      )
    )
  );

  const colCount = headCells.length;
  const table = h(
    'table',
    { id: 'cd-table', class: 'cd-table' },
    h('thead', {}, h('tr', {}, ...headCells)),
    h('tbody', {}, ...bodyRows)
  );

  requestAnimationFrame(() => {
    initResizableColumns(table);
    if (onReorder) initColReorder(table, loaded.map(i => i.id), onReorder);
  });

  return table;
}

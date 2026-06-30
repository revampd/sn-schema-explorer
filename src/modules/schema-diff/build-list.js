import { uiState, diffState, instancesState, getInstance } from '../../core/state.js';
import { Settings } from '../settings/index.js';
import { Dom } from '../../core/dom.js';
import { h } from '../../core/template.js';
import { getSearchMode } from '../search/index.js';
import { filterOk } from '../../core/advanced-filter.js';
import { clearDiffCursor } from './list-cursor.js';
import { rollupMatrix } from './compute-matrix.js';
import { appDriftSummary, appChangeCategory } from './config-drift.js';
import { STATUS_LABELS } from '../config-data/reconcile.js';

// ── diffBuildList ─────────────────────────────────────────────────────────────
//
// The single unified "Differences" report (#150 / #149): one list mixing
// structural table changes and application config-drift, each row type-tagged
// (table | app), under ONE change vocabulary — Added / Removed / Changed. Config
// findings fold into that axis (drift/state → changed, app gone → removed, app
// new → added); it's one schema+config comparison, not two. The single filter
// (`diffState._diffFilter`) is 'all' | 'added' | 'removed' | 'changed' and spans
// both tables and apps.

function typeTag(kind) {
  const tag = document.createElement('span');
  tag.className = 'diff-type-tag dtt-' + kind;
  tag.textContent = kind;
  return tag;
}

// A collapsible group: a header (caret + label + count) over a body holding the
// rows. Collapsed state is keyed by `groupKey` in diffState._collapsedGroups and
// toggled by the delegated header click handler (schema-diff/index.js). Returns
// the body element to append rows into.
function makeCollapsibleGroup(frag, groupKey, label, count, kind) {
  const collapsed = diffState._collapsedGroups?.includes(groupKey);
  const group = document.createElement('div');
  group.className = 'diff-group' + (collapsed ? ' collapsed' : '');
  group.dataset.group = groupKey;

  const header = document.createElement('div');
  header.className = 'diff-group-header dgh-' + kind;
  header.dataset.group = groupKey;
  const caret = document.createElement('span');
  caret.className = 'diff-group-caret';
  caret.textContent = '▾';
  header.append(caret, document.createTextNode(label + ' (' + count + ')'));
  group.appendChild(header);

  const body = document.createElement('div');
  body.className = 'diff-group-body';
  group.appendChild(body);

  frag.appendChild(group);
  return body;
}

function typeIncluded(kind) {
  // kind: 'app' | 'table'. Missing entry defaults to included.
  return diffState._diffTypes?.[kind] !== false;
}

export function diffBuildList() {
  clearDiffCursor();
  const list = document.getElementById('diff-list');
  if (!list) return;
  list.classList.toggle('visible', !!diffState._diffData);
  list.innerHTML = '';
  if (!diffState._diffData) return;

  const frag = document.createDocumentFragment();
  const filter = diffState._diffFilter;

  // Config-drift app rows first (few, high-value), then the table changes — both
  // obey the same Added/Removed/Changed filter, and each row TYPE can be hidden
  // via the report's type filter (diffState._diffTypes).
  if (typeIncluded('app')) appendAppRows(frag, filter);
  if (typeIncluded('table')) {
    const matrix = diffState._diffMatrix;
    if (matrix && matrix.length > 1) appendMatrixRows(frag, matrix, filter);
    else appendGroupedRows(frag, filter);
  }

  list.appendChild(frag);
}

// ── Config-drift app rows ───────────────────────────────────────────────────────

function appendAppRows(frag, filter) {
  const baseData = getInstance(instancesState.selectedId)?.data;
  const compareData = getInstance(diffState._compareId)?.data;
  const summary = appDriftSummary(baseData, compareData);
  if (!summary.comparable) return;

  // Fold each app into the Added/Removed/Changed vocabulary; in-sync apps (null)
  // are not changes. The active filter ('all' or a category) gates them.
  const visible = summary.apps
    .map(a => ({ a, cat: appChangeCategory(a) }))
    .filter(({ cat }) => cat && (filter === 'all' || filter === cat));
  if (!visible.length) return;

  const body = makeCollapsibleGroup(frag, 'config', 'Configuration', visible.length, 'config');

  for (const { a } of visible) {
    const item = document.createElement('div');
    item.className = 'diff-item dci-' + a.status;
    item.dataset.kind = 'app';
    item.dataset.key = a.key;
    item.dataset.name = a.name;
    if (diffState._activeConfigApp?.key === a.key) item.classList.add('selected');

    const pill = document.createElement('div');
    pill.className = 'diff-item-pill dcp-' + a.status;

    const names = document.createElement('div');
    names.className = 'diff-item-names';
    const lbl = document.createElement('div');
    lbl.className = 'diff-item-label';
    lbl.append(typeTag('app'), document.createTextNode(a.name));
    const ver = document.createElement('div');
    ver.className = 'diff-item-id';
    ver.textContent = 'v' + (a.base?.version ?? '—') + ' → v' + (a.compare?.version ?? '—');
    names.append(lbl, ver);

    const status = document.createElement('div');
    status.className = 'dci-status';
    status.textContent = STATUS_LABELS[a.status] || a.status;

    item.append(pill, names, status);
    body.appendChild(item);
  }
}

// ── Table change rows ───────────────────────────────────────────────────────────

// Shared header-search / advanced-filter gate for a table row.
function tablePasses(id, nodeLabel, node) {
  if (uiState.filterConditions?.length && node && !filterOk(node)) return false;
  if (Dom.searchBox && getSearchMode() === 'tables') {
    const q = Dom.searchBox.value.toLowerCase().trim();
    if (q && !id.toLowerCase().includes(q) && !(nodeLabel || '').toLowerCase().includes(q)) {
      return false;
    }
  }
  return true;
}

function tableRow(id, nodeLabel, kind, { count, statuses, matrix } = {}) {
  const item = document.createElement('div');
  item.className = 'diff-item';
  item.dataset.id = id;
  item.dataset.kind = kind;
  if (uiState.selectedNode === id) item.classList.add('selected');

  const pill = document.createElement('div');
  pill.className = 'diff-item-pill dp-' + kind;

  const names = document.createElement('div');
  names.className = 'diff-item-names';
  const lbl = document.createElement('div');
  lbl.className = 'diff-item-label';
  lbl.appendChild(typeTag('table'));
  lbl.append(document.createTextNode(nodeLabel || id));
  if (Settings.isEnabled('customHighlight') && Settings.isCustomName(id)) {
    const badge = document.createElement('span');
    badge.className = 'ti-custom-badge';
    badge.textContent = 'custom';
    lbl.appendChild(badge);
  }
  const tid = document.createElement('div');
  tid.className = 'diff-item-id';
  tid.textContent = id;
  names.append(lbl, tid);
  item.append(pill, names);

  // Per-instance status strip (N-column roll-up).
  if (statuses && matrix) {
    const strip = document.createElement('div');
    strip.className = 'diff-item-cols';
    for (const diff of matrix) {
      const st = statuses.get(diff._compareId) || 'same';
      const chip = document.createElement('span');
      chip.className = 'dic-chip ' + (DIC_CHIP[st] || 'dic-same');
      chip.title = (diff._compareLabel || diff._compareId) + ': ' + st;
      strip.appendChild(chip);
    }
    item.appendChild(strip);
  } else if (count !== undefined) {
    const cnt = document.createElement('div');
    cnt.className = 'diff-item-count';
    cnt.textContent = (count > 0 ? '+' : '') + count;
    item.appendChild(cnt);
  }
  return item;
}

// Single-compare: classic Added / Removed / Changed groups (with edge subgroups).
function appendGroupedRows(frag, filter) {
  const d = diffState._diffData;

  function appendEdgeSubgroup(host, tableId, addedEdges, removedEdges) {
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
    host.appendChild(wrap);
  }

  function makeGroup(label, items, kind) {
    items = items.filter(it => tablePasses(it.id, it.nodeLabel, it.node));
    if (!items.length) return;
    const body = makeCollapsibleGroup(frag, kind, label, items.length, kind);
    for (const it of items) {
      body.appendChild(tableRow(it.id, it.nodeLabel, kind, { count: it.count }));
      if (it.addedEdges || it.removedEdges) {
        appendEdgeSubgroup(body, it.id, it.addedEdges || [], it.removedEdges || []);
      }
    }
  }

  if (filter === 'all' || filter === 'added') {
    makeGroup(
      'Added',
      [...d.added].sort().map(id => {
        const n = d.compareMap.get(id);
        return { id, nodeLabel: n?.label || id, node: n };
      }),
      'added'
    );
  }
  if (filter === 'all' || filter === 'removed') {
    makeGroup(
      'Removed',
      [...d.removed].sort().map(id => {
        const n = d.baseMap.get(id);
        return { id, nodeLabel: n?.label || id, node: n };
      }),
      'removed'
    );
  }
  if (filter === 'all' || filter === 'changed') {
    makeGroup(
      'Changed',
      [...d.changed.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, ch]) => {
          const n = d.baseMap.get(id);
          return {
            id,
            nodeLabel: n?.label || id,
            node: n,
            count: ch.addedFields.length - ch.removedFields.length,
            addedEdges: ch.addedEdges,
            removedEdges: ch.removedEdges,
          };
        }),
      'changed'
    );
  }
}

// N-column roll-up: one row per table differing in ≥1 compare, with a per-instance
// status strip. Row keeps the .diff-item shape + data-id for navigation/keyboard.
const DIC_CHIP = {
  added: 'dic-added',
  removed: 'dic-removed',
  changed: 'dic-changed',
  same: 'dic-same',
  absent: 'dic-absent',
};
function overallKind(info) {
  if (info.anyChanged) return 'changed';
  if (info.anyAdded) return 'added';
  if (info.anyRemoved) return 'removed';
  return 'changed';
}

function appendMatrixRows(frag, matrix, filter) {
  const { tables } = rollupMatrix(matrix);
  const baseMap = matrix[0].baseMap;
  const nodeFor = id => baseMap.get(id) || matrix.map(m => m.compareMap.get(id)).find(Boolean);

  let rows = [...tables.entries()].map(([id, info]) => ({ id, ...info, node: nodeFor(id) }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  rows = rows.filter(r => {
    if (filter === 'added' && !r.anyAdded) return false;
    if (filter === 'removed' && !r.anyRemoved) return false;
    if (filter === 'changed' && !r.anyChanged) return false;
    return tablePasses(r.id, r.node?.label, r.node);
  });

  const body = makeCollapsibleGroup(
    frag,
    'matrix',
    'Differs across instances',
    rows.length,
    'changed'
  );

  for (const r of rows) {
    body.appendChild(
      tableRow(r.id, r.node?.label, overallKind(r), { statuses: r.statuses, matrix })
    );
  }
}

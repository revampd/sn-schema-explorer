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
// The single unified "Differences" report (#150 / #149): one list mixing
// structural table changes and application config-drift, each row type-tagged
// (table | app), under ONE change vocabulary — Added / Removed / Changed. Config
// findings fold into that axis (drift/state → changed, app gone → removed, app
// new → added); it's one schema+config comparison, not two. The single filter
// (`diffState._diffFilter`) is 'all' | 'added' | 'removed' | 'changed' and spans
// both tables and apps.
//
// Large-diff DOM bound (#perf): the list renders a DOM row per table with no
// virtualization, so very large comparisons (tens of thousands of tables) build
// huge DOM trees. Two limits keep it bounded: a group whose size exceeds
// GROUP_COLLAPSE_THRESHOLD starts collapsed (its rows aren't built until the
// user expands it — the header click rebuilds the list), and an expanded group
// renders at most GROUP_ROW_CAP rows, with a "+N more" footer pointing at search
// /filter to narrow further.
export const GROUP_COLLAPSE_THRESHOLD = 200;
export const GROUP_ROW_CAP = 200;

// Which groups should start collapsed for the current diff (those above the
// threshold). Keyed the same way as diffState._collapsedGroups / makeGroup.
export function defaultCollapsedGroups() {
  const out = [];
  const matrix = diffState._diffMatrix;
  if (matrix && matrix.length > 1) {
    const { tables } = rollupMatrix(matrix);
    if (tables.size > GROUP_COLLAPSE_THRESHOLD) out.push('matrix');
    return out;
  }
  const d = diffState._diffData;
  if (!d) return out;
  if (d.added.size > GROUP_COLLAPSE_THRESHOLD) out.push('added');
  if (d.removed.size > GROUP_COLLAPSE_THRESHOLD) out.push('removed');
  if (d.changed.size > GROUP_COLLAPSE_THRESHOLD) out.push('changed');
  return out;
}

// A "+N more" footer appended when a group is capped — guides the user to narrow
// the list rather than silently hiding rows.
function appendMoreFooter(body, hidden) {
  const more = document.createElement('div');
  more.className = 'diff-group-more';
  more.textContent = `+ ${hidden.toLocaleString()} more — refine with search or filter`;
  body.appendChild(more);
}

function typeTag(kind) {
  const tag = document.createElement('span');
  tag.className = 'diff-type-tag dtt-' + kind;
  tag.textContent = kind;
  return tag;
}

// The element-type kinds a single changed-table entry touches (#4): 'fields' for
// any field add/remove/retype, plus the edge `type` of each added/removed edge
// ('reference' | 'extends' | 'm2m' | 'rel' | 'view' | 'cmdb_rel').
function changedTypes(ch) {
  const t = new Set();
  if (ch.addedFields?.length || ch.removedFields?.length || ch.changedFields?.length) {
    t.add('fields');
  }
  for (const e of [...(ch.addedEdges || []), ...(ch.removedEdges || [])]) t.add(e.type);
  return t;
}

// Does a changed table pass the active element-type slice? null = no slice (all);
// otherwise the table's touched kinds must intersect the selected kinds.
function elementPasses(types) {
  const sel = diffState._diffElementFilter;
  if (!sel) return true;
  for (const t of types) if (sel.includes(t)) return true;
  return false;
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

export function diffBuildList() {
  clearDiffCursor();
  const list = document.getElementById('diff-list');
  if (!list) return;
  list.classList.toggle('visible', !!diffState._diffData);
  list.innerHTML = '';
  if (!diffState._diffData) return;

  const frag = document.createDocumentFragment();
  const filter = diffState._diffFilter;

  // Structural table changes only. Configuration drift lives in the Inspector
  // (the Configuration section for the selected table) and the Config Data table,
  // not in this report — the rows added no navigational value here.
  const matrix = diffState._diffMatrix;
  if (matrix && matrix.length > 1) appendMatrixRows(frag, matrix, filter);
  else appendGroupedRows(frag, filter);

  list.appendChild(frag);
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

  function appendEdgeSubgroup(host, tableId, addedEdges, removedEdges, kind) {
    if (!addedEdges.length && !removedEdges.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'diff-edge-subgroup';
    const hdr = document.createElement('div');
    hdr.className = 'diff-edge-subgroup-header';
    const n = addedEdges.length + removedEdges.length;
    // For a whole-table add/remove the edges aren't "changes" — they're the
    // table's relationships appearing/disappearing wholesale.
    const noun = kind === 'changed' ? 'Relationship changes' : 'Relationships';
    hdr.textContent = `${noun} (${n})`;
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
    // Collapsed groups don't build their rows — they're rebuilt when the user
    // expands (the header click triggers diffBuildList). Keeps the DOM bounded.
    if (diffState._collapsedGroups?.includes(kind)) return;
    const shown = items.length > GROUP_ROW_CAP ? items.slice(0, GROUP_ROW_CAP) : items;
    for (const it of shown) {
      body.appendChild(tableRow(it.id, it.nodeLabel, kind, { count: it.count }));
      if (it.addedEdges || it.removedEdges) {
        appendEdgeSubgroup(body, it.id, it.addedEdges || [], it.removedEdges || [], kind);
      }
    }
    if (items.length > GROUP_ROW_CAP) appendMoreFooter(body, items.length - GROUP_ROW_CAP);
  }

  if (filter === 'all' || filter === 'added') {
    makeGroup(
      'Added',
      [...d.added]
        .sort()
        // #4 — the Kind slice spans Added too: keep a new table only if the kinds
        // it touches (its fields + the relationships it owns) match the selection.
        .filter(id => elementPasses(addedTableTypes(d, id)))
        .map(id => {
          const n = d.compareMap.get(id);
          // A new table's own relationships (it as the edge owner) ride along with
          // the table — surface them as sub-rows, like a changed table's edges.
          const addedEdges = d.tableEdges?.get(id)?.addedEdges || [];
          return { id, nodeLabel: n?.label || id, node: n, addedEdges };
        }),
      'added'
    );
  }
  if (filter === 'all' || filter === 'removed') {
    makeGroup(
      'Removed',
      [...d.removed]
        .sort()
        .filter(id => elementPasses(removedTableTypes(d, id)))
        .map(id => {
          const n = d.baseMap.get(id);
          // Symmetric: the relationships that vanished with the removed table.
          const removedEdges = d.tableEdges?.get(id)?.removedEdges || [];
          return { id, nodeLabel: n?.label || id, node: n, removedEdges };
        }),
      'removed'
    );
  }
  if (filter === 'all' || filter === 'changed') {
    makeGroup(
      'Changed',
      [...d.changed.entries()]
        .filter(([, ch]) => elementPasses(changedTypes(ch))) // #4 element-type slice
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

  // Union of the element-type kinds a table's change touches across all compares.
  const matrixChangedTypes = id => {
    const t = new Set();
    for (const diff of matrix) {
      const ch = diff.changed.get(id);
      if (ch) for (const x of changedTypes(ch)) t.add(x);
    }
    return t;
  };

  let rows = [...tables.entries()].map(([id, info]) => ({ id, ...info, node: nodeFor(id) }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  rows = rows.filter(r => {
    if (filter === 'added' && !r.anyAdded) return false;
    if (filter === 'removed' && !r.anyRemoved) return false;
    if (filter === 'changed' && !r.anyChanged) return false;
    // #4 element-type slice — only narrows the CHANGED aspect; whole-table
    // added/removed rows are unaffected (like the single-compare groups).
    if (diffState._diffElementFilter && r.anyChanged && !r.anyAdded && !r.anyRemoved) {
      if (!elementPasses(matrixChangedTypes(r.id))) return false;
    }
    return tablePasses(r.id, r.node?.label, r.node);
  });

  const body = makeCollapsibleGroup(
    frag,
    'matrix',
    'Differs across instances',
    rows.length,
    'changed'
  );
  if (diffState._collapsedGroups?.includes('matrix')) return;

  const shown = rows.length > GROUP_ROW_CAP ? rows.slice(0, GROUP_ROW_CAP) : rows;
  for (const r of shown) {
    body.appendChild(
      tableRow(r.id, r.node?.label, overallKind(r), { statuses: r.statuses, matrix })
    );
  }
  if (rows.length > GROUP_ROW_CAP) appendMoreFooter(body, rows.length - GROUP_ROW_CAP);
}

// The element kinds a whole-table add/remove "touches": 'fields' if the table
// carries any fields, plus the edge `type` of each relationship it owns. Used to
// extend the Kind slice to the Added/Removed groups (which list relationships).
function tableElementTypes(node, edges) {
  const t = new Set();
  if (node?.fields?.length) t.add('fields');
  for (const e of edges || []) t.add(e.type);
  return t;
}
function addedTableTypes(d, id) {
  return tableElementTypes(d.compareMap.get(id), d.tableEdges?.get(id)?.addedEdges);
}
function removedTableTypes(d, id) {
  return tableElementTypes(d.baseMap.get(id), d.tableEdges?.get(id)?.removedEdges);
}

// The element kinds actually present in the current comparison — so the Kind
// dropdown only offers kinds that can affect the visible list. In single-compare
// mode this spans Added/Removed/Changed (all list relationships); in N-way mode
// only Changed is sliceable (the matrix list has no relationship sub-rows yet).
// Memoized by the active diff reference (matrix array or single _diffData) — it
// only changes when a new comparison is computed, but it's read on every summary
// refresh, and the scan is O(n + e) over the whole diff.
let _presentCache = { key: null, val: new Set() };
export function presentElementTypes() {
  const matrix = diffState._diffMatrix;
  const key = matrix && matrix.length > 1 ? matrix : diffState._diffData;
  if (key && _presentCache.key === key) return _presentCache.val;
  const t = new Set();
  if (matrix && matrix.length > 1) {
    for (const diff of matrix)
      for (const ch of diff.changed.values()) for (const x of changedTypes(ch)) t.add(x);
  } else if (key) {
    const d = diffState._diffData;
    for (const ch of d.changed.values()) for (const x of changedTypes(ch)) t.add(x);
    for (const id of d.added) for (const x of addedTableTypes(d, id)) t.add(x);
    for (const id of d.removed) for (const x of removedTableTypes(d, id)) t.add(x);
  }
  _presentCache = { key, val: t };
  return t;
}

// The summary counts under the active Kind slice. Returns null when no slice is
// active (caller keeps the raw counts). Each field is null when that category
// isn't sliced (N-way Added/Removed), else the count of rows passing the slice —
// mirroring the list filtering so the badges match the visible rows.
export function filteredDiffCounts() {
  if (!diffState._diffElementFilter) return null;
  const matrix = diffState._diffMatrix;
  if (matrix && matrix.length > 1) {
    const { tables } = rollupMatrix(matrix);
    const kindsFor = id => {
      const t = new Set();
      for (const diff of matrix) {
        const ch = diff.changed.get(id);
        if (ch) for (const x of changedTypes(ch)) t.add(x);
      }
      return t;
    };
    let c = 0;
    for (const [id, info] of tables.entries()) {
      if (!info.anyChanged) continue;
      if (info.anyAdded || info.anyRemoved || elementPasses(kindsFor(id))) c++;
    }
    // Added/Removed aren't sliced in N-way mode (no relationship rows there).
    return { added: null, removed: null, changed: c };
  }
  const d = diffState._diffData;
  if (!d) return { added: 0, removed: 0, changed: 0 };
  let a = 0;
  let r = 0;
  let c = 0;
  for (const id of d.added) if (elementPasses(addedTableTypes(d, id))) a++;
  for (const id of d.removed) if (elementPasses(removedTableTypes(d, id))) r++;
  for (const ch of d.changed.values()) if (elementPasses(changedTypes(ch))) c++;
  return { added: a, removed: r, changed: c };
}

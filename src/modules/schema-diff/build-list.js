import { uiState, diffState } from '../../core/state.js';
import { Settings } from '../settings/index.js';
import { Dom } from '../../core/dom.js';
import { h } from '../../core/template.js';
import { getSearchMode } from '../search/index.js';
import { filterOk } from '../../core/advanced-filter.js';
import { clearDiffCursor } from './list-cursor.js';

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

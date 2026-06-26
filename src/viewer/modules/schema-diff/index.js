import { graphState, uiState, diffState, buildIndexes } from '../../core/state.js';
import { Config } from '../../core/constants.js';
import { Settings } from '../settings/index.js';
import { Dom } from '../../core/dom.js';
import { render, updateInstancePill, addRenderHook } from '../../engine/render.js';
import { root } from '../../engine/canvas.js';
import {
  fillInspector,
  focusTable,
  clearSelection,
  setFillInspectorHook,
} from '../../shared/inspector.js';
import { buildTableList } from '../../shared/table-list.js';
import { syncSidebarForMode } from '../../shared/sidebar-sync.js';
import { setViewMode, onViewModeChange, registerModeValidator } from '../../engine/view-mode.js';
import { h } from '../../core/template.js';
import {
  registerHistoryExtractor,
  registerHistoryRestorer,
  pushHistory,
} from '../history/index.js';
import { injectCiRelEdges } from '../load/index.js';
import { computeDiff } from './compute-diff.js';
import { onSearchChange, getSearchMode } from '../search/index.js';
import { onFilterChange, filterOk } from '../../core/advanced-filter.js';
import { diffFillInspector } from './inspector-diff.js';
import { initDiffFileInput } from './file-input.js';

// ── Settings registration ─────────────────────────────────────────────────────

Settings.registerFeature({
  key: 'schemaDiff',
  label: 'Schema Diff',
  description:
    'Adds a Diff view mode that compares the loaded schema against a second JSON export. Shows added, removed, and changed tables (with field-level detail) highlighted on the graph and listed in the sidebar.',
  default: false,
  category: 'features',
});

// ── History hooks — capture / restore diff-specific state ─────────────────────

registerHistoryExtractor(snap => {
  snap._diffShowAll = diffState._diffShowAll;
  snap._diffFilter = diffState._diffFilter;
});

registerHistoryRestorer(snap => {
  if (snap._diffShowAll !== undefined) diffState._diffShowAll = snap._diffShowAll;
  if (snap._diffFilter !== undefined) diffState._diffFilter = snap._diffFilter;
  // Sync diff sidebar UI if diff view is active
  if (uiState.viewMode === 'diff') {
    diffUpdateSummary();
    diffBuildList();
  }
});

// ── Graft helpers ─────────────────────────────────────────────────────────────

function diffGraftAddedIntoBase() {
  if (!diffState._diffData || !graphState.graphData) return;
  for (const id of diffState._diffData.added) {
    const cmpNode = diffState._diffData.compareMap.get(id);
    if (!cmpNode) continue;
    graphState.graphData.nodes.push({ ...cmpNode, _diffOnly: true });
  }
  for (const e of diffState._diffData.allAddedEdges || []) {
    graphState.graphData.edges.push({ ...e, _diffOnly: true });
  }
  buildIndexes(graphState.graphData);
  const _ec = {};
  graphState.graphData.edges.forEach(e => {
    _ec[e._sourceId] = (_ec[e._sourceId] || 0) + 1;
    _ec[e._targetId] = (_ec[e._targetId] || 0) + 1;
  });
  graphState.graphData._edgeCnt = _ec;
  buildTableList();
}

function diffUngraftAddedFromBase() {
  if (!graphState.graphData) return;
  const hadAny =
    graphState.graphData.nodes.some(n => n._diffOnly) ||
    graphState.graphData.edges.some(e => e._diffOnly);
  if (!hadAny) return;
  graphState.graphData.nodes = graphState.graphData.nodes.filter(n => !n._diffOnly);
  graphState.graphData.edges = graphState.graphData.edges.filter(e => !e._diffOnly);
  // Rebuild _sourceId/_targetId, _nodeById and _adj after edge/node mutations
  // (graft/ungraft), then recompute edge counts from the normalized ids.
  buildIndexes(graphState.graphData);
  const _ec = {};
  graphState.graphData.edges.forEach(e => {
    _ec[e._sourceId] = (_ec[e._sourceId] || 0) + 1;
    _ec[e._targetId] = (_ec[e._targetId] || 0) + 1;
  });
  graphState.graphData._edgeCnt = _ec;
  buildTableList();
}

// ── loadDiffSchema ────────────────────────────────────────────────────────────

function loadDiffSchema(compareData) {
  if (!graphState.graphData) return;
  // Inject _ciRelationships as cmdb_rel edges into the compare schema so that
  // computeDiff sees the same edge representation on both sides. Without this,
  // the compare schema has 0 cmdb_rel edges (they live in _ciRelationships, not
  // edges[]) while the base schema has them injected by loadGraph — producing
  // ~90+ false "changed" tables, all driven by missing cmdb_rel edges.
  injectCiRelEdges(compareData);
  diffUngraftAddedFromBase();
  diffState._diffData = computeDiff(graphState.graphData, compareData);
  diffState._diffData._compareInstance = compareData._instance || null;
  diffState._diffData._compareStats = compareData._stats || null;
  diffState._diffData._compareCapabilities = compareData._capabilities || null;
  diffState._diffData._compareBuild = compareData._build || null;
  diffState._diffData._compareVersion = compareData._schema_version || null;
  diffState._diffShowAll = false;
  diffState._diffFilter = 'all';
  diffState._diffSearch = '';
  const searchInput = document.getElementById('diff-search-input');
  const searchClear = document.getElementById('diff-search-clear');
  if (searchInput) searchInput.value = '';
  if (searchClear) searchClear.style.display = 'none';
  uiState._viewPositionCache.diff = null;
  diffGraftAddedIntoBase();
  diffUpdateSummary();
  diffBuildList();
  updateInstancePill();

  // Export method mismatch disclaimer
  const baseMode = graphState.graphData._instance?.export_mode || null;
  const compareMode = compareData._instance?.export_mode || null;
  const modeWarnEl = document.getElementById('diff-mode-warn');
  if (modeWarnEl) {
    if (baseMode && compareMode && baseMode !== compareMode) {
      const aclNote =
        baseMode === 'table-api' || compareMode === 'table-api'
          ? '<span class="dmw-acl-note">Table API exports may be missing tables or fields ' +
            'from privately-scoped apps due to cross-scope ACL restrictions — ' +
            'these gaps are expected.</span>'
          : '';
      modeWarnEl.innerHTML =
        '<span class="dmw-icon">⚠</span>' +
        '<span class="dmw-text">Export method mismatch — schema contents may differ.' +
        (aclNote ? '<br>' + aclNote : '') +
        '<br><span class="dmw-modes">Base: <em>' +
        baseMode +
        '</em>' +
        ' · Compare: <em>' +
        compareMode +
        '</em></span></span>';
      modeWarnEl.style.display = '';
    } else {
      modeWarnEl.style.display = 'none';
    }
  }

  render();
}

// ── Visibility sync ───────────────────────────────────────────────────────────

function diffSyncVisibility() {
  const enabled = Settings.isEnabled('schemaDiff');
  const segBtn = document.getElementById('vms-diff');
  if (segBtn) segBtn.style.display = enabled ? '' : 'none';
  if (!enabled && uiState.viewMode === 'diff') {
    setViewMode('force', { historyPush: false });
  }
}

// ── Sidebar sync ──────────────────────────────────────────────────────────────

function diffSyncSidebar() {
  if (!document.getElementById('diff-sidebar')) return;
  syncSidebarForMode();
  if (uiState.viewMode === 'diff') {
    diffUpdateSummary();
    diffBuildList();
  }
}

// ── Summary + list ────────────────────────────────────────────────────────────

function diffUpdateSummary() {
  const summary = document.getElementById('diff-summary');
  const toggleRow = document.getElementById('diff-toggle-row');
  const nAdded = document.getElementById('diff-n-added');
  const nRemoved = document.getElementById('diff-n-removed');
  const nChanged = document.getElementById('diff-n-changed');
  const showAllBtn = document.getElementById('diff-show-all-btn');
  if (!summary) return;
  const hasDiff = !!diffState._diffData;
  summary.classList.toggle('visible', hasDiff);
  if (toggleRow) toggleRow.classList.toggle('visible', hasDiff);
  const searchWrap = document.getElementById('diff-search-wrap');
  if (searchWrap) searchWrap.style.display = hasDiff ? '' : 'none';
  if (!hasDiff) return;
  if (nAdded) nAdded.textContent = diffState._diffData.added.size;
  if (nRemoved) nRemoved.textContent = diffState._diffData.removed.size;
  if (nChanged) nChanged.textContent = diffState._diffData.changed.size;
  if (showAllBtn) {
    showAllBtn.classList.toggle('active', diffState._diffShowAll);
    showAllBtn.textContent = diffState._diffShowAll ? 'Changed only' : 'Show all';
  }
  ['added', 'removed', 'changed'].forEach(k => {
    const el = document.getElementById('diff-stat-' + k);
    if (el) el.classList.toggle('active', diffState._diffFilter === k);
  });
}

// ── Keyboard cursor ───────────────────────────────────────────────────────────

let _diffCursor = -1;

function _diffGetItems() {
  return [...document.querySelectorAll('#diff-list .diff-item')];
}

function _diffMoveCursor(delta) {
  const items = _diffGetItems();
  if (!items.length) return;
  if (_diffCursor >= 0 && _diffCursor < items.length) {
    items[_diffCursor].classList.remove('diff-item--focused');
  }
  _diffCursor = Math.max(
    0,
    Math.min(
      items.length - 1,
      _diffCursor < 0 ? (delta > 0 ? 0 : items.length - 1) : _diffCursor + delta
    )
  );
  items[_diffCursor].classList.add('diff-item--focused');
  items[_diffCursor].scrollIntoView({ block: 'nearest' });
}

function _diffClearCursor() {
  _diffGetItems().forEach(el => el.classList.remove('diff-item--focused'));
  _diffCursor = -1;
}

// ── diffBuildList ─────────────────────────────────────────────────────────────

function diffBuildList() {
  _diffClearCursor();
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
    // Apply inline sidebar filter (diff-search-input)
    const search = (diffState._diffSearch || '').toLowerCase().trim();
    if (search) {
      items = items.filter(
        ({ id, nodeLabel }) =>
          id.toLowerCase().includes(search) ||
          (nodeLabel && nodeLabel.toLowerCase().includes(search))
      );
      if (!items.length) return;
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

// ── Canvas overlays ───────────────────────────────────────────────────────────

function diffApplyOverlays() {
  if (!diffState._diffData || uiState.viewMode !== 'diff') return;

  root.selectAll('g.node-group').each(function (d) {
    const id = d.id;
    d3.select(this)
      .classed('diff-added', diffState._diffData.added.has(id))
      .classed('diff-removed', diffState._diffData.removed.has(id))
      .classed('diff-changed', diffState._diffData.changed.has(id));
  });

  root.selectAll('g.diff-pill-layer').remove();
  const pillLayer = root.append('g').attr('class', 'diff-pill-layer');
  const { addedEdgeKeys, removedEdgeKeys, edgeDiffKey } = diffState._diffData;

  root.selectAll('g.edges path').each(function (d) {
    if (!d) return;
    const key = edgeDiffKey(d);
    const isAdded = addedEdgeKeys.has(key);
    const isRemoved = removedEdgeKeys.has(key);
    d3.select(this).classed('diff-edge-added', isAdded).classed('diff-edge-removed', isRemoved);

    if (!isAdded && !isRemoved) return;

    const mx = parseFloat(this.dataset.mx);
    const my = parseFloat(this.dataset.my);
    if (!isFinite(mx) || !isFinite(my)) return;

    const typeShort = (d.type || '').slice(0, 3);
    const sign = isAdded ? '+' : '−';
    const color = isAdded ? 'var(--diff-added)' : 'var(--diff-removed)';
    const label = sign + typeShort;
    const PW = label.length * 5.5 + 8;
    const PH = 13;

    const g = pillLayer
      .append('g')
      .attr('class', 'diff-edge-pill')
      .attr('transform', `translate(${mx},${my})`);
    g.append('rect')
      .attr('x', -PW / 2)
      .attr('y', -PH / 2)
      .attr('width', PW)
      .attr('height', PH)
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', 'rgba(3,45,66,.88)')
      .attr('stroke', color)
      .attr('stroke-width', 1);
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', color)
      .attr('font-size', '8px')
      .attr('font-family', "'JetBrains Mono', ui-monospace, monospace")
      .text(label);
  });
}

// Register render hook so diffApplyOverlays fires after every renderGraph call
addRenderHook(() => {
  if (uiState.viewMode === 'diff') diffApplyOverlays();
});

// ── Inspector hook ────────────────────────────────────────────────────────────

setFillInspectorHook(diffFillInspector);

// ── Diff file input wiring ────────────────────────────────────────────────────

initDiffFileInput({
  loadDiffSchema,
  diffUngraftAddedFromBase,
  diffUpdateSummary,
  diffBuildList,
});

// ── Diff sidebar event delegation ─────────────────────────────────────────────

(function wireDiffSidebar() {
  const list = document.getElementById('diff-list');
  if (list) {
    list.addEventListener('click', e => {
      // Edge row inside a table entry — navigate to the related table
      const edgeItem = e.target.closest('.diff-edge-item');
      if (edgeItem) {
        const id = edgeItem.dataset.id;
        if (id) {
          id === uiState.selectedNode ? clearSelection() : focusTable(id, false);
        }
        return;
      }
      // Table row
      const item = e.target.closest('.diff-item');
      if (!item) return;
      const id = item.dataset.id;
      if (!id) return;
      if (id === uiState.selectedNode) clearSelection();
      else focusTable(id, false);
    });
  }

  ['added', 'removed', 'changed'].forEach(k => {
    const pill = document.getElementById('diff-stat-' + k);
    if (!pill) return;
    pill.addEventListener('click', () => {
      diffState._diffFilter = diffState._diffFilter === k ? 'all' : k;
      diffUpdateSummary();
      diffBuildList();
      pushHistory();
    });
  });

  const showAllBtn = document.getElementById('diff-show-all-btn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      diffState._diffShowAll = !diffState._diffShowAll;
      diffUpdateSummary();
      render();
      pushHistory();
    });
  }

  // Keyboard navigation — only active in diff view with a diff loaded
  document.addEventListener('keydown', e => {
    if (uiState.viewMode !== 'diff' || !diffState._diffData) return;
    // Don't intercept when focus is inside a text input
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _diffMoveCursor(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _diffMoveCursor(-1);
    } else if (e.key === 'Enter') {
      if (_diffCursor < 0) return;
      const items = _diffGetItems();
      const item = items[_diffCursor];
      if (!item) return;
      const id = item.dataset.id;
      if (id) id === uiState.selectedNode ? clearSelection() : focusTable(id, false);
    } else if (e.key === 'Escape') {
      clearSelection();
      _diffClearCursor();
    }
  });

  // Inline sidebar filter wiring
  const searchInput = document.getElementById('diff-search-input');
  const searchClear = document.getElementById('diff-search-clear');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      diffState._diffSearch = searchInput.value;
      if (searchClear) searchClear.style.display = searchInput.value ? '' : 'none';
      diffBuildList();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      diffState._diffSearch = '';
      if (searchInput) searchInput.value = '';
      searchClear.style.display = 'none';
      diffBuildList();
    });
  }
})();

// ── Register with path-finder + settings ─────────────────────────────────────

registerModeValidator(mode => mode !== 'diff' || Settings.isEnabled('schemaDiff'));

onViewModeChange((mode, prevMode) => {
  if (prevMode === 'diff' && mode !== 'diff') {
    _diffClearCursor();
    root
      .selectAll('g.node-group')
      .classed('diff-added', false)
      .classed('diff-removed', false)
      .classed('diff-changed', false);
    root
      .selectAll('g.edges path')
      .classed('diff-edge-added', false)
      .classed('diff-edge-removed', false);
    root.selectAll('g.diff-pill-layer').remove();
    if (uiState.maxNodes > Config.render.maxNodesDefault * 10) {
      uiState.maxNodes = Config.render.maxNodesDefault;
      Dom.slMaxNodes.value = uiState.maxNodes;
      Dom.valMaxNodes.textContent = uiState.maxNodes;
    }
  }
  diffSyncSidebar();
});

Settings.onChange('schemaDiff', diffSyncVisibility);
diffSyncVisibility();

// Rebuild diff list when the header search changes while in diff view
onSearchChange(() => {
  if (uiState.viewMode === 'diff') diffBuildList();
});

// Rebuild diff list when advanced filter conditions change while in diff view
onFilterChange(() => {
  if (uiState.viewMode === 'diff') diffBuildList();
});

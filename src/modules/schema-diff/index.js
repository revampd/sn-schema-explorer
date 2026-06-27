import { graphState, uiState, diffState, getInstance, instancesState } from '../../core/state.js';
import { Config } from '../../core/constants.js';
import { Settings } from '../settings/index.js';
import { Dom } from '../../core/dom.js';
import { render, updateInstancePill, addRenderHook } from '../../core/render.js';
import { root } from '../../core/canvas.js';
import {
  fillInspector,
  focusTable,
  clearSelection,
  setFillInspectorHook,
} from '../../core/inspector.js';
import { syncSidebarForMode } from '../../core/sidebar-sync.js';
import { setViewMode, onViewModeChange, registerModeValidator } from '../../core/view-mode.js';
import { getWorkspace, setWorkspace } from '../../core/workspace.js';
import {
  registerHistoryExtractor,
  registerHistoryRestorer,
  pushHistory,
} from '../history/index.js';
import { injectCiRelEdges, selectInstanceForGraph } from '../load/index.js';
import { registerTool, refreshLanding } from '../landing/index.js';
import { computeDiff } from './compute-diff.js';
import { onSearchChange } from '../search/index.js';
import { onFilterChange } from '../../core/advanced-filter.js';
import { diffFillInspector } from './inspector-diff.js';
import { initDiffInstancePicker, refreshDiffPicker } from './instance-picker.js';
import { diffBuildList } from './build-list.js';
import { diffGraftAddedIntoBase, diffUngraftAddedFromBase } from './graft.js';
import { moveDiffCursor, clearDiffCursor, getFocusedDiffItem } from './list-cursor.js';

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

// ── Registry-driven diff ──────────────────────────────────────────────────────

/**
 * Run a diff between two registered instances. Base is loaded into the graph
 * (if not already the selected instance); Compare is diffed against it. An empty
 * compareId clears the comparison (base stays loaded).
 *
 * The compare data is CLONED before use — injectCiRelEdges + the graft mutate it
 * in place, and it must never corrupt the stored export. (The base is the
 * loaded instance's data, mutated in place exactly as the Schema Explorer does.)
 */
function loadDiffFromInstances(baseId, compareId) {
  if (baseId && baseId !== instancesState.selectedId) {
    if (!selectInstanceForGraph(baseId)) return;
  }
  if (!compareId) {
    clearDiff();
    refreshDiffPicker();
    return;
  }
  const compareEntry = getInstance(compareId);
  if (!compareEntry || !compareEntry.data) return;
  const compareClone =
    typeof structuredClone === 'function'
      ? structuredClone(compareEntry.data)
      : JSON.parse(JSON.stringify(compareEntry.data));
  loadDiffSchema(compareClone);
  diffState._compareId = compareId;
  refreshDiffPicker();
}

/** Clear the active comparison (ungraft + reset diff state), keeping the base. */
function clearDiff() {
  diffUngraftAddedFromBase();
  diffState._diffData = null;
  diffState._compareId = null;
  diffState._diffShowAll = false;
  diffState._diffFilter = 'all';
  diffState._diffSearch = '';
  uiState._viewPositionCache.diff = null;
  const modeWarn = document.getElementById('diff-mode-warn');
  if (modeWarn) modeWarn.style.display = 'none';
  diffUpdateSummary();
  diffBuildList();
  updateInstancePill();
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
    refreshDiffPicker();
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

// ── Diff instance picker wiring ───────────────────────────────────────────────

initDiffInstancePicker({ loadDiffFromInstances });

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
    // Only when the Schema Explorer workspace is active — not on the landing
    // page or in another tool, where viewMode may still read 'diff'.
    if (getWorkspace() !== 'schema-explorer') return;
    if (uiState.viewMode !== 'diff' || !diffState._diffData) return;
    // Don't intercept when focus is inside a text input
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveDiffCursor(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveDiffCursor(-1);
    } else if (e.key === 'Enter') {
      const item = getFocusedDiffItem();
      if (!item) return;
      const id = item.dataset.id;
      if (id) id === uiState.selectedNode ? clearSelection() : focusTable(id, false);
    } else if (e.key === 'Escape') {
      clearSelection();
      clearDiffCursor();
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
    clearDiffCursor();
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

Settings.onChange('schemaDiff', () => {
  diffSyncVisibility();
  refreshLanding(); // reflect the Diff card icon's enabled state on the landing page
});
diffSyncVisibility();

// ── Landing tool: launch Schema Diff with an instance as the base ─────────────
// The icon enables only when Schema Diff is on AND ≥2 schema-capable instances
// are registered; the compare instance is then chosen from the diff sidebar.
registerTool({
  key: 'schemaDiff',
  label: 'Compare in Schema Diff',
  icon: '⇄',
  requires: ['schema'],
  minInstances: 2,
  enabled: () => Settings.isEnabled('schemaDiff'),
  disabledHint: 'Enable Schema Diff in Settings, and register a second instance',
  enter: baseId => {
    if (!selectInstanceForGraph(baseId)) return;
    setWorkspace('schema-explorer');
    setViewMode('diff');
  },
});

// Rebuild diff list when the header search changes while in diff view
onSearchChange(() => {
  if (uiState.viewMode === 'diff') diffBuildList();
});

// Rebuild diff list when advanced filter conditions change while in diff view
onFilterChange(() => {
  if (uiState.viewMode === 'diff') diffBuildList();
});

import {
  graphState,
  uiState,
  diffState,
  getInstance,
  instancesState,
  setCompareId,
  isComparing,
  isStructureLayerOn,
  onFocusChange,
} from '../../core/state.js';
import { createDropdown } from '../../core/dropdown.js';
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
import { setViewMode, onViewModeChange } from '../../core/view-mode.js';
import { getWorkspace, setWorkspace, onWorkspaceChange } from '../../core/workspace.js';
import { refreshToolSwitcher } from '../../core/tool-switcher.js';
import { setDiffBaseHandler } from '../../core/header-instance.js';
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
import { makeConfigDrift, tablesForApp } from './config-drift.js';
import { diffBuildConfigList } from './config-list.js';
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
  // Sync diff sidebar UI if a comparison is active
  if (isComparing()) {
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
  uiState._viewPositionCache.diff = null;
  diffGraftAddedIntoBase();
  diffUpdateSummary();
  diffBuildList();
  diffBuildConfigList();
  // #141: starting a comparison no longer changes the view-mode, so sync the
  // sidebar here to reveal the diff report on the map.
  diffSyncSidebar();
  refreshStructureToggle();
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
    // The base graph aliases the instance's in-memory data and the graft mutates
    // it in place. Ungraft the OUTGOING base before switching, or its stored data
    // keeps the compare's _diffOnly nodes — which then corrupts any later diff
    // that uses it (e.g. swapping base↔compare made "removed"/"added" read 0).
    diffUngraftAddedFromBase();
    if (!selectInstanceForGraph(baseId)) return;
  }
  if (!compareId) {
    clearDiff();
    return;
  }
  const compareEntry = getInstance(compareId);
  if (!compareEntry || !compareEntry.data) return;
  const compareClone =
    typeof structuredClone === 'function'
      ? structuredClone(compareEntry.data)
      : JSON.parse(JSON.stringify(compareEntry.data));
  // Set the compare id BEFORE loading the schema: loadDiffSchema builds the
  // sidebar config block, which resolves the compare instance from diffState.
  setCompareId(compareId);
  loadDiffSchema(compareClone);
}

/** Clear the active comparison (ungraft + reset diff state), keeping the base. */
function clearDiff() {
  diffUngraftAddedFromBase();
  diffState._diffData = null;
  setCompareId(null);
  diffState._diffShowAll = false;
  diffState._diffFilter = 'all';
  diffState._configFilter = 'all';
  diffState._activeConfigApp = null;
  uiState._viewPositionCache.diff = null;
  const modeWarn = document.getElementById('diff-mode-warn');
  if (modeWarn) modeWarn.style.display = 'none';
  diffUpdateSummary();
  diffBuildList();
  diffBuildConfigList();
  // Comparison dropped — restore the default sidebar and hide the layer toggle.
  diffSyncSidebar();
  refreshStructureToggle();
  updateInstancePill();
  render();
}

// ── Visibility sync ───────────────────────────────────────────────────────────

function diffSyncVisibility() {
  const enabled = Settings.isEnabled('schemaDiff');
  refreshToolSwitcher();
  refreshHeaderCompare();
  // Diff is a layer now: if the feature is turned off, drop any active comparison.
  if (!enabled && isComparing()) clearDiff();
}

// ── Sidebar sync ──────────────────────────────────────────────────────────────

function diffSyncSidebar() {
  if (!document.getElementById('diff-sidebar')) return;
  syncSidebarForMode();
  if (isComparing()) {
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
  // #141: applies on the Schema Map whenever a comparison is active (no diff mode).
  if (!isComparing() || uiState.viewMode !== 'force') return;
  const structure = isStructureLayerOn();

  root.selectAll('g.node-group').each(function (d) {
    const id = d.id;
    d3.select(this)
      .classed('diff-added', structure && diffState._diffData.added.has(id))
      .classed('diff-removed', structure && diffState._diffData.removed.has(id))
      .classed('diff-changed', structure && diffState._diffData.changed.has(id));
  });

  // Config-drift badge: a small corner dot per node, keyed by the owning app's
  // drift between base and compare. Opt-in — only when both sides exported app
  // metadata (makeConfigDrift.comparable). A distinct channel (dot) so it never
  // fights the diff node-stroke colours. 'inactive' is left unbadged (neutral).
  const BADGE_CLASS = {
    sync: 'cfgb-sync',
    drift: 'cfgb-drift',
    missing: 'cfgb-missing',
    active: 'cfgb-state',
  };
  root.selectAll('circle.cfg-node-badge').remove();
  const baseData = getInstance(instancesState.selectedId)?.data;
  const compareData = getInstance(diffState._compareId)?.data;
  const drift = makeConfigDrift(baseData, compareData);
  if (drift.comparable) {
    root.selectAll('g.node-group').each(function (d) {
      const entry = drift.forScope(d.scope);
      const cls = entry && BADGE_CLASS[entry.status];
      if (!cls) return;
      const rect = this.querySelector('rect.node-rect');
      if (!rect) return;
      const bb = rect.getBBox();
      d3.select(this)
        .append('circle')
        .attr('class', 'cfg-node-badge ' + cls)
        .attr('r', 4)
        .attr('cx', bb.x + bb.width - 8)
        .attr('cy', bb.y + 8);
    });
  }

  // Highlight the tables owned by the app picked in the sidebar config list
  // (#139b) — dim the rest — so a config-only-drifted table is locatable.
  if (diffState._activeConfigApp && graphState.graphData) {
    const owned = new Set(tablesForApp(diffState._activeConfigApp, graphState.graphData.nodes));
    root.selectAll('g.node-group').each(function (d) {
      d3.select(this)
        .classed('cfg-app-hi', owned.has(d.id))
        .classed('cfg-app-dim', !owned.has(d.id));
    });
  } else {
    root.selectAll('g.node-group').classed('cfg-app-hi', false).classed('cfg-app-dim', false);
  }

  root.selectAll('g.diff-pill-layer').remove();
  if (!structure) {
    root
      .selectAll('g.edges path')
      .classed('diff-edge-added', false)
      .classed('diff-edge-removed', false);
    return;
  }
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
// (it self-guards on an active comparison in the map view).
addRenderHook(() => diffApplyOverlays());

// ── Inspector hook ────────────────────────────────────────────────────────────

setFillInspectorHook(diffFillInspector);

// ── Diff instance picker wiring ───────────────────────────────────────────────

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
    if (uiState.viewMode !== 'force' || !isComparing()) return;
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
})();

// ── Register with path-finder + settings ─────────────────────────────────────

onViewModeChange((mode, prevMode) => {
  // Path Finder has its own DAG layout; while it's showing, the comparison graft
  // and diff colouring must come off the (now hidden) map, then go back when we
  // return. (#141 — the graft lifecycle is tied to the map view, not a diff mode.)
  if (mode === 'path' && prevMode === 'force') {
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
    if (isComparing()) diffUngraftAddedFromBase();
  }
  if (mode === 'force' && prevMode === 'path' && isComparing()) {
    diffGraftAddedIntoBase();
  }
  diffSyncSidebar();
  refreshHeaderCompare();
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
  label: 'Compare on the Schema Map',
  icon: '⇄',
  requires: ['schema'],
  minInstances: 2,
  enabled: () => Settings.isEnabled('schemaDiff'),
  disabledHint: 'Enable Schema Diff in Settings, and register a second instance',
  enter: baseId => {
    // #141: Diff is a layer on the map. Open the base on the Schema Map; the user
    // picks the compare instance from the header Compare dropdown.
    diffUngraftAddedFromBase();
    if (!selectInstanceForGraph(baseId)) return;
    setWorkspace('schema-explorer');
    setViewMode('force');
    refreshHeaderCompare();
  },
});

const schemaInstanceCount = () =>
  instancesState.instances.filter(e => e.capabilities && e.capabilities.schema).length;

// The header instance dropdown switches the BASE; if a comparison is active,
// re-run it against the same compare so the diff follows the new base.
setDiffBaseHandler(baseId => loadDiffFromInstances(baseId, diffState._compareId));

// Rebuild the diff list when the header search / advanced filter changes while a
// comparison is active.
onSearchChange(() => {
  if (isComparing()) diffBuildList();
});
onFilterChange(() => {
  if (isComparing()) diffBuildList();
});

// ── Header "Compare" dropdown — the entry point for the diff layer (#141) ──────
// Lives beside the instance (Base) dropdown. Picking a compare instance loads the
// comparison as a layer on the Schema Map; "No comparison" clears it.
let _cmpDd = null;
const NO_COMPARE = '__none__';

export function refreshHeaderCompare() {
  const host = document.getElementById('header-compare');
  if (!host) return;
  const onMap = getWorkspace() === 'schema-explorer' && uiState.viewMode === 'force';
  const eligible =
    onMap &&
    Settings.isEnabled('schemaDiff') &&
    schemaInstanceCount() >= 2 &&
    !!graphState.graphData;
  host.style.display = eligible ? '' : 'none';
  if (!eligible) return;
  if (!_cmpDd) {
    _cmpDd = createDropdown({
      ariaLabel: 'Compare against',
      title: 'Compare the loaded instance against another (diff layer)',
      onChange: id => {
        const base = instancesState.selectedId;
        loadDiffFromInstances(base, id === NO_COMPARE ? null : id);
        refreshHeaderCompare();
      },
    });
  }
  if (_cmpDd.el.parentElement !== host) host.appendChild(_cmpDd.el);
  const opts = [
    { value: NO_COMPARE, label: 'Compare: none' },
    ...instancesState.instances
      .filter(e => e.capabilities && e.capabilities.schema && e.id !== instancesState.selectedId)
      .map(e => ({ value: e.id, label: 'vs ' + e.label })),
  ];
  _cmpDd.setOptions(opts, diffState._compareId || NO_COMPARE);
  refreshHeaderSwap(eligible);
}

// Header swap button — flips Base and Compare (replaces the old sidebar swap).
let _swapWired = false;
function refreshHeaderSwap(eligible) {
  const btn = document.getElementById('header-swap');
  if (!btn) return;
  if (!_swapWired) {
    btn.addEventListener('click', () => {
      const base = instancesState.selectedId;
      const cmp = diffState._compareId;
      if (!cmp) return; // nothing to swap into the base slot
      loadDiffFromInstances(cmp, base);
      refreshHeaderCompare();
    });
    _swapWired = true;
  }
  btn.style.display = eligible ? '' : 'none';
  btn.disabled = !isComparing();
}

onWorkspaceChange(() => refreshHeaderCompare());
// Refresh when the loaded instance or compare changes (focus events) — covers a
// freshly loaded graph, base switches, and compare changes.
onFocusChange(() => refreshHeaderCompare());

// ── Canvas "Structure changes" layer toggle (#141) ───────────────────────────
// Lets the user mute the structural-diff colouring while keeping the comparison
// (e.g. to read the config-drift badges alone). Shown only while comparing on the
// map; built in JS so no Prettier-ignored partial is touched.
let _structToggle = null;

function refreshStructureToggle() {
  const host = document.getElementById('edge-legend')?.parentNode;
  if (!host) return;
  if (!_structToggle) {
    const btn = document.createElement('button');
    btn.id = 'diff-structure-toggle';
    btn.type = 'button';
    btn.className = 'cfg-drift-toggle';
    btn.textContent = 'Structure changes';
    btn.addEventListener('click', () => {
      diffState._structureLayer = !diffState._structureLayer;
      refreshStructureToggle();
      render();
    });
    host.appendChild(btn);
    _structToggle = btn;
  }
  const show = isComparing() && uiState.viewMode === 'force';
  _structToggle.style.display = show ? '' : 'none';
  _structToggle.setAttribute('aria-pressed', String(!!diffState._structureLayer));
  _structToggle.classList.toggle('active', !!diffState._structureLayer);
}

onFocusChange(() => refreshStructureToggle());
onViewModeChange(() => refreshStructureToggle());

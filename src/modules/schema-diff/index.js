import {
  graphState,
  uiState,
  diffState,
  getInstance,
  instancesState,
  setCompareId,
  setCompareIds,
  isComparing,
  isStructureLayerOn,
  onFocusChange,
  notifyFocusChange,
} from '../../core/state.js';
import { createDropdown } from '../../core/dropdown.js';
import { registerCompareProvider, refreshHeaderCompare } from '../../core/header-compare.js';
// Re-export so existing importers keep resolving refreshHeaderCompare here.
export { refreshHeaderCompare };
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
import { onViewModeChange } from '../../core/view-mode.js';
import { getWorkspace, onWorkspaceChange } from '../../core/workspace.js';
import { refreshToolSwitcher } from '../../core/tool-switcher.js';
import { setDiffBaseHandler } from '../../core/header-instance.js';
import {
  registerHistoryExtractor,
  registerHistoryRestorer,
  pushHistory,
} from '../history/index.js';
import { injectCiRelEdges, selectInstanceForGraph } from '../load/index.js';
import { computeDiffMatrix, rollupMatrix } from './compute-matrix.js';
import { onSearchChange } from '../search/index.js';
import { onFilterChange } from '../../core/advanced-filter.js';
import { diffFillInspector } from './inspector-diff.js';
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
  // #150 — build the N-way diff matrix (one pairwise diff per selected compare),
  // and keep `_diffData` === the primary entry so the canvas/graft path is
  // unchanged. With a single compare this is a one-element matrix; the
  // multi-select header (PR ④) widens the subjects list. Extra subjects (index
  // ≥ 1) are cloned + ci-rel-injected here exactly as the primary is, since
  // computeDiff needs the same edge representation on both sides.
  const subjects = diffState._compareIds.map((id, i) => {
    if (i === 0) {
      return { id, label: getInstance(id)?.label || id, data: compareData };
    }
    const entry = getInstance(id);
    if (!entry || !entry.data) return null;
    const clone =
      typeof structuredClone === 'function'
        ? structuredClone(entry.data)
        : JSON.parse(JSON.stringify(entry.data));
    injectCiRelEdges(clone);
    return { id, label: entry.label || id, data: clone };
  });
  diffState._diffMatrix = computeDiffMatrix(graphState.graphData, subjects.filter(Boolean));
  diffState._diffData = diffState._diffMatrix[0];
  diffState._diffData._compareInstance = compareData._instance || null;
  diffState._diffData._compareStats = compareData._stats || null;
  diffState._diffData._compareCapabilities = compareData._capabilities || null;
  diffState._diffData._compareBuild = compareData._build || null;
  diffState._diffData._compareVersion = compareData._schema_version || null;
  // Start a new comparison showing the FULL graph with diff colouring rather than
  // collapsing to changed-only — otherwise the map looks emptied (and Refresh
  // appears to do nothing, since it re-lays-out the collapsed set). The
  // "Changed only" toggle still narrows it on demand.
  diffState._diffShowAll = true;
  diffState._diffFilter = 'all';
  // A fresh comparison starts with all report groups expanded and no element slice.
  diffState._collapsedGroups = [];
  diffState._diffElementFilter = null;
  // Establishing a comparison turns the Differences overlay ON, regardless of any
  // prior toggle state — selecting one or more compare targets should light up the
  // diff view on the canvas (the toggle still mutes it without dropping the diff).
  diffState._diffLayerOn = true;
  uiState._viewPositionCache.diff = null;
  diffGraftAddedIntoBase();
  diffUpdateSummary();
  diffBuildList();
  // #141: starting a comparison no longer changes the view-mode, so sync the
  // sidebar here to reveal the diff report on the map.
  diffSyncSidebar();
  refreshDiffLayerControl();
  updateInstancePill();
  // The compare list is set (setCompareIds) BEFORE `_diffData` is populated here,
  // so the focus-change it fired saw isComparing() === false. Re-notify now that
  // the comparison is fully active, so isComparing()-gated listeners settle — most
  // importantly the standalone config-overlay control, which must stand down while
  // a comparison is active (#150).
  notifyFocusChange();

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
 * Run a diff between registered instances. Base is loaded into the graph (if not
 * already the selected instance); each compare is diffed against it. An empty
 * compare list clears the comparison (base stays loaded). `compareIds` may be a
 * single id (back-compat) or an array (#150 multi-compare).
 *
 * The primary compare's data is CLONED before use — injectCiRelEdges + the graft
 * mutate it in place, and it must never corrupt the stored export. (loadDiffSchema
 * clones the remaining compares itself.) The base is the loaded instance's data,
 * mutated in place exactly as the Schema Explorer does.
 */
function loadDiffFromInstances(baseId, compareIds) {
  const ids = (Array.isArray(compareIds) ? compareIds : compareIds ? [compareIds] : []).filter(
    Boolean
  );
  if (baseId && baseId !== instancesState.selectedId) {
    // The base graph aliases the instance's in-memory data and the graft mutates
    // it in place. Ungraft the OUTGOING base before switching, or its stored data
    // keeps the compare's _diffOnly nodes — which then corrupts any later diff
    // that uses it (e.g. swapping base↔compare made "removed"/"added" read 0).
    diffUngraftAddedFromBase();
    if (!selectInstanceForGraph(baseId)) return;
  }
  // An instance can't compare against itself — drop any compare equal to the
  // (possibly just-switched) base. Otherwise switching the base onto an existing
  // compare leaves a phantom self-compare column (identical everywhere) and the
  // selection count disagrees with the picker, which hides the base.
  const compares = ids.filter(id => id !== instancesState.selectedId);
  if (!compares.length) {
    clearDiff();
    return;
  }
  const primaryEntry = getInstance(compares[0]);
  if (!primaryEntry || !primaryEntry.data) return;
  const primaryClone =
    typeof structuredClone === 'function'
      ? structuredClone(primaryEntry.data)
      : JSON.parse(JSON.stringify(primaryEntry.data));
  // Set the compare list BEFORE loading the schema: loadDiffSchema reads
  // diffState._compareIds to build the matrix (and the sidebar config block
  // resolves the primary compare from diffState).
  setCompareIds(compares);
  loadDiffSchema(primaryClone);
}

/** Clear the active comparison (ungraft + reset diff state), keeping the base. */
function clearDiff() {
  diffUngraftAddedFromBase();
  diffState._diffData = null;
  diffState._diffMatrix = null;
  setCompareId(null);
  // Reset the overlay to ON so the next comparison starts with the diff visible.
  diffState._diffLayerOn = true;
  diffState._diffShowAll = false;
  diffState._diffFilter = 'all';
  diffState._diffElementFilter = null;
  uiState._viewPositionCache.diff = null;
  const modeWarn = document.getElementById('diff-mode-warn');
  if (modeWarn) modeWarn.style.display = 'none';
  diffUpdateSummary();
  diffBuildList();
  // Comparison dropped — restore the default sidebar and hide the layer toggle.
  diffSyncSidebar();
  refreshDiffLayerControl();
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
  // #150 — with multiple compares the counts are "tables that are added / removed /
  // changed in AT LEAST one instance" (a single compare reduces to the pairwise
  // sizes, so the classic numbers are unchanged). Counts are table-only;
  // configuration drift is surfaced in the Inspector, not this report.
  const matrix = diffState._diffMatrix;
  let nA = diffState._diffData.added.size;
  let nR = diffState._diffData.removed.size;
  let nC = diffState._diffData.changed.size;
  if (matrix && matrix.length > 1) {
    const { tables } = rollupMatrix(matrix);
    nA = nR = nC = 0;
    for (const info of tables.values()) {
      if (info.anyAdded) nA++;
      if (info.anyRemoved) nR++;
      if (info.anyChanged) nC++;
    }
  }
  if (nAdded) nAdded.textContent = nA;
  if (nRemoved) nRemoved.textContent = nR;
  if (nChanged) nChanged.textContent = nC;
  if (showAllBtn) {
    showAllBtn.classList.toggle('active', diffState._diffShowAll);
    // The label names the GRAPH state — this toggle never touches the report list.
    showAllBtn.textContent = diffState._diffShowAll ? 'Graph: all tables' : 'Graph: changed only';
  }
  ['added', 'removed', 'changed'].forEach(k => {
    const el = document.getElementById('diff-stat-' + k);
    if (el) el.classList.toggle('active', diffState._diffFilter === k);
  });
  refreshDiffElementFilter();
}

// ── Element-type slice for the Changed list (#4) ────────────────────────────────
// A marked-toggle dropdown that narrows the Changed rows to those whose change
// touches a chosen element kind. null = all kinds (no slice).
const ELEMENT_TYPES = [
  { key: 'fields', label: 'Fields' },
  { key: 'reference', label: 'References' },
  { key: 'extends', label: 'Inheritance' },
  { key: 'm2m', label: 'M2M' },
  { key: 'rel', label: 'Named rel' },
  { key: 'view', label: 'DB view' },
  { key: 'cmdb_rel', label: 'CI topology' },
];
const ALL_ELEM = '__allelem__';
let _elemDd = null;

function elemSelectedKeys() {
  return diffState._diffElementFilter || ELEMENT_TYPES.map(t => t.key);
}

function refreshDiffElementFilter() {
  const host = document.getElementById('diff-element-filter');
  if (!host) return;
  if (!_elemDd) {
    _elemDd = createDropdown({
      ariaLabel: 'Filter changed tables by element type',
      title: 'Show only changed tables whose change touches the chosen element kinds',
      onChange: val => {
        if (val === ALL_ELEM) {
          diffState._diffElementFilter = null;
        } else if (val) {
          const all = ELEMENT_TYPES.map(t => t.key);
          const sel = new Set(elemSelectedKeys());
          if (sel.has(val)) sel.delete(val);
          else sel.add(val);
          diffState._diffElementFilter = all.every(k => sel.has(k)) ? null : [...sel];
        }
        diffBuildList();
        refreshDiffElementFilter();
      },
    });
  }
  if (_elemDd.el.parentElement !== host) host.appendChild(_elemDd.el);
  const sel = new Set(elemSelectedKeys());
  const isAll = !diffState._diffElementFilter;
  const summary = isAll ? 'Kind: all' : 'Kind: ' + sel.size;
  const opts = [
    { value: '', label: summary },
    ...(isAll ? [] : [{ value: ALL_ELEM, label: 'All kinds' }]),
    ...ELEMENT_TYPES.map(t => ({ value: t.key, label: (sel.has(t.key) ? '✓ ' : '') + t.label })),
  ];
  _elemDd.setOptions(opts, '');
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

  // #150 — config drift is NOT a canvas channel: it's surfaced in the inspector
  // (the Configuration section for the selected table) and in the sidebar report.
  // "Diff is diff" — the canvas overlay just paints the structural difference for
  // the compared instances. (Old per-node cfg-node-badge dots removed.)

  // Config drift no longer rides the diff sidebar (it lives in the Inspector), so
  // there's no app-highlight on the canvas — keep these classes cleared.
  root.selectAll('g.node-group').classed('cfg-app-hi', false).classed('cfg-app-dim', false);

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

// Select a table from the diff sidebar. Tables added only in a (non-primary)
// compare aren't grafted onto the base map, so focusTable() — which bails when the
// node isn't in the graph — silently no-ops on them. Here we still select the
// table and render the comparison inspector directly, so every differing row is
// navigable whether or not it lives on the map (#150).
export function selectDiffTable(id) {
  if (!id) return;
  if (id === uiState.selectedNode) {
    clearSelection();
    return;
  }
  const inGraph = !!graphState.graphData?._nodeById?.get(id);
  if (inGraph) {
    focusTable(id, false);
    return;
  }
  uiState.selectedNode = id;
  Dom.statFocus.textContent = id;
  fillInspector({ id });
  render();
  pushHistory();
}

(function wireDiffSidebar() {
  const list = document.getElementById('diff-list');
  if (list) {
    list.addEventListener('click', e => {
      // Group header — collapse/expand its rows (display-only; no rebuild).
      const groupHeader = e.target.closest('.diff-group-header');
      if (groupHeader) {
        const key = groupHeader.dataset.group;
        const set = diffState._collapsedGroups || (diffState._collapsedGroups = []);
        const i = set.indexOf(key);
        if (i >= 0) set.splice(i, 1);
        else set.push(key);
        groupHeader.parentElement?.classList.toggle('collapsed', i < 0);
        return;
      }
      // Edge row inside a table entry — navigate to the related table
      const edgeItem = e.target.closest('.diff-edge-item');
      if (edgeItem) {
        selectDiffTable(edgeItem.dataset.id);
        return;
      }
      const item = e.target.closest('.diff-item');
      if (!item) return;
      selectDiffTable(item.dataset.id);
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
      selectDiffTable(item.dataset.id);
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
});
diffSyncVisibility();

// Note: there is no dedicated "Compare on the Schema Map" landing card — the
// comparison is now driven entirely from the header Compare control in the Schema
// Map (open any instance via its "Open in Schema Map" card, then pick compares).

const schemaInstanceCount = () =>
  instancesState.instances.filter(e => e.capabilities && e.capabilities.schema).length;

// The header instance dropdown switches the BASE; if a comparison is active,
// re-run it against the same compares so the diff follows the new base.
setDiffBaseHandler(baseId => loadDiffFromInstances(baseId, diffState._compareIds));

// Rebuild the diff list when the header search / advanced filter changes while a
// comparison is active.
onSearchChange(() => {
  if (isComparing()) diffBuildList();
});
onFilterChange(() => {
  if (isComparing()) diffBuildList();
});

// ── Header "Compare" control — the entry point for the diff layer (#141, #150) ──
// Lives beside the instance (Base) dropdown. MULTI-SELECT (#150) as a single
// dropdown whose rows are TOGGLES: a selected compare is marked with ✓ in the
// list (no chips — they overflowed the header). Clicking a row toggles that
// instance in/out of the comparison; "Compare: none" clears all. Each change
// reloads the comparison as a layer on the Schema Map, so the inspector + sidebar
// scale to one column per selected compare.
// Schema Diff's provider for the shared header Compare control (core/header-compare).
// Eligible only on the Schema Map with ≥2 schemas + a loaded graph. Each toggle
// reloads the comparison as a layer; swap flips Base with the primary compare.
registerCompareProvider({
  eligible: () =>
    getWorkspace() === 'schema-explorer' &&
    uiState.viewMode === 'force' &&
    Settings.isEnabled('schemaDiff') &&
    schemaInstanceCount() >= 2 &&
    !!graphState.graphData,
  getSelected: () => diffState._compareIds,
  getCandidates: () =>
    instancesState.instances
      .filter(e => e.capabilities && e.capabilities.schema && e.id !== instancesState.selectedId)
      .map(e => ({ id: e.id, label: e.label })),
  labelFor: id => getInstance(id)?.label || id,
  onToggle: id => {
    const base = instancesState.selectedId;
    const sel = diffState._compareIds;
    // Toggle: a row already in the comparison comes out; otherwise it goes in.
    const next = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
    loadDiffFromInstances(base, next);
  },
  onClear: () => loadDiffFromInstances(instancesState.selectedId, []),
  swap: {
    canSwap: () => isComparing(),
    onSwap: () => {
      const base = instancesState.selectedId;
      const compares = diffState._compareIds;
      if (!compares.length) return; // nothing to swap into the base slot
      loadDiffFromInstances(compares[0], [base, ...compares.slice(1)]);
    },
  },
});

onWorkspaceChange(() => refreshHeaderCompare());
// Refresh when the loaded instance or compare changes (focus events) — covers a
// freshly loaded graph, base switches, and compare changes.
onFocusChange(() => refreshHeaderCompare());

// Materialize a comparison selection carried over from Config Data — it sets the
// shared diffState._compareIds WITHOUT computing the diff (no graph there). Once a
// graph is loaded on the map, compute the diff. The !isComparing() guard makes
// this run once (loadDiffFromInstances re-fires a focus change that then no-ops).
onFocusChange(() => {
  if (
    getWorkspace() === 'schema-explorer' &&
    uiState.viewMode === 'force' &&
    graphState.graphData &&
    diffState._compareIds.length &&
    !isComparing()
  ) {
    loadDiffFromInstances(instancesState.selectedId, diffState._compareIds);
  }
});

// ── Canvas "Differences" layer toggle (#150) ──────────────────────────────────
// A single toggle for the comparison overlay (structural diff colouring + edge
// pills) — "diff is diff", no structure/config split. Config drift is surfaced in
// the inspector (the Configuration section for the selected table) and the sidebar
// report, not as a canvas channel. While a comparison is active the standalone
// config-overlay control stands down (see config-overlay/index.js). Shown only
// while comparing on the map; built in JS (no partial edits).
let _diffLayerToggle = null;

function refreshDiffLayerControl() {
  const host = document.getElementById('edge-legend')?.parentNode;
  if (!host) return;
  if (!_diffLayerToggle) {
    const btn = document.createElement('button');
    btn.id = 'diff-layer-master';
    btn.type = 'button';
    btn.className = 'cfg-drift-toggle';
    btn.textContent = 'Differences';
    btn.title = 'Show the comparison overlay (added / removed / changed tables)';
    btn.addEventListener('click', () => {
      diffState._diffLayerOn = !diffState._diffLayerOn;
      refreshDiffLayerControl();
      render();
    });
    host.appendChild(btn);
    _diffLayerToggle = btn;
  }
  const show = isComparing() && uiState.viewMode === 'force';
  _diffLayerToggle.style.display = show ? '' : 'none';
  _diffLayerToggle.setAttribute('aria-pressed', String(!!diffState._diffLayerOn));
  _diffLayerToggle.classList.toggle('active', !!diffState._diffLayerOn);
}

onFocusChange(() => refreshDiffLayerControl());
onViewModeChange(() => refreshDiffLayerControl());

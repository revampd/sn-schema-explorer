import {
  graphState,
  uiState,
  diffState,
  buildScopeColorMap,
  buildIndexes,
  getInstance,
  selectInstance,
} from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { Settings } from '../settings/index.js';
import { render, updateInstancePill, updateStats } from '../../core/render.js';
import { SavedViews } from '../saved-views/index.js';
import { applyFilters } from '../schema-map/controls.js';
import { buildScopeDisplay, buildFilterPanel } from '../../core/advanced-filter.js';
import { updateMaxNodesSlider, updateHopDepthSlider } from '../../core/density-controls.js';
import { syncLegendRows } from '../graph-view/controls.js';
import { buildTableList } from '../../core/table-list.js';
import { focusTable } from '../../core/inspector.js';
import { setSearchData } from '../search/index.js';
import { resetHistory } from '../history/index.js';
import { refreshReferenceTableLinks } from '../reference/index.js';

/**
 * Inject _ciRelationships into data.edges as cmdb_rel edges.
 * Called by loadGraph (base schema) and by schema-diff's loadDiffSchema (compare
 * schema) so both sides of a diff have the same edge representation.
 * Any pre-existing cmdb_rel entries are stripped first to prevent duplicates when
 * this is called more than once on the same object.
 */
export function injectCiRelEdges(data) {
  data.edges = (data.edges || []).filter(e => e.type !== 'cmdb_rel');
  if (!Array.isArray(data._ciRelationships) || !data._ciRelationships.length) return;
  const nodeIdSet = new Set((data.nodes || []).map(n => n.id));
  let injected = 0,
    skipped = 0;
  for (const r of data._ciRelationships) {
    if (!r || !r.parentClass || !r.childClass) continue;
    if (!nodeIdSet.has(r.parentClass) || !nodeIdSet.has(r.childClass)) {
      skipped++;
      continue;
    }
    data.edges.push({
      source: r.parentClass,
      target: r.childClass,
      type: 'cmdb_rel',
      parentLabel: r.parentLabel || r.relTypeDisplay || '',
      childLabel: r.childLabel || r.relTypeDisplay || '',
      relTypeDisplay: r.relTypeDisplay || '',
      label: r.parentLabel || r.relTypeDisplay || '',
    });
    injected++;
  }
}

// (Filter button wiring is done inside loadGraph on first load — see below)

export function loadGraph(data) {
  resetHistory();
  graphState.graphData = data;
  function originise(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) {
      try {
        return new URL(s).origin;
      } catch (_) {
        return '';
      }
    }
    if (!s.includes('.') && !s.includes('/')) {
      return 'https://' + s + '.service-now.com';
    }
    return 'https://' + s.replace(/\/+$/, '');
  }
  if (data._instance) {
    if (typeof data._instance === 'string') {
      graphState.snInstance = originise(data._instance);
    } else if (data._instance.instance_url) {
      graphState.snInstance = originise(data._instance.instance_url);
    } else if (data._instance.instance_name) {
      graphState.snInstance = originise(data._instance.instance_name);
    }
  }
  updateInstancePill();
  // Visibility of the front door vs. the graph is owned by the workspace
  // controller now (the caller switches to the schema-explorer workspace) —
  // loadGraph no longer hides any overlay itself.
  uiState.connectedNodes = new Set();
  diffState._diffData = null;
  diffState._diffShowAll = false;
  uiState._viewPositionCache.force = null;
  uiState._viewPositionCache.diff = null;
  SavedViews.setFingerprint(SavedViews.fingerprint(data));

  injectCiRelEdges(data);

  // Stamp edge _sourceId/_targetId and build _nodeById + _adj (shared with the
  // diff module). Everything below can now rely on the normalized id fields.
  buildIndexes(data);

  const _ec = {};
  data.edges.forEach(e => {
    _ec[e._sourceId] = (_ec[e._sourceId] || 0) + 1;
    _ec[e._targetId] = (_ec[e._targetId] || 0) + 1;
  });
  data._edgeCnt = _ec;

  updateStats();
  buildScopeColorMap(data.nodes);
  buildTableList();

  const _fieldSearchIndex = new Map();
  data.nodes.forEach(n => {
    if (!Array.isArray(n.fields)) return;
    for (const f of n.fields) {
      const key = String(f.name || '').toLowerCase();
      if (!key) continue;
      if (!_fieldSearchIndex.has(key)) _fieldSearchIndex.set(key, new Set());
      _fieldSearchIndex.get(key).add(n.id);
    }
  });
  setSearchData(data._nodeById, _fieldSearchIndex);

  // Pre-compute edge-membership sets for the dynamic filter
  const _refOutIds = new Set(),
    _refInIds = new Set();
  const _extOutIds = new Set(),
    _extInIds = new Set();
  const _m2mIds = new Set(),
    _relIds = new Set();
  const _viewIds = new Set(),
    _cmdbRelIds = new Set();
  const _childrenOf = new Map();

  for (const e of data.edges) {
    const s = e._sourceId,
      t = e._targetId;
    if (e.type === 'reference') {
      _refOutIds.add(s);
      _refInIds.add(t);
    }
    if (e.type === 'extends') {
      _extOutIds.add(s);
      _extInIds.add(t);
      if (!_childrenOf.has(t)) _childrenOf.set(t, []);
      _childrenOf.get(t).push(s);
    }
    if (e.type === 'm2m') {
      _m2mIds.add(s);
      _m2mIds.add(t);
    }
    if (e.type === 'rel') {
      _relIds.add(s);
      _relIds.add(t);
    }
    if (e.type === 'view') {
      _viewIds.add(s);
      _viewIds.add(t);
    }
    if (e.type === 'cmdb_rel') {
      _cmdbRelIds.add(s);
      _cmdbRelIds.add(t);
    }
  }
  // BFS from cmdb_ci to collect the full CI hierarchy (for tableType:'cmdb' filter)
  const _cmdbCiIds = new Set();
  if (data._nodeById.has('cmdb_ci')) {
    const q = ['cmdb_ci'],
      seen = new Set(q);
    while (q.length) {
      const id = q.shift();
      _cmdbCiIds.add(id);
      (_childrenOf.get(id) || []).forEach(c => {
        if (!seen.has(c)) {
          seen.add(c);
          q.push(c);
        }
      });
    }
  }
  Object.assign(data, {
    _refOutIds,
    _refInIds,
    _extOutIds,
    _extInIds,
    _m2mIds,
    _relIds,
    _viewIds,
    _cmdbRelIds,
    _cmdbCiIds,
  });

  // Scope display (sidebar) + filter panel (grid row below header)
  buildScopeDisplay(Dom.scopeInfoList, { onApply: applyFilters });
  if (Dom.filterBody) buildFilterPanel(Dom.filterBody, { onApply: applyFilters });

  // Show the scope info group in the sidebar
  const scopeInfoGroup = document.getElementById('scope-info-group');
  if (scopeInfoGroup) scopeInfoGroup.style.display = '';

  // Show the "Filter" button in the header (hidden until data loads)
  if (Dom.filterOpenBtn) Dom.filterOpenBtn.style.display = '';

  // Wire the Filter button to toggle the filter bar (once only per session)
  if (Dom.filterOpenBtn && !Dom.filterOpenBtn._filterListenerAdded) {
    Dom.filterOpenBtn._filterListenerAdded = true;

    const _closeBar = () => Dom.filterBar?.classList.remove('open');
    const _openBar = () => {
      Dom.filterBar?.classList.add('open');
      if (Dom.filterBody?._rebuildFilterPanel) Dom.filterBody._rebuildFilterPanel();
    };

    Dom.filterOpenBtn.addEventListener('click', () => {
      Dom.filterBar?.classList.contains('open') ? _closeBar() : _openBar();
    });

    // Escape key closes the bar
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _closeBar();
    });
  }

  updateMaxNodesSlider();
  updateHopDepthSlider();
  render();
  // Enable all view-mode buttons + nav controls now that data is present.
  // Each feature module controls its own button's *visibility*; the load
  // module is only responsible for the enabled/disabled state.
  document
    .querySelectorAll('#view-mode-seg .vms-btn, #btn-refresh, #btn-reset, #btn-export')
    .forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('btn-nav-disabled');
    });
  Dom.edgeLegend.style.display = 'block';
  syncLegendRows();
  Dom.densityGroup.style.display = 'block';
  Dom.sortBar.style.display = 'flex';

  const preselect =
    data._nodeById.get('task') ||
    data.nodes.slice().sort((a, b) => (data._edgeCnt[b.id] || 0) - (data._edgeCnt[a.id] || 0))[0];
  if (preselect) focusTable(preselect.id);
  refreshReferenceTableLinks();
}

/**
 * Select a registered instance and load its schema into the graph. The single
 * entry point tools use to switch the Schema Explorer to a given instance.
 * Returns false when the id is unknown or the entry has no in-memory data (a
 * restored placeholder whose file hasn't been re-dropped yet).
 *
 * Does NOT change the workspace — the caller (e.g. the landing tool tile) is
 * responsible for `setWorkspace('schema-explorer')`. loadGraph already resets
 * the diff/position caches, so switching instances cannot leave a stale diff.
 */
export function selectInstanceForGraph(id) {
  const entry = getInstance(id);
  if (!entry || !entry.data) return false;
  selectInstance(id);
  loadGraph(entry.data);
  return true;
}

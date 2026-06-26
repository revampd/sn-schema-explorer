import { graphState, uiState, diffState, buildScopeColorMap, buildIndexes } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { Settings } from '../settings/index.js';
import { render, updateInstancePill, updateStats } from '../../engine/render.js';
import { SavedViews } from '../saved-views/index.js';
import { DEMO_DATA } from '../../core/constants.js';
import { applyFilters } from '../schema-map/controls.js';
import { buildScopeDisplay, buildFilterPanel } from '../../core/advanced-filter.js';
import { updateMaxNodesSlider, updateHopDepthSlider } from '../../shared/density-controls.js';
import { syncLegendRows } from '../graph-view/controls.js';
import { buildTableList } from '../../shared/table-list.js';
import { focusTable } from '../../shared/inspector.js';
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
  let injected = 0, skipped = 0;
  for (const r of data._ciRelationships) {
    if (!r || !r.parentClass || !r.childClass) continue;
    if (!nodeIdSet.has(r.parentClass) || !nodeIdSet.has(r.childClass)) {
      skipped++;
      continue;
    }
    data.edges.push({
      source: r.parentClass,
      target: r.childClass,
      type:   'cmdb_rel',
      parentLabel:    r.parentLabel    || r.relTypeDisplay || '',
      childLabel:     r.childLabel     || r.relTypeDisplay || '',
      relTypeDisplay: r.relTypeDisplay || '',
      label:          r.parentLabel    || r.relTypeDisplay || ''
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
      try { return new URL(s).origin; } catch (_) { return ''; }
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
  Dom.loadOverlay.style.display = 'none';
  uiState.connectedNodes = new Set();
  diffState._diffData = null;
  diffState._diffShowAll = false;
  uiState._viewPositionCache.force = null;
  uiState._viewPositionCache.diff  = null;
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
  const _refOutIds = new Set(), _refInIds = new Set();
  const _extOutIds = new Set(), _extInIds = new Set();
  const _m2mIds = new Set(), _relIds = new Set();
  const _viewIds = new Set(), _cmdbRelIds = new Set();
  const _childrenOf = new Map();

  for (const e of data.edges) {
    const s = e._sourceId, t = e._targetId;
    if (e.type === 'reference') { _refOutIds.add(s); _refInIds.add(t); }
    if (e.type === 'extends')   {
      _extOutIds.add(s); _extInIds.add(t);
      if (!_childrenOf.has(t)) _childrenOf.set(t, []);
      _childrenOf.get(t).push(s);
    }
    if (e.type === 'm2m')       { _m2mIds.add(s);    _m2mIds.add(t); }
    if (e.type === 'rel')       { _relIds.add(s);     _relIds.add(t); }
    if (e.type === 'view')      { _viewIds.add(s);    _viewIds.add(t); }
    if (e.type === 'cmdb_rel')  { _cmdbRelIds.add(s); _cmdbRelIds.add(t); }
  }
  // BFS from cmdb_ci to collect the full CI hierarchy (for tableType:'cmdb' filter)
  const _cmdbCiIds = new Set();
  if (data._nodeById.has('cmdb_ci')) {
    const q = ['cmdb_ci'], seen = new Set(q);
    while (q.length) {
      const id = q.shift(); _cmdbCiIds.add(id);
      (_childrenOf.get(id) || []).forEach(c => { if (!seen.has(c)) { seen.add(c); q.push(c); } });
    }
  }
  Object.assign(data, { _refOutIds, _refInIds, _extOutIds, _extInIds,
                        _m2mIds, _relIds, _viewIds, _cmdbRelIds, _cmdbCiIds });

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
    const _openBar  = () => {
      Dom.filterBar?.classList.add('open');
      if (Dom.filterBody?._rebuildFilterPanel) Dom.filterBody._rebuildFilterPanel();
    };

    Dom.filterOpenBtn.addEventListener('click', () => {
      Dom.filterBar?.classList.contains('open') ? _closeBar() : _openBar();
    });

    // Escape key closes the bar
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeBar(); });
  }

  updateMaxNodesSlider();
  updateHopDepthSlider();
  render();
  // Enable all view-mode buttons + nav controls now that data is present.
  // Each feature module controls its own button's *visibility*; the load
  // module is only responsible for the enabled/disabled state.
  document.querySelectorAll('#view-mode-seg .vms-btn, #btn-refresh, #btn-reset, #btn-export')
    .forEach(btn => { btn.disabled = false; btn.classList.remove('btn-nav-disabled'); });
  Dom.edgeLegend.style.display = 'block';
  syncLegendRows();
  Dom.densityGroup.style.display = 'block';
  Dom.sortBar.style.display = 'flex';

  const preselect = data._nodeById.get('task') ||
    data.nodes.slice()
      .sort((a, b) => (data._edgeCnt[b.id] || 0) - (data._edgeCnt[a.id] || 0))[0];
  if (preselect) focusTable(preselect.id);
  refreshReferenceTableLinks();
}

export function promptMultiPartLoad(manifest) {
  const expected = manifest.parts.map(p => p.fileName).sort();
  const msg = `This is a multi-part schema export (${manifest.parts.length} parts, ${(manifest.totalBytes/1048576).toFixed(1)} MB total).\n\n` +
    `Select all of these part files in the next dialog:\n  ${expected.join('\n  ')}\n\n` +
    `Tip: in the file picker you can multi-select with Ctrl+click (Cmd+click on Mac).`;
  if (!confirm(msg + '\n\nOK to pick the part files now?')) return;
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.multiple = true;
  picker.addEventListener('change', ev => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    const byName = new Map(files.map(f => [f.name, f]));
    const missing = expected.filter(name => !byName.has(name));
    if (missing.length) { alert('Missing part files:\n' + missing.join('\n')); return; }
    (async () => {
      try {
        const ordered = manifest.parts.slice().sort((a,b) => a.idx - b.idx);
        const texts = [];
        for (const p of ordered) texts.push(await byName.get(p.fileName).text());
        const parsed = JSON.parse(texts.join(''));
        texts.length = 0;
        loadGraph(parsed);
      } catch (err) {
        alert('Failed to stitch parts: ' + (err.message || err));
      }
    })();
  });
  picker.click();
}

async function loadFileList(files) {
  if (!files || !files.length) return;

  if (files.length === 1) {
    const f = files[0];
    const r = new FileReader();
    r.onload = ev => {
      const raw = ev.target.result;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed._manifest_version && Array.isArray(parsed.parts)) {
          promptMultiPartLoad(parsed);
          return;
        }
        loadGraph(parsed);
      } catch(err) {
        const msg = err.message || String(err);
        const posMatch = msg.match(/position (\d+)/i);
        let detail = msg;
        if (posMatch) {
          const pos = parseInt(posMatch[1]);
          const start = Math.max(0, pos - 40);
          const snippet = raw.slice(start, pos + 40).replace(/\n/g, '↵');
          const arrow   = ' '.repeat(Math.min(pos - start, 40)) + '▲';
          detail = `${msg}\n\nNear position ${pos}:\n"…${snippet}…"\n  ${arrow}`;
        }
        alert('Could not load JSON file:\n\n' + detail);
      }
    };
    r.readAsText(f);
    return;
  }

  try {
    const byName = new Map(Array.from(files).map(f => [f.name, f]));
    const manifestFile = Array.from(files).find(f => /\.manifest\.json$/i.test(f.name));
    if (!manifestFile) {
      alert('Multiple files selected but none look like a schema manifest (*.manifest.json).');
      return;
    }
    const manifest = JSON.parse(await manifestFile.text());
    if (!manifest._manifest_version || !Array.isArray(manifest.parts)) {
      alert('Manifest is missing _manifest_version or parts.');
      return;
    }
    const missing = manifest.parts.map(p => p.fileName).filter(n => !byName.has(n));
    if (missing.length) { alert('Missing part files:\n' + missing.join('\n')); return; }
    const ordered = manifest.parts.slice().sort((a,b) => a.idx - b.idx);
    const texts = [];
    for (const p of ordered) texts.push(await byName.get(p.fileName).text());
    const parsed = JSON.parse(texts.join(''));
    texts.length = 0;
    loadGraph(parsed);
  } catch (err) {
    alert('Failed to load multi-part schema:\n\n' + (err.message || err));
  }
}

function toggleSetupGuide(btn) {
  const bodyId = btn.id.replace('sg-toggle-', 'sg-body-');
  const body = document.getElementById(bodyId);
  const open = btn.classList.toggle('open');
  body.classList.toggle('open', open);
}

function copyCode(btn) {
  const pre = btn.closest('.code-block').querySelector('pre');
  navigator.clipboard.writeText(pre.textContent.trim()).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    btn.style.color = 'var(--sn-wasabi)';
    btn.style.borderColor = 'var(--sn-wasabi)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 1800);
  }).catch(() => {
    btn.textContent = 'Error';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
}

export function initLoadOverlay() {
  Dom.btnDemo.addEventListener('click', () => loadGraph(DEMO_DATA));

  Dom.fileInput.addEventListener('change', e => {
    loadFileList(e.target.files);
  });

  const dz = Dom.dropZone;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dragover');
    loadFileList(e.dataTransfer.files);
  });

  document.querySelectorAll('.ov-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ov-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.ov-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // Setup guide toggle + code copy (file tab)
  document.getElementById('sg-toggle-file')
    ?.addEventListener('click', e => toggleSetupGuide(e.currentTarget));
  document.querySelectorAll('.code-copy-btn')
    .forEach(btn => btn.addEventListener('click', e => copyCode(e.currentTarget)));
}

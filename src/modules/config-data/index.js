/* ============================================================================
 * config-data/index.js — N-way comparison workspace (v1.0.3)
 * ============================================================================
 *
 * The cross-instance comparison tool. Registers a workspace (engine/workspace)
 * and a landing card icon (modules/landing), gated behind a Settings feature.
 * Reconciliation is pure logic in ./reconcile.js; rendering is pure DOM in
 * ./table-view.js (no D3). The clean-shell rules in styles/workspace.css hide
 * the graph chrome while this workspace is active.
 * ============================================================================ */

import {
  instancesState,
  aggregateCapabilities,
  METADATA_SECTIONS,
  getInstance,
  diffState,
} from '../../core/state.js';
import { setCompareIds } from '../../core/focus-state.js';
import { Settings } from '../settings/index.js';
import {
  setWorkspace,
  getWorkspace,
  registerWorkspace,
  onWorkspaceChange,
} from '../../core/workspace.js';
import { registerSwitcherTool, refreshToolSwitcher } from '../../core/tool-switcher.js';
import { registerTool, refreshLanding } from '../landing/index.js';
import { reconcile, reconcileToCsv, reconcileToJson, SECTION_LABELS } from './reconcile.js';
import { renderComparisonTable } from './table-view.js';
import { instancesComparisonHtml } from '../../core/instance-info.js';
import { createDropdown } from '../../core/dropdown.js';
import { setConfigExportHook } from '../export/index.js';
import { registerCompareProvider, refreshHeaderCompare } from '../../core/header-compare.js';
import { setConfigBaseHandler, refreshHeaderInstance } from '../../core/header-instance.js';

// Sentinel section key for the always-present Instance Data tab. Not a metadata
// section — it renders the instance identity / runtime / export + a schema-stats
// comparison across every registered instance (see core/instance-info.js).
const INSTANCE_TAB = '__instance__';

// ── Settings feature ──────────────────────────────────────────────────────
Settings.registerFeature({
  key: 'configData',
  label: 'Configuration Data',
  description:
    'Adds a cross-instance comparison tool that reconciles plugins, store apps, custom apps, and system properties across the instances you register, highlighting version drift, missing entries, and active-state mismatches.',
  default: false,
  category: 'features',
});

registerWorkspace({ key: 'config-data', root: '#config-data' });

// ── View state ────────────────────────────────────────────────────────────
// Columns mirror the Schema Map model (#1): a BASE instance (the header instance
// dropdown = instancesState.selectedId) plus COMPARES. The compare selection is
// SHARED with the Schema Map via diffState._compareIds, so picking compares in
// either tool carries to the other. Default = none (just the base column).
const view = { section: null, search: '', filter: 'all', showDates: false };

// The base column — the header instance dropdown. Falls back to the first
// registered instance when nothing is loaded yet.
function baseId() {
  return instancesState.selectedId || instancesState.instances[0]?.id || null;
}

// The compare columns (ids) — the shared diffState._compareIds, minus the base
// and any stale ids. Empty by default (the user picks compares from the header).
function compareIdList() {
  const b = baseId();
  const valid = new Set(instancesState.instances.map(e => e.id));
  return diffState._compareIds.filter(id => id !== b && valid.has(id));
}

// The instances shown as columns: base first, then the compares in registry order.
function selectedInstances() {
  const b = baseId();
  const compset = new Set(compareIdList());
  const baseEntry = instancesState.instances.find(e => e.id === b);
  const others = instancesState.instances.filter(e => e.id !== b && compset.has(e.id));
  return [baseEntry, ...others].filter(Boolean);
}

// How many of the *selected* instances carry a given metadata section.
function sectionCarriers(section) {
  return selectedInstances().filter(e => e.capabilities && e.capabilities[section]).length;
}

// Sections that ≥1 selected instance carries. A single instance shows one
// column; two or more light up drift / missing / state-mismatch.
function comparableSections() {
  return METADATA_SECTIONS.filter(s => sectionCarriers(s) >= 1);
}

// Tool-enablement (landing card) is based on ALL registered instances, not the
// in-workspace selection — the workspace is reachable whenever any instance
// carries a section.
function hasComparable() {
  const agg = aggregateCapabilities();
  return METADATA_SECTIONS.some(s => agg[s] && agg[s].count >= 1);
}

// ── Instance selection: the shared header Base + Compare controls (#1) ────────
// Configuration Data drives its columns from the header — the instance dropdown
// (base column) + the Compare multi-select (other columns) — the same UX as the
// Schema Map. The old in-workspace #cd-instances chip picker is gone.

// Header instance dropdown picks the base column (no graph load in this workspace).
setConfigBaseHandler(id => {
  if (!id) return;
  instancesState.selectedId = id;
  // The new base can't also be a compare; drop it from the shared selection.
  setCompareIds(diffState._compareIds.filter(x => x !== id));
  renderCompare();
});

// Header Compare provider — the compare columns, SHARED with the Schema Map via
// diffState._compareIds (setCompareIds). Symmetric N-way, so no base↔primary swap.
registerCompareProvider({
  eligible: () => getWorkspace() === 'config-data' && instancesState.instances.length >= 2,
  getSelected: () => compareIdList(),
  getCandidates: () =>
    instancesState.instances
      .filter(e => e.id !== baseId())
      .map(e => ({ id: e.id, label: e.label })),
  labelFor: id => getInstance(id)?.label || id,
  onToggle: id => {
    const cur = new Set(compareIdList());
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    // Store in registry order, excluding the base. Shared with the Schema Map.
    setCompareIds(
      instancesState.instances.map(e => e.id).filter(x => x !== baseId() && cur.has(x))
    );
    renderCompare();
  },
  onClear: () => {
    setCompareIds([]);
    renderCompare();
  },
});

function renderTabs() {
  const host = document.getElementById('cd-tabs');
  if (!host) return;
  host.textContent = '';

  // Instance Data tab — always present whenever ≥1 selected instance exists.
  const instCount = selectedInstances().length;
  const instBtn = document.createElement('button');
  instBtn.className = 'cd-tab' + (view.section === INSTANCE_TAB ? ' active' : '');
  instBtn.disabled = instCount < 1;
  instBtn.dataset.section = INSTANCE_TAB;
  instBtn.title =
    instCount < 1
      ? 'Instance Data — register an instance to view it here'
      : `Instance Data — ${instCount} instance${instCount === 1 ? '' : 's'}`;
  instBtn.textContent = 'Instance Data';
  if (instCount >= 1) {
    instBtn.addEventListener('click', () => {
      view.section = INSTANCE_TAB;
      renderCompare();
    });
  }
  host.appendChild(instBtn);

  METADATA_SECTIONS.forEach(section => {
    const carriers = sectionCarriers(section);
    const enabled = carriers >= 1;
    const btn = document.createElement('button');
    btn.className = 'cd-tab' + (section === view.section ? ' active' : '');
    btn.disabled = !enabled;
    btn.dataset.section = section;
    btn.title = enabled
      ? `${SECTION_LABELS[section]} — ${carriers} instance${carriers === 1 ? '' : 's'}`
      : `${SECTION_LABELS[section]} — needs an instance with this data`;
    btn.textContent = SECTION_LABELS[section];
    if (enabled) {
      btn.addEventListener('click', () => {
        view.section = section;
        renderCompare();
      });
    }
    host.appendChild(btn);
  });
}

function renderStats(result) {
  const host = document.getElementById('cd-stats');
  if (!host) return;
  host.textContent = '';
  const total = result.rows.length;
  const c = result.counts;
  const tiles = [
    { v: total, k: 'Entries' },
    { v: c.sync, k: 'In sync', cls: 'cd-stat-sync' },
    { v: c.drift, k: 'Version drift', cls: 'cd-stat-drift' },
    { v: c.missing, k: 'Missing', cls: 'cd-stat-missing' },
    { v: c.active + c.inactive, k: 'State issues', cls: 'cd-stat-state' },
  ];
  tiles.forEach(t => {
    const el = document.createElement('div');
    el.className = 'cd-stat' + (t.cls ? ' ' + t.cls : '');
    el.innerHTML =
      '<div class="cd-stat-v">' + t.v + '</div><div class="cd-stat-k">' + t.k + '</div>';
    host.appendChild(el);
  });
}

function currentResult() {
  // Compare across the selected instances; reconcile() keeps only those that
  // carry the section as the table's columns.
  return reconcile(view.section, selectedInstances());
}

// Reflect the active section in the header Export bar's config row: name the
// section, and disable CSV/JSON when there is nothing tabular to export.
function syncConfigExportBar() {
  const labelEl = document.getElementById('export-cd-section');
  const hintEl = document.getElementById('export-cd-hint');
  const setBtns = on => {
    ['epb-cd-csv', 'epb-cd-json'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.disabled = !on;
    });
  };
  const setHint = txt => {
    if (!hintEl) return;
    hintEl.hidden = !txt;
    hintEl.textContent = txt || '';
  };

  if (view.section === INSTANCE_TAB) {
    if (labelEl) labelEl.textContent = 'Instance Data';
    setBtns(false);
    setHint('Instance Data isn’t a table — pick a section to export.');
    return;
  }

  if (labelEl) labelEl.textContent = SECTION_LABELS[view.section] || 'comparison';
  if (!comparableSections().length) {
    setBtns(false);
    setHint('No section data to export.');
    return;
  }
  const rows = currentResult().rows.length;
  setBtns(rows > 0);
  setHint(rows ? '' : 'No rows to export.');
}

// Map a registry entry to an instance-info scope. Un-loaded placeholders
// (data:null) still expose identity/runtime from their persisted `meta`.
function scopeFromEntry(e) {
  const d = e.data;
  return {
    label: e.label,
    loaded: !!d,
    instance: (d && d._instance) || e.meta || {},
    stats: d && d._stats,
    capabilities: d && d._capabilities,
    build: d && d._build,
    version: d && d._schema_version,
  };
}

// Toggle between the metadata-comparison view and the Instance Data panel.
function showInstanceMode(on) {
  const controls = document.querySelector('#config-data .cd-controls');
  const stats = document.getElementById('cd-stats');
  const tableWrap = document.getElementById('cd-table-wrap');
  const empty = document.getElementById('cd-empty');
  const inst = document.getElementById('cd-instance');
  if (controls) controls.style.display = on ? 'none' : '';
  if (stats) stats.style.display = on ? 'none' : '';
  if (inst) inst.style.display = on ? '' : 'none';
  if (on) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (empty) empty.style.display = 'none';
  }
}

function renderInstanceData() {
  const host = document.getElementById('cd-instance');
  if (!host) return;
  const scopes = selectedInstances().map(scopeFromEntry);
  host.innerHTML = scopes.length ? instancesComparisonHtml(scopes) : '';
}

function renderCompare() {
  refreshHeaderInstance();
  refreshHeaderCompare();
  const sections = comparableSections();
  const hasInstances = selectedInstances().length > 0;
  // Keep the Instance Data tab if chosen; otherwise pick a valid metadata
  // section, falling back to Instance Data when instances exist but carry no
  // metadata sections (so the workspace is never blank).
  if (view.section !== INSTANCE_TAB && !sections.includes(view.section)) {
    view.section = sections[0] || (hasInstances ? INSTANCE_TAB : METADATA_SECTIONS[0]);
  }
  renderTabs();

  // Keep the header Export bar (CSV/JSON) in step with the active section: it
  // names what will be exported and disables when there's nothing tabular to
  // export (Instance Data tab, no sections, or no rows after filtering).
  syncConfigExportBar();

  if (view.section === INSTANCE_TAB) {
    showInstanceMode(true);
    renderInstanceData();
    return;
  }
  showInstanceMode(false);

  const empty = document.getElementById('cd-empty');
  const tableWrap = document.getElementById('cd-table-wrap');

  if (!sections.length) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      empty.textContent =
        'Register at least one instance carrying a metadata section (plugins, store apps, custom apps, or properties) to view it here. Add more instances to compare them. Re-export with the metadata sections enabled if a section is empty.';
    }
    renderStats({ rows: [], counts: { sync: 0, drift: 0, missing: 0, active: 0, inactive: 0 } });
    return;
  }

  const result = currentResult();
  renderStats(result);

  const table = document.getElementById('cd-table');
  const rendered = renderComparisonTable(result, {
    search: view.search,
    filter: view.filter,
    showDates: view.showDates,
  });
  if (table) table.replaceWith(rendered);

  const visibleRows = rendered.querySelectorAll('tbody tr').length;
  if (tableWrap) tableWrap.style.display = visibleRows ? '' : 'none';
  if (empty) {
    empty.style.display = visibleRows ? 'none' : 'block';
    if (!visibleRows) empty.textContent = 'No entries match the current filter.';
  }
}

// ── Public entry ──────────────────────────────────────────────────────────
export function openConfigData() {
  setWorkspace('config-data');
  // Ensure a base column is set so the header instance dropdown reflects it even
  // when Config Data is opened without a graph loaded.
  if (!instancesState.selectedId && instancesState.instances[0]) {
    instancesState.selectedId = instancesState.instances[0].id;
  }
  // renderCompare runs via the onWorkspaceChange hook below; call directly too
  // so a re-open while already active still refreshes.
  renderCompare();
}

// ── Init ────────────────────────────────────────────────────────────────────
export function initConfigData() {
  const search = document.getElementById('cd-search');
  if (search) {
    search.addEventListener('input', () => {
      view.search = search.value;
      renderCompare();
    });
  }
  const filterMount = document.getElementById('cd-filter');
  if (filterMount) {
    const filterDD = createDropdown({
      title: 'Filter rows by status',
      ariaLabel: 'Filter rows by status',
      onChange: val => {
        view.filter = val;
        renderCompare();
      },
    });
    filterDD.setOptions(
      [
        { value: 'all', label: 'All rows' },
        { value: 'diff', label: 'Differences only' },
        { value: 'missing', label: 'Missing somewhere' },
        { value: 'drift', label: 'Version drift' },
        { value: 'active', label: 'State mismatch' },
        { value: 'inactive', label: 'Inactive everywhere' },
      ],
      view.filter
    );
    filterMount.appendChild(filterDD.el);
  }
  const showDates = document.getElementById('cd-showdates');
  if (showDates) {
    showDates.addEventListener('change', () => {
      view.showDates = showDates.checked;
      renderCompare();
    });
  }
  const download = (text, mime, ext) => {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = view.section + '_configuration.' + ext;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  // Export CSV / JSON now lives in the header Export bar (view-aware). The bar
  // calls back here via setConfigExportHook so this module owns the data + format
  // while the export module owns the UI. Exports the active section comparison.
  setConfigExportHook(fmt => {
    const result = currentResult();
    if (!result.rows.length) return;
    if (fmt === 'csv') download(reconcileToCsv(result), 'text/csv', 'csv');
    else if (fmt === 'json')
      download(JSON.stringify(reconcileToJson(result), null, 2), 'application/json', 'json');
  });

  // Re-render whenever this workspace becomes active, and make sure the header
  // Export button is live (it starts disabled until a graph schema loads, but
  // Config Data can be reached without one).
  onWorkspaceChange(ws => {
    if (ws !== 'config-data') return;
    const btnExport = document.getElementById('btn-export');
    if (btnExport) {
      btnExport.disabled = false;
      btnExport.classList.remove('btn-nav-disabled');
    }
    renderCompare();
  });

  // Landing card icon — launches the (global) Configuration Data workspace.
  // Enabled when the feature is on AND ≥1 instance carries a metadata section
  // (one instance = a single column; more light up drift / missing / mismatch).
  registerTool({
    key: 'configData',
    label: 'Configuration Data',
    icon: '▦',
    requires: [],
    minInstances: 1,
    enabled: () => Settings.isEnabled('configData') && hasComparable(),
    disabledHint:
      'Enable Configuration Data in Settings; needs an instance carrying a metadata section',
    enter: () => openConfigData(),
  });

  // Header tool switcher entry — its own workspace, available whenever the
  // landing tool is (feature on + ≥1 instance carries a metadata section).
  registerSwitcherTool({
    key: 'config',
    label: 'Config',
    icon: '▦',
    title: 'Configuration Data',
    order: 40,
    enabled: () => Settings.isEnabled('configData') && hasComparable(),
    isActive: () => getWorkspace() === 'config-data',
    activate: () => openConfigData(),
  });

  // Reflect the icon's enabled state on the landing page + header switcher when
  // the feature toggles.
  Settings.onChange('configData', () => {
    refreshLanding();
    refreshToolSwitcher();
  });
}

// Self-initialise at module load (mirrors schema-diff). full.js imports this
// module after lite.js has run initLanding(), so the landing host + DOM region
// exist and registerTool re-renders the cards with the comparison icon.
initConfigData();

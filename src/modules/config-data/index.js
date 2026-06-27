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

import { instancesState, aggregateCapabilities, METADATA_SECTIONS } from '../../core/state.js';
import { Settings } from '../settings/index.js';
import { setWorkspace, registerWorkspace, onWorkspaceChange } from '../../core/workspace.js';
import { registerTool, refreshLanding } from '../landing/index.js';
import { reconcile, reconcileToCsv, SECTION_LABELS } from './reconcile.js';
import { renderComparisonTable } from './table-view.js';

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
const view = { section: null, search: '', filter: 'all', showDates: false };

// Sections that ≥1 registered instance carries. A single instance shows one
// column; two or more light up drift / missing / state-mismatch.
function comparableSections() {
  const agg = aggregateCapabilities();
  return METADATA_SECTIONS.filter(s => agg[s] && agg[s].count >= 1);
}

function hasComparable() {
  return comparableSections().length > 0;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderTabs() {
  const host = document.getElementById('cd-tabs');
  if (!host) return;
  host.textContent = '';
  const agg = aggregateCapabilities();
  METADATA_SECTIONS.forEach(section => {
    const carriers = (agg[section] && agg[section].count) || 0;
    const enabled = carriers >= 1;
    const btn = document.createElement('button');
    btn.className = 'cd-tab' + (section === view.section ? ' active' : '');
    btn.disabled = !enabled;
    btn.dataset.section = section;
    btn.title = enabled
      ? `${SECTION_LABELS[section]} — ${carriers} instance${carriers === 1 ? '' : 's'}`
      : `${SECTION_LABELS[section]} — needs an instance with this data`;
    btn.textContent = SECTION_LABELS[section];
    if (carriers) {
      const cnt = document.createElement('span');
      cnt.className = 'cd-tab-cnt';
      cnt.textContent = carriers;
      btn.appendChild(cnt);
    }
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
  // Compare across every registered instance; reconcile() keeps only those that
  // carry the section as the table's columns.
  return reconcile(view.section, instancesState.instances);
}

function renderCompare() {
  const sections = comparableSections();
  // Pick/keep a valid section.
  if (!view.section || !sections.includes(view.section)) {
    view.section = sections[0] || METADATA_SECTIONS[0];
  }
  renderTabs();

  const empty = document.getElementById('cd-empty');
  const tableWrap = document.getElementById('cd-table-wrap');
  const exportBtn = document.getElementById('cd-export');

  if (!sections.length) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      empty.textContent =
        'Register at least one instance carrying a metadata section (plugins, store apps, custom apps, or properties) to view it here. Add more instances to compare them. Re-export with the metadata sections enabled if a section is empty.';
    }
    renderStats({ rows: [], counts: { sync: 0, drift: 0, missing: 0, active: 0, inactive: 0 } });
    if (exportBtn) exportBtn.disabled = true;
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
  if (exportBtn) exportBtn.disabled = !result.rows.length;
}

// ── Public entry ──────────────────────────────────────────────────────────
export function openConfigData() {
  setWorkspace('config-data');
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
  const filter = document.getElementById('cd-filter');
  if (filter) {
    filter.addEventListener('change', () => {
      view.filter = filter.value;
      renderCompare();
    });
  }
  const showDates = document.getElementById('cd-showdates');
  if (showDates) {
    showDates.addEventListener('change', () => {
      view.showDates = showDates.checked;
      renderCompare();
    });
  }
  const exportBtn = document.getElementById('cd-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const result = currentResult();
      if (!result.rows.length) return;
      const csv = reconcileToCsv(result);
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = view.section + '_configuration.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // Re-render whenever this workspace becomes active.
  onWorkspaceChange(ws => {
    if (ws === 'config-data') renderCompare();
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

  // Reflect the icon's enabled state on the landing page when the feature toggles.
  Settings.onChange('configData', () => refreshLanding());
}

// Self-initialise at module load (mirrors schema-diff). full.js imports this
// module after lite.js has run initLanding(), so the landing host + DOM region
// exist and registerTool re-renders the cards with the comparison icon.
initConfigData();

/* ============================================================================
 * instance-compare/index.js — N-way comparison workspace (v1.0.3)
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
import { setWorkspace, registerWorkspace, onWorkspaceChange } from '../../engine/workspace.js';
import { registerTool, refreshLanding } from '../landing/index.js';
import { reconcile, reconcileToCsv, SECTION_LABELS } from './reconcile.js';
import { renderComparisonTable } from './table-view.js';

// ── Settings feature ──────────────────────────────────────────────────────
Settings.registerFeature({
  key: 'instanceCompare',
  label: 'Instance Comparison',
  description:
    'Adds a cross-instance comparison tool that reconciles plugins, store apps, custom apps, and system properties across the instances you register, highlighting version drift, missing entries, and active-state mismatches.',
  default: false,
  category: 'features',
});

registerWorkspace({ key: 'instance-comparison', root: '#instance-compare' });

// ── View state ────────────────────────────────────────────────────────────
const view = { section: null, search: '', filter: 'all', showDates: false };

// Sections that ≥2 registered instances carry — the ones worth comparing.
function comparableSections() {
  const agg = aggregateCapabilities();
  return METADATA_SECTIONS.filter(s => agg[s] && agg[s].count >= 2);
}

function hasComparable() {
  return comparableSections().length > 0;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderTabs() {
  const host = document.getElementById('ic-tabs');
  if (!host) return;
  host.textContent = '';
  const agg = aggregateCapabilities();
  METADATA_SECTIONS.forEach(section => {
    const carriers = (agg[section] && agg[section].count) || 0;
    const enabled = carriers >= 2;
    const btn = document.createElement('button');
    btn.className = 'ic-tab' + (section === view.section ? ' active' : '');
    btn.disabled = !enabled;
    btn.dataset.section = section;
    btn.title = enabled
      ? `${SECTION_LABELS[section]} — ${carriers} instances`
      : `${SECTION_LABELS[section]} — needs 2 instances with this data`;
    btn.textContent = SECTION_LABELS[section];
    if (carriers) {
      const cnt = document.createElement('span');
      cnt.className = 'ic-tab-cnt';
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
  const host = document.getElementById('ic-stats');
  if (!host) return;
  host.textContent = '';
  const total = result.rows.length;
  const c = result.counts;
  const tiles = [
    { v: total, k: 'Entries' },
    { v: c.sync, k: 'In sync', cls: 'ic-stat-sync' },
    { v: c.drift, k: 'Version drift', cls: 'ic-stat-drift' },
    { v: c.missing, k: 'Missing', cls: 'ic-stat-missing' },
    { v: c.active + c.inactive, k: 'State issues', cls: 'ic-stat-state' },
  ];
  tiles.forEach(t => {
    const el = document.createElement('div');
    el.className = 'ic-stat' + (t.cls ? ' ' + t.cls : '');
    el.innerHTML =
      '<div class="ic-stat-v">' + t.v + '</div><div class="ic-stat-k">' + t.k + '</div>';
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

  const empty = document.getElementById('ic-empty');
  const tableWrap = document.getElementById('ic-table-wrap');
  const exportBtn = document.getElementById('ic-export');

  if (!sections.length) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      empty.textContent =
        'Register at least two instances that share a metadata section (plugins, store apps, custom apps, or properties) to compare them. Re-export with the metadata sections enabled if a section is empty.';
    }
    renderStats({ rows: [], counts: { sync: 0, drift: 0, missing: 0, active: 0, inactive: 0 } });
    if (exportBtn) exportBtn.disabled = true;
    return;
  }

  const result = currentResult();
  renderStats(result);

  const table = document.getElementById('ic-table');
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
export function openComparison() {
  setWorkspace('instance-comparison');
  // renderCompare runs via the onWorkspaceChange hook below; call directly too
  // so a re-open while already active still refreshes.
  renderCompare();
}

// ── Init ────────────────────────────────────────────────────────────────────
export function initInstanceCompare() {
  const search = document.getElementById('ic-search');
  if (search) {
    search.addEventListener('input', () => {
      view.search = search.value;
      renderCompare();
    });
  }
  const filter = document.getElementById('ic-filter');
  if (filter) {
    filter.addEventListener('change', () => {
      view.filter = filter.value;
      renderCompare();
    });
  }
  const showDates = document.getElementById('ic-showdates');
  if (showDates) {
    showDates.addEventListener('change', () => {
      view.showDates = showDates.checked;
      renderCompare();
    });
  }
  const exportBtn = document.getElementById('ic-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const result = currentResult();
      if (!result.rows.length) return;
      const csv = reconcileToCsv(result);
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = view.section + '_comparison.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // Re-render whenever this workspace becomes active.
  onWorkspaceChange(ws => {
    if (ws === 'instance-comparison') renderCompare();
  });

  // Landing card icon — launches the (global) comparison workspace. Enabled only
  // when the feature is on AND ≥2 instances share a metadata section.
  registerTool({
    key: 'instanceCompare',
    label: 'Compare instances',
    icon: '▦',
    requires: [],
    minInstances: 2,
    enabled: () => Settings.isEnabled('instanceCompare') && hasComparable(),
    disabledHint: 'Enable Instance Comparison in Settings; needs 2 instances sharing a section',
    enter: () => openComparison(),
  });

  // Reflect the icon's enabled state on the landing page when the feature toggles.
  Settings.onChange('instanceCompare', () => refreshLanding());
}

// Self-initialise at module load (mirrors schema-diff). full.js imports this
// module after lite.js has run initLanding(), so the landing host + DOM region
// exist and registerTool re-renders the cards with the comparison icon.
initInstanceCompare();

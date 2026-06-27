/* ============================================================================
 * schema-diff/config-list.js — the Diff sidebar Configuration block (#139b)
 * ============================================================================
 *
 * The third pillar of the config-drift layer: an overview + navigation surface in
 * the Diff sidebar, mirroring the structural diff summary/list. It adds a
 * Configuration summary (In sync / Drift / Missing / State, clickable to filter)
 * and a navigable list of the apps that changed between base and compare. Picking
 * an app highlights the tables it owns on the canvas — which is how a
 * config-only-drifted table (absent from the structural diff list) becomes
 * reachable.
 *
 * Built in JS and appended to #diff-sidebar so no Prettier-ignored partial is
 * touched. Opt-in: hidden unless both sides exported app metadata (appDriftSummary
 * .comparable) and a diff is loaded.
 * ============================================================================ */

import { graphState, diffState, instancesState, getInstance } from '../../core/state.js';
import { render } from '../../core/render.js';
import { focusTable } from '../../core/inspector.js';
import { appDriftSummary, tablesForApp } from './config-drift.js';
import { STATUS_LABELS } from '../config-data/reconcile.js';

const TILES = [
  ['drift', 'Drift'],
  ['missing', 'Missing'],
  ['active', 'State'],
  ['sync', 'In sync'],
];

let _block = null;

function baseData() {
  return getInstance(instancesState.selectedId)?.data;
}
function compareData() {
  return getInstance(diffState._compareId)?.data;
}

function ensureBlock() {
  if (_block) return _block;
  const sidebar = document.getElementById('diff-sidebar');
  if (!sidebar) return null;
  const block = document.createElement('div');
  block.id = 'diff-config';
  block.style.display = 'none';
  const header = document.createElement('div');
  header.className = 'diff-config-header';
  header.textContent = 'Configuration';
  const summary = document.createElement('div');
  summary.id = 'diff-config-summary';
  summary.className = 'diff-config-summary';
  const list = document.createElement('div');
  list.id = 'diff-config-list';
  list.className = 'diff-config-list';
  block.append(header, summary, list);
  sidebar.appendChild(block);
  _block = block;
  return block;
}

export function diffBuildConfigList() {
  const block = ensureBlock();
  if (!block) return;
  const summary = appDriftSummary(baseData(), compareData());

  // Opt-in: no app metadata on both sides (or no diff loaded) → no config block.
  if (!summary.comparable || !diffState._diffData) {
    block.style.display = 'none';
    return;
  }
  block.style.display = '';

  // Summary tiles (clickable filters).
  const sumEl = block.querySelector('#diff-config-summary');
  sumEl.innerHTML = '';
  for (const [status, label] of TILES) {
    const tile = document.createElement('div');
    tile.className =
      'diff-config-stat dcs-' + status + (diffState._configFilter === status ? ' active' : '');
    tile.dataset.status = status;
    const n = document.createElement('span');
    n.className = 'dcs-n';
    n.textContent = String(summary.counts[status] || 0);
    const l = document.createElement('span');
    l.className = 'dcs-label';
    l.textContent = label;
    tile.append(n, l);
    tile.addEventListener('click', () => {
      diffState._configFilter = diffState._configFilter === status ? 'all' : status;
      diffBuildConfigList();
    });
    sumEl.appendChild(tile);
  }

  // App list, filtered. 'all' = the changes (everything but sync/inactive).
  const listEl = block.querySelector('#diff-config-list');
  listEl.innerHTML = '';
  const filter = diffState._configFilter;
  const visible = summary.apps.filter(a =>
    filter === 'all' ? a.status !== 'sync' && a.status !== 'inactive' : a.status === filter
  );

  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'diff-field-absent';
    empty.textContent =
      filter === 'all'
        ? 'No configuration drift between these instances.'
        : 'No apps with this status.';
    listEl.appendChild(empty);
    return;
  }

  for (const a of visible) {
    const row = document.createElement('div');
    row.className =
      'diff-config-item dci-' +
      a.status +
      (diffState._activeConfigApp?.key === a.key ? ' active' : '');
    row.dataset.key = a.key;
    const pill = document.createElement('span');
    pill.className = 'diff-config-pill dcp-' + a.status;
    const names = document.createElement('div');
    names.className = 'dci-names';
    const name = document.createElement('div');
    name.className = 'dci-name';
    name.textContent = a.name;
    const ver = document.createElement('div');
    ver.className = 'dci-ver';
    ver.textContent = 'v' + (a.base?.version ?? '—') + ' → v' + (a.compare?.version ?? '—');
    names.append(name, ver);
    const status = document.createElement('span');
    status.className = 'dci-status';
    status.textContent = STATUS_LABELS[a.status] || a.status;
    row.append(pill, names, status);
    row.addEventListener('click', () => {
      const isActive = diffState._activeConfigApp?.key === a.key;
      if (isActive) {
        diffState._activeConfigApp = null;
        diffBuildConfigList();
        render(); // clears the highlight via diffApplyOverlays
        return;
      }
      diffState._activeConfigApp = { key: a.key, name: a.name };
      diffBuildConfigList();
      // Navigate: bring this app's tables into view (focus the first one) so a
      // config-only-drifted table — absent from the structural diff list — is
      // reachable. The overlay then highlights all owned tables now in view.
      const owned = tablesForApp(diffState._activeConfigApp, graphState.graphData?.nodes || []);
      if (owned.length) focusTable(owned[0], false);
      else render();
    });
    listEl.appendChild(row);
  }
}

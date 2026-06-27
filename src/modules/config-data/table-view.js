/* ============================================================================
 * config-data/table-view.js — N-column comparison table (pure DOM)
 * ============================================================================
 * Builds the comparison table from a reconcile() result. No D3; uses core
 * template h(). One column per loaded instance, plus Name / Key / Status.
 * ============================================================================ */

import { h } from '../../core/template.js';
import { SECTION_CONFIG, STATUS_LABELS } from './reconcile.js';

const STATUS_PILL = {
  sync: 'pill-on',
  drift: 'pill-warn',
  missing: 'pill-err',
  active: 'pill-info',
  inactive: 'pill-muted',
};

function dateShort(s) {
  return String(s || '')
    .trim()
    .split(/[ T]/)[0];
}

// Build one instance's cell for a row, shaped by the section's fields.
function instanceCell(rec, cfg, showDates) {
  if (!rec) return h('td', { class: 'cd-miss' }, '—');

  const children = [];

  if (cfg.fields.includes('active')) {
    const state = rec.active === true ? 'on' : rec.active === false ? 'off' : 'unk';
    children.push(h('span', { class: 'cd-dot cd-dot-' + state }));
  }

  if (cfg.fields.includes('version')) {
    children.push(h('span', { class: 'cd-ver' }, rec.version || '—'));
  } else if (cfg.fields.includes('value')) {
    // properties: show the value (or a redacted/none marker)
    const v = rec.value == null ? '«no value»' : String(rec.value);
    children.push(h('span', { class: 'cd-val' }, v));
  }

  // Store-app "update available" signal.
  if (cfg.fields.includes('updateAvailable')) {
    if (rec.updateAvailable === true) {
      const txt =
        rec.latestVersion && rec.latestVersion !== rec.version
          ? '↑ ' + rec.latestVersion
          : '↑ update';
      children.push(h('span', { class: 'cd-update', title: 'update_available' }, txt));
    } else if (rec.latestVersion && rec.latestVersion !== rec.version) {
      children.push(
        h(
          'span',
          { class: 'cd-update', title: 'latest_version ahead of installed' },
          '↑ ' + rec.latestVersion
        )
      );
    }
  }

  if (showDates && (rec.installDate || rec.updateDate)) {
    const parts = [];
    if (rec.installDate) parts.push('inst ' + dateShort(rec.installDate));
    if (rec.updateDate) parts.push('upd ' + dateShort(rec.updateDate));
    children.push(h('div', { class: 'cd-dates' }, parts.join(' · ')));
  }

  return h('td', {}, ...children);
}

function passesFilter(row, filter) {
  if (filter === 'all') return true;
  if (filter === 'diff') return row.status !== 'sync';
  return row.status === filter;
}

/**
 * Render the comparison <table> for a reconcile() result.
 * @returns {HTMLTableElement}
 */
export function renderComparisonTable(
  result,
  { search = '', filter = 'all', showDates = false } = {}
) {
  const cfg = SECTION_CONFIG[result.section];
  const loaded = result.instances;
  const q = search.trim().toLowerCase();

  // The Key column is redundant when it's the same field as Name (properties:
  // both are the property name). Drop it so the value columns get the space.
  const showKey = cfg.key !== cfg.name;

  const headCells = [h('th', {}, 'Name')];
  if (showKey) headCells.push(h('th', {}, 'Key'));
  loaded.forEach(i => headCells.push(h('th', {}, i.label)));
  headCells.push(h('th', {}, 'Status'));

  const view = result.rows.filter(
    r =>
      passesFilter(r, filter) &&
      (!q || r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q))
  );

  const bodyRows = view.map(r =>
    h(
      'tr',
      {},
      h('td', { class: 'cd-name' }, r.name),
      ...(showKey ? [h('td', { class: 'cd-key' }, r.key)] : []),
      ...loaded.map(i => instanceCell(r.cells[i.id], cfg, showDates)),
      h(
        'td',
        {},
        h(
          'span',
          { class: 'pill-badge ' + (STATUS_PILL[r.status] || 'pill-muted') },
          STATUS_LABELS[r.status] || r.status
        )
      )
    )
  );

  return h(
    'table',
    { id: 'cd-table', class: 'cd-table' },
    h('thead', {}, h('tr', {}, ...headCells)),
    h('tbody', {}, ...bodyRows)
  );
}

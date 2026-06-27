/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/modules/config-data/table-view.js (#104).
 * Pure DOM rendering of a reconcile() result: columns, status chips, the
 * store-app update indicator, active/inactive dots, dates toggle, and filtering.
 */
import { describe, it, expect } from 'vitest';
import { renderComparisonTable } from '../../../../src/modules/config-data/table-view.js';
import { reconcile } from '../../../../src/modules/config-data/reconcile.js';

const inst = (id, label, section, rows) => ({
  id,
  label,
  data: { _metadata: { [section]: rows } },
});
const P = (id, version, active) => ({ id, name: id, version, active });

describe('renderComparisonTable', () => {
  it('renders Name + one column per loaded instance + Status (no Key for plugins)', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true)]),
      inst('b', 'Test', 'plugins', [P('com.x', '1.0', true)]),
    ]);
    const table = renderComparisonTable(r);
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent);
    expect(heads).toEqual(['Name', 'Dev', 'Test', 'Status']);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('shows a status pill per row with the right modifier class', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true)]),
      inst('b', 'Test', 'plugins', [P('com.x', '2.0', true)]),
    ]);
    const pill = renderComparisonTable(r).querySelector('tbody .pill-badge');
    expect(pill.textContent).toBe('Drift');
    expect(pill.classList.contains('pill-warn')).toBe(true);
  });

  it('renders active/inactive/unknown dots and missing cells', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true)]),
      inst('b', 'Test', 'plugins', []), // com.x missing here
    ]);
    const row = renderComparisonTable(r).querySelector('tbody tr');
    const cells = row.querySelectorAll('td');
    // cells: name, Dev, Test, status (no Key for plugins)
    expect(cells[1].querySelector('.cd-dot-on')).toBeTruthy(); // Dev active
    expect(cells[2].classList.contains('cd-miss')).toBe(true); // Test missing
    expect(cells[2].textContent).toBe('—');
  });

  it('shows the store-app update indicator when update_available', () => {
    const r = reconcile('storeApps', [
      inst('a', 'Dev', 'storeApps', [
        {
          scope: 'x',
          name: 'App',
          version: '1.0',
          active: true,
          latestVersion: '1.2',
          updateAvailable: true,
        },
      ]),
      inst('b', 'Test', 'storeApps', [
        {
          scope: 'x',
          name: 'App',
          version: '1.2',
          active: true,
          latestVersion: '1.2',
          updateAvailable: false,
        },
      ]),
    ]);
    const table = renderComparisonTable(r);
    const upd = table.querySelector('.cd-update');
    expect(upd).toBeTruthy();
    expect(upd.textContent).toContain('1.2');
  });

  it('adds date lines only when showDates is on', () => {
    const rows = [
      { scope: 'x', name: 'App', version: '1', active: true, installDate: '2026-01-01' },
    ];
    const r = reconcile('storeApps', [
      inst('a', 'Dev', 'storeApps', rows),
      inst('b', 'Test', 'storeApps', rows),
    ]);
    expect(renderComparisonTable(r, { showDates: false }).querySelector('.cd-dates')).toBeNull();
    const withDates = renderComparisonTable(r, { showDates: true });
    expect(withDates.querySelector('.cd-dates').textContent).toContain('2026-01-01');
  });

  it('filters rows by search and status', () => {
    const mk = label =>
      inst(label, label, 'plugins', [
        P('com.x', '1.0', true),
        P('com.y', label === 'Dev' ? '1' : '2', true),
      ]);
    const r = reconcile('plugins', [mk('Dev'), mk('Test')]);
    // com.x is sync, com.y is drift
    expect(renderComparisonTable(r, { filter: 'drift' }).querySelectorAll('tbody tr')).toHaveLength(
      1
    );
    expect(renderComparisonTable(r, { search: 'com.x' }).querySelectorAll('tbody tr')).toHaveLength(
      1
    );
    expect(renderComparisonTable(r, { search: 'nope' }).querySelectorAll('tbody tr')).toHaveLength(
      0
    );
  });

  it('renders property values (no version/active dot)', () => {
    const r = reconcile('properties', [
      inst('a', 'Dev', 'properties', [{ name: 'glide.x', value: 'on', type: 'string' }]),
      inst('b', 'Test', 'properties', [{ name: 'glide.x', value: 'off', type: 'string' }]),
    ]);
    const table = renderComparisonTable(r);
    // Properties drop the redundant Key column (key === name) — columns are
    // Name | Dev | Test | Status, so the first instance cell is index 1.
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent);
    expect(heads).toEqual(['Name', 'Dev', 'Test', 'Status']);
    const devCell = table.querySelectorAll('tbody td')[1];
    expect(devCell.querySelector('.cd-val').textContent).toBe('on');
    expect(devCell.querySelector('.cd-dot')).toBeNull();
  });

  it('hides the Key column for plugins/storeApps/customApps (sys_ids differ across instances)', () => {
    for (const section of ['plugins', 'storeApps', 'customApps']) {
      const row =
        section === 'plugins'
          ? [P('com.x', '1.0', true)]
          : [{ scope: 'x', name: 'App', version: '1.0', active: true }];
      const r = reconcile(section, [inst('a', 'Dev', section, row)]);
      const heads = [...renderComparisonTable(r).querySelectorAll('thead th')].map(
        th => th.textContent
      );
      expect(heads).not.toContain('Key');
    }
  });
});

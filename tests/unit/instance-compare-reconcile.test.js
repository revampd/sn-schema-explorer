/**
 * Unit tests for src/viewer/modules/instance-compare/reconcile.js (#103).
 * Pure N-way reconciliation of metadata sections + CSV export. No DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcile,
  reconcileToCsv,
  SECTION_CONFIG,
  STATUS_LABELS,
} from '../../src/viewer/modules/instance-compare/reconcile.js';

// Build a registry-like instance entry carrying one metadata section.
function inst(id, label, section, rows) {
  return { id, label, data: { _metadata: { [section]: rows } } };
}

const P = (id, version, active, name) => ({ id, name: name || id, version, active });

describe('reconcile — union + cells', () => {
  it('unions keys across N (>2) instances and fills a cell per instance', () => {
    const a = inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true), P('com.y', '1.0', true)]);
    const b = inst('b', 'Test', 'plugins', [P('com.x', '1.0', true), P('com.z', '2.0', true)]);
    const c = inst('c', 'Prod', 'plugins', [P('com.x', '1.0', true)]);
    const r = reconcile('plugins', [a, b, c]);
    expect(r.instances).toHaveLength(3);
    expect(r.rows.map(x => x.key).sort()).toEqual(['com.x', 'com.y', 'com.z']);
    const x = r.rows.find(row => row.key === 'com.x');
    expect(x.cells.a.version).toBe('1.0');
    expect(x.cells.b.version).toBe('1.0');
    expect(x.cells.c.version).toBe('1.0');
  });

  it('excludes instances that do not carry the section', () => {
    const a = inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true)]);
    const b = { id: 'b', label: 'NoMeta', data: { nodes: [], edges: [] } }; // no _metadata
    const r = reconcile('plugins', [a, b]);
    expect(r.instances.map(i => i.id)).toEqual(['a']);
    // With a single loaded instance, its sole entry is "in sync".
    expect(r.rows[0].status).toBe('sync');
  });

  it('returns empty when no instance carries the section', () => {
    const b = { id: 'b', label: 'NoMeta', data: {} };
    const r = reconcile('plugins', [b]);
    expect(r.rows).toHaveLength(0);
    expect(r.instances).toHaveLength(0);
  });
});

describe('reconcile — status classification', () => {
  const a = id => inst('a', 'Dev', 'plugins', id);
  it('missing — absent from at least one instance', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true)]),
      inst('b', 'Test', 'plugins', []),
    ]);
    expect(r.rows.find(x => x.key === 'com.x').status).toBe('missing');
  });

  it('drift — same key, different version', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true)]),
      inst('b', 'Test', 'plugins', [P('com.x', '2.0', true)]),
    ]);
    expect(r.rows[0].status).toBe('drift');
  });

  it('active — same version, active differs', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true)]),
      inst('b', 'Test', 'plugins', [P('com.x', '1.0', false)]),
    ]);
    expect(r.rows[0].status).toBe('active');
  });

  it('inactive — same version, inactive everywhere', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', false)]),
      inst('b', 'Test', 'plugins', [P('com.x', '1.0', false)]),
    ]);
    expect(r.rows[0].status).toBe('inactive');
  });

  it('sync — same version, active everywhere', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true)]),
      inst('b', 'Test', 'plugins', [P('com.x', '1.0', true)]),
    ]);
    expect(r.rows[0].status).toBe('sync');
    void a;
  });

  it('counts tally per status', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('s', '1', true), P('d', '1', true), P('m', '1', true)]),
      inst('b', 'Test', 'plugins', [P('s', '1', true), P('d', '2', true)]),
    ]);
    expect(r.counts.sync).toBe(1); // s
    expect(r.counts.drift).toBe(1); // d
    expect(r.counts.missing).toBe(1); // m
  });
});

describe('reconcile — properties (value drift, no active)', () => {
  const prop = (name, value) => ({ name, value, type: 'string' });
  it('drift when property values differ', () => {
    const r = reconcile('properties', [
      inst('a', 'Dev', 'properties', [prop('glide.x', 'on')]),
      inst('b', 'Test', 'properties', [prop('glide.x', 'off')]),
    ]);
    expect(r.rows[0].status).toBe('drift');
  });

  it('sync when values match', () => {
    const r = reconcile('properties', [
      inst('a', 'Dev', 'properties', [prop('glide.x', 'on')]),
      inst('b', 'Test', 'properties', [prop('glide.x', 'on')]),
    ]);
    expect(r.rows[0].status).toBe('sync');
  });

  it('values absent (redacted/off) → presence-only, no false drift', () => {
    const r = reconcile('properties', [
      inst('a', 'Dev', 'properties', [{ name: 'glide.secret', type: 'string' }]),
      inst('b', 'Test', 'properties', [{ name: 'glide.secret', type: 'string' }]),
    ]);
    expect(r.rows[0].status).toBe('sync');
  });
});

describe('reconcileToCsv', () => {
  it('emits a header with per-instance field columns and one row per entry', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true, 'X Plugin')]),
      inst('b', 'Test', 'plugins', [P('com.x', '2.0', false, 'X Plugin')]),
    ]);
    const csv = reconcileToCsv(r);
    const [header, row] = csv.split('\n');
    expect(header).toBe('name,key,Dev_version,Dev_active,Test_version,Test_active,status');
    expect(row).toBe('X Plugin,com.x,1.0,active,2.0,inactive,Drift');
  });

  it('leaves blank cells for missing entries', () => {
    const r = reconcile('plugins', [
      inst('a', 'Dev', 'plugins', [P('com.x', '1.0', true, 'X')]),
      inst('b', 'Test', 'plugins', []),
    ]);
    const row = reconcileToCsv(r).split('\n')[1];
    expect(row).toBe('X,com.x,1.0,active,,,' + STATUS_LABELS.missing);
  });

  it('quotes fields containing commas or quotes', () => {
    const r = reconcile('customApps', [
      inst('a', 'Dev', 'customApps', [{ scope: 'x_co', name: 'A, Inc "app"', version: '1' }]),
    ]);
    const row = reconcileToCsv(r).split('\n')[1];
    expect(row).toContain('"A, Inc ""app"""');
    void SECTION_CONFIG;
  });
});

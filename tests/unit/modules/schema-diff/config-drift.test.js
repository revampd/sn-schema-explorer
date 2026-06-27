/**
 * Unit tests for src/modules/schema-diff/config-drift.js (#139).
 * Pairwise config drift between a Diff's base and compare, with the opt-in gate:
 * config is an enrichment, schema diff is the baseline — never fabricate findings
 * from unexported data.
 */
import { describe, it, expect } from 'vitest';
import {
  makeConfigDrift,
  hasAppMetadata,
  appDriftSummary,
  tablesForApp,
} from '../../../../src/modules/schema-diff/config-drift.js';

const withApps = apps => ({ _metadata: { storeApps: apps } });
const app = (scope, name, version, active = true) => ({ scope, name, version, active });

describe('hasAppMetadata', () => {
  it('true only when a non-empty store/custom app section exists', () => {
    expect(hasAppMetadata(withApps([app('x', 'X', '1')]))).toBe(true);
    expect(hasAppMetadata({ _metadata: { storeApps: [] } })).toBe(false);
    expect(hasAppMetadata({ _metadata: {} })).toBe(false);
    expect(hasAppMetadata(null)).toBe(false);
  });
});

describe('makeConfigDrift — opt-in gate', () => {
  it('is NOT comparable when either side lacks app metadata (just a schema diff)', () => {
    const base = withApps([app('sn_x', 'X', '1')]);
    const noApps = { nodes: [], edges: [] };
    expect(makeConfigDrift(base, noApps).comparable).toBe(false);
    expect(makeConfigDrift(noApps, base).comparable).toBe(false);
    // never fabricates: forScope returns null when not comparable
    expect(makeConfigDrift(base, noApps).forScope('X')).toBeNull();
  });
});

describe('makeConfigDrift — pairwise resolution', () => {
  const base = withApps([app('sn_x', 'Secrets', '2.0')]);
  const compare = withApps([app('sn_x', 'Secrets', '1.0')]);

  it('drift on a version difference (joins via display name)', () => {
    const r = makeConfigDrift(base, compare).forScope('Secrets');
    expect(r.status).toBe('drift');
    expect(r.base.version).toBe('2.0');
    expect(r.compare.version).toBe('1.0');
    expect(r.app.name).toBe('Secrets');
  });
  it('sync when versions match', () => {
    const same = withApps([app('sn_x', 'Secrets', '2.0')]);
    expect(makeConfigDrift(base, same).forScope('Secrets').status).toBe('sync');
  });
  it('missing when the app is absent on one side (it WAS exported, just not present)', () => {
    const other = withApps([app('sn_y', 'Other', '1.0')]);
    const r = makeConfigDrift(base, other).forScope('Secrets');
    expect(r.status).toBe('missing');
    expect(r.base.version).toBe('2.0');
    expect(r.compare).toBeNull();
  });
  it('state mismatch when active differs at the same version', () => {
    const inactive = withApps([app('sn_x', 'Secrets', '2.0', false)]);
    expect(makeConfigDrift(base, inactive).forScope('Secrets').status).toBe('active');
  });
  it('returns null for the global scope and for scopes with no owning app', () => {
    const m = makeConfigDrift(base, compare);
    expect(m.forScope('Global')).toBeNull();
    expect(m.forScope('nonexistent')).toBeNull();
  });
});

describe('appDriftSummary — sidebar app-level drift (#139b)', () => {
  const base = withApps([app('sn_x', 'Secrets', '2.0'), app('sn_y', 'Widgets', '1.0')]);
  const compare = withApps([app('sn_x', 'Secrets', '1.0'), app('sn_z', 'Reports', '1.0')]);

  it('not comparable when a side lacks app metadata', () => {
    expect(appDriftSummary(base, { nodes: [] }).comparable).toBe(false);
  });

  it('lists every app in base ∪ compare with status + counts', () => {
    const r = appDriftSummary(base, compare);
    expect(r.comparable).toBe(true);
    const byName = Object.fromEntries(r.apps.map(a => [a.name, a.status]));
    expect(byName.Secrets).toBe('drift'); // 2.0 vs 1.0
    expect(byName.Widgets).toBe('missing'); // base only
    expect(byName.Reports).toBe('missing'); // compare only
    expect(r.counts.drift).toBe(1);
    expect(r.counts.missing).toBe(2);
  });

  it('carries per-side records for version display', () => {
    const r = appDriftSummary(base, compare);
    const secrets = r.apps.find(a => a.name === 'Secrets');
    expect(secrets.base.version).toBe('2.0');
    expect(secrets.compare.version).toBe('1.0');
  });
});

describe('tablesForApp', () => {
  const nodes = [
    { id: 'incident', scope: 'Global' },
    { id: 'x_a', scope: 'Secrets' }, // matches app display name
    { id: 'x_b', scope: 'sn_x' }, // matches app technical scope
    { id: 'other', scope: 'Widgets' },
  ];
  it('matches owned tables by technical scope OR display name', () => {
    const owned = tablesForApp({ key: 'sn_x', name: 'Secrets' }, nodes);
    expect(owned.sort()).toEqual(['x_a', 'x_b']);
  });
  it('returns [] for a missing app or nodes', () => {
    expect(tablesForApp(null, nodes)).toEqual([]);
    expect(tablesForApp({ key: 'sn_x', name: 'Secrets' }, null)).toEqual([]);
  });
});

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

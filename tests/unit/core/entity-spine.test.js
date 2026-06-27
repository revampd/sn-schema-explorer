/**
 * Unit tests for src/core/entity-spine.js — the shared entity spine (#132).
 *
 * The spine's job is the cross-lens JOIN between schema nodes (Structure) and
 * store/custom app records (Config), keyed by application scope. The tricky bit
 * it must handle: nodes carry the scope DISPLAY name (sys_scope.displayValue)
 * while apps carry the TECHNICAL scope plus the display name — so apps are
 * indexed under both, and a node resolves via either spelling.
 */
import { describe, it, expect } from 'vitest';

import {
  buildSpine,
  buildScopeIndex,
  buildAppIndex,
  normKey,
  isGlobalScope,
} from '../../../src/core/entity-spine.js';

// A graph whose scoped table carries the scope DISPLAY name ("Secrets
// Management"), exactly as today's exporter emits it.
const GRAPH = {
  nodes: [
    { id: 'incident', scope: 'Global' },
    { id: 'task', scope: 'Global' },
    { id: 'sn_sm_secret', scope: 'Secrets Management' },
  ],
};

// Instance A: a store app whose technical scope is "sn_sm" and display name is
// "Secrets Management" at v2.0.
const INST_A = {
  id: 'i_a',
  label: 'dev',
  data: {
    _metadata: {
      storeApps: [{ scope: 'sn_sm', name: 'Secrets Management', version: '2.0', active: true }],
      plugins: [{ name: 'com.glide.x', version: '1.0' }],
    },
  },
};
// Instance B: same app, drifted to v1.0 (older).
const INST_B = {
  id: 'i_b',
  label: 'prod',
  data: {
    _metadata: {
      customApps: [{ scope: 'sn_sm', name: 'Secrets Management', version: '1.0', active: true }],
    },
  },
};

describe('normKey / isGlobalScope', () => {
  it('normalises case and whitespace', () => {
    expect(normKey('  Secrets Management ')).toBe('secrets management');
    expect(normKey(null)).toBe('');
  });
  it('treats empty and "global" (any case) as global', () => {
    expect(isGlobalScope('Global')).toBe(true);
    expect(isGlobalScope('')).toBe(true);
    expect(isGlobalScope(null)).toBe(true);
    expect(isGlobalScope('sn_sm')).toBe(false);
  });
});

describe('buildScopeIndex', () => {
  it('groups tables by normalised scope, both directions', () => {
    const { tablesByScope, scopeOfTable } = buildScopeIndex(GRAPH);
    expect(tablesByScope.get('global')).toEqual(['incident', 'task']);
    expect(tablesByScope.get('secrets management')).toEqual(['sn_sm_secret']);
    expect(scopeOfTable.get('sn_sm_secret')).toBe('secrets management');
  });
  it('tolerates an empty / missing graph', () => {
    expect(buildScopeIndex(null).tablesByScope.size).toBe(0);
    expect(buildScopeIndex({}).scopeOfTable.size).toBe(0);
  });
});

describe('buildAppIndex', () => {
  it('indexes an app under BOTH its technical scope and display name', () => {
    const idx = buildAppIndex(INST_A.data);
    expect(idx.get('sn_sm')).toMatchObject({ version: '2.0', _section: 'storeApps' });
    expect(idx.get('secrets management')).toMatchObject({ version: '2.0' });
  });
  it('ignores plugins and properties (no table linkage)', () => {
    const idx = buildAppIndex(INST_A.data);
    expect(idx.get('com.glide.x')).toBeUndefined();
  });
  it('tolerates missing metadata', () => {
    expect(buildAppIndex(null).size).toBe(0);
    expect(buildAppIndex({ _metadata: {} }).size).toBe(0);
  });
});

describe('buildSpine — cross-lens resolution', () => {
  it('resolves a scoped table to its owning app per instance (display-name join)', () => {
    const spine = buildSpine(GRAPH, [INST_A, INST_B]);
    const r = spine.resolveTable('sn_sm_secret');
    expect(r.scope).toBe('secrets management');
    expect(r.node.id).toBe('sn_sm_secret');
    // Joined via the node's DISPLAY-name scope against each app's name — and the
    // versions differ, which is exactly the drift #133 will surface.
    expect(r.apps.i_a.version).toBe('2.0');
    expect(r.apps.i_b.version).toBe('1.0');
  });

  it('also resolves when a node carries the TECHNICAL scope (future-proof)', () => {
    const techGraph = { nodes: [{ id: 'sn_sm_secret', scope: 'sn_sm' }] };
    const spine = buildSpine(techGraph, [INST_A]);
    expect(spine.resolveTable('sn_sm_secret').apps.i_a.version).toBe('2.0');
  });

  it('global tables resolve to no app', () => {
    const spine = buildSpine(GRAPH, [INST_A, INST_B]);
    const r = spine.resolveTable('incident');
    expect(r.scope).toBe('global');
    expect(r.apps.i_a).toBeNull();
    expect(r.apps.i_b).toBeNull();
  });

  it('an unknown table resolves to a null node and empty scope', () => {
    const spine = buildSpine(GRAPH, [INST_A]);
    const r = spine.resolveTable('does_not_exist');
    expect(r.node).toBeNull();
    expect(r.scope).toBe('');
    expect(r.apps.i_a).toBeNull();
  });

  it('resolveScope lists tables and per-instance apps for a scope', () => {
    const spine = buildSpine(GRAPH, [INST_A, INST_B]);
    const r = spine.resolveScope('Secrets Management');
    expect(r.tables).toEqual(['sn_sm_secret']);
    expect(r.apps.i_a.version).toBe('2.0');
    expect(r.apps.i_b.version).toBe('1.0');
  });

  it('appsForScope returns an entry (null) for every instance', () => {
    const spine = buildSpine(GRAPH, [INST_A, INST_B]);
    expect(Object.keys(spine.appsForScope('nope'))).toEqual(['i_a', 'i_b']);
  });
});

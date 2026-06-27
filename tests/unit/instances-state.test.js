/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/viewer/core/instances-state.js — the multi-instance
 * registry (#99). Pure state + helpers: registration, capability detection
 * (presence-based, older-export tolerant), aggregation, and list-only
 * persistence that never stores the heavy `data`.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// jsdom in this config doesn't expose localStorage — provide an in-memory shim.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
}

import {
  instancesState,
  detectCapabilities,
  aggregateCapabilities,
  addInstance,
  getInstance,
  removeInstance,
  renameInstance,
  selectInstance,
  persist,
  loadPersisted,
  _resetInstances,
} from '../../src/viewer/core/instances-state.js';

const STORAGE_KEY = 'snse:instances:v1';

// A minimal schema export with metadata sections.
const FULL_DATA = {
  _instance: { instance_name: 'dev123', build_name: 'Xanadu' },
  nodes: [{ id: 'task' }, { id: 'incident' }],
  edges: [{ source: 'incident', target: 'task', type: 'extends' }],
  _capabilities: { metadata: { plugins: { enabled: true, count: 1 } } },
  _metadata: {
    plugins: [{ id: 'com.x', name: 'X', active: true, version: '1' }],
    properties: [],
  },
};

// An older export predating metadata sections.
const OLD_DATA = {
  nodes: [{ id: 'task' }],
  edges: [],
};

beforeEach(() => {
  _resetInstances();
  localStorage.clear();
});

describe('detectCapabilities', () => {
  it('detects schema + present metadata sections from real arrays', () => {
    const caps = detectCapabilities(FULL_DATA);
    expect(caps).toEqual({
      schema: true,
      plugins: true,
      storeApps: false,
      customApps: false,
      // properties present but empty → false (mirrors exporter enabled=count>0)
      properties: false,
    });
  });

  it('older export → schema:true, all metadata caps false', () => {
    const caps = detectCapabilities(OLD_DATA);
    expect(caps.schema).toBe(true);
    expect(caps.plugins).toBe(false);
    expect(caps.storeApps).toBe(false);
    expect(caps.customApps).toBe(false);
    expect(caps.properties).toBe(false);
  });

  it('ignores _capabilities as authoritative — only real arrays count', () => {
    // _capabilities claims storeApps, but there is no _metadata.storeApps array.
    const data = {
      nodes: [{ id: 't' }],
      edges: [],
      _capabilities: { metadata: { storeApps: { enabled: true, count: 9 } } },
    };
    expect(detectCapabilities(data).storeApps).toBe(false);
  });

  it('null / non-object data → everything false', () => {
    expect(detectCapabilities(null).schema).toBe(false);
    expect(detectCapabilities(undefined).plugins).toBe(false);
    expect(detectCapabilities(42).schema).toBe(false);
  });

  it('empty node list → schema:false', () => {
    expect(detectCapabilities({ nodes: [], edges: [] }).schema).toBe(false);
  });
});

describe('addInstance / getInstance', () => {
  it('creates an entry with derived capabilities + meta and a unique id', () => {
    const e = addInstance({ label: 'Dev', fileName: 'dev.json', data: FULL_DATA });
    expect(e.id).toMatch(/^i_/);
    expect(e.label).toBe('Dev');
    expect(e.source).toBe('file');
    expect(e.capabilities.plugins).toBe(true);
    expect(e.meta).toEqual({ instance_name: 'dev123', build_name: 'Xanadu' });
    expect(typeof e.addedAt).toBe('number');
    expect(getInstance(e.id)).toBe(e);
  });

  it('falls back to fileName then a default for the label', () => {
    expect(addInstance({ fileName: 'prod.json', data: OLD_DATA }).label).toBe('prod.json');
    expect(addInstance({ data: OLD_DATA }).label).toBe('Instance');
  });

  it('keeps _byId in sync across multiple adds', () => {
    const a = addInstance({ label: 'A', data: OLD_DATA });
    const b = addInstance({ label: 'B', data: OLD_DATA });
    expect(instancesState.instances).toHaveLength(2);
    expect(getInstance(a.id).label).toBe('A');
    expect(getInstance(b.id).label).toBe('B');
  });

  it('getInstance returns null for an unknown id', () => {
    expect(getInstance('nope')).toBeNull();
  });
});

describe('removeInstance', () => {
  it('removes by id and reindexes the rest', () => {
    const a = addInstance({ label: 'A', data: OLD_DATA });
    const b = addInstance({ label: 'B', data: OLD_DATA });
    expect(removeInstance(a.id)).toBe(true);
    expect(instancesState.instances).toHaveLength(1);
    expect(getInstance(a.id)).toBeNull();
    expect(getInstance(b.id).label).toBe('B');
  });

  it('clears selectedId when the selected instance is removed', () => {
    const a = addInstance({ label: 'A', data: OLD_DATA });
    selectInstance(a.id);
    removeInstance(a.id);
    expect(instancesState.selectedId).toBeNull();
  });

  it('returns false for an unknown id', () => {
    expect(removeInstance('nope')).toBe(false);
  });
});

describe('renameInstance', () => {
  it('renames an existing entry', () => {
    const a = addInstance({ label: 'A', data: OLD_DATA });
    expect(renameInstance(a.id, 'Renamed')).toBe(true);
    expect(getInstance(a.id).label).toBe('Renamed');
  });

  it('keeps the old label when given an empty one, and returns false for unknown', () => {
    const a = addInstance({ label: 'A', data: OLD_DATA });
    renameInstance(a.id, '');
    expect(getInstance(a.id).label).toBe('A');
    expect(renameInstance('nope', 'X')).toBe(false);
  });
});

describe('selectInstance', () => {
  it('selects a known id and clears with null', () => {
    const a = addInstance({ label: 'A', data: OLD_DATA });
    expect(selectInstance(a.id)).toBe(true);
    expect(instancesState.selectedId).toBe(a.id);
    expect(selectInstance(null)).toBe(true);
    expect(instancesState.selectedId).toBeNull();
  });

  it('refuses an unknown id', () => {
    expect(selectInstance('nope')).toBe(false);
    expect(instancesState.selectedId).toBeNull();
  });
});

describe('aggregateCapabilities', () => {
  it('unions capabilities and counts carriers per section', () => {
    addInstance({ label: 'A', data: FULL_DATA }); // schema + plugins
    addInstance({ label: 'B', data: FULL_DATA }); // schema + plugins
    addInstance({ label: 'C', data: OLD_DATA }); // schema only
    const agg = aggregateCapabilities();
    expect(agg.schema).toEqual({ any: true, count: 3 });
    expect(agg.plugins).toEqual({ any: true, count: 2 });
    expect(agg.storeApps).toEqual({ any: false, count: 0 });
  });

  it('is all-zero with no instances', () => {
    const agg = aggregateCapabilities();
    expect(agg.schema).toEqual({ any: false, count: 0 });
    expect(agg.properties).toEqual({ any: false, count: 0 });
  });
});

describe('persistence (list-only)', () => {
  it('persists metadata but never the heavy data', () => {
    addInstance({ label: 'Dev', fileName: 'dev.json', data: FULL_DATA });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.instances).toHaveLength(1);
    expect(parsed.instances[0]).not.toHaveProperty('data');
    expect(parsed.instances[0].label).toBe('Dev');
    expect(parsed.instances[0].capabilities.plugins).toBe(true);
  });

  it('round-trips the list, rehydrating entries with data:null', () => {
    const a = addInstance({ label: 'Dev', fileName: 'dev.json', data: FULL_DATA });
    selectInstance(a.id);
    persist();

    _resetInstances();
    expect(instancesState.instances).toHaveLength(0);

    const n = loadPersisted();
    expect(n).toBe(1);
    const restored = getInstance(a.id);
    expect(restored.label).toBe('Dev');
    expect(restored.data).toBeNull();
    expect(restored.capabilities.plugins).toBe(true);
    expect(instancesState.selectedId).toBe(a.id);
  });

  it('drops a stale selectedId that no longer exists on load', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedId: 'gone',
        instances: [{ id: 'i_x', label: 'X', capabilities: { schema: true } }],
      })
    );
    loadPersisted();
    expect(instancesState.selectedId).toBeNull();
    expect(getInstance('i_x').label).toBe('X');
  });

  it('loadPersisted returns 0 when nothing is stored', () => {
    expect(loadPersisted()).toBe(0);
    expect(instancesState.instances).toHaveLength(0);
  });
});

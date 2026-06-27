/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/viewer/modules/landing/index.js — the front-door landing
 * page (#101). Covers the tool-tile registry, capability gating, instance-row
 * rendering with badges, selection, and the built-in Schema Explorer tile.
 *
 * load/index.js drags in d3/canvas via render.js — stub it so we exercise only
 * the landing wiring. engine/workspace.js is stubbed to observe setWorkspace.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

const { selectInstanceForGraph, setWorkspace, onWorkspaceChange } = vi.hoisted(() => ({
  selectInstanceForGraph: vi.fn(() => true),
  setWorkspace: vi.fn(),
  onWorkspaceChange: vi.fn(),
}));
vi.mock('../../src/viewer/modules/load/index.js', () => ({ selectInstanceForGraph }));
vi.mock('../../src/viewer/engine/workspace.js', () => ({ setWorkspace, onWorkspaceChange }));

import {
  registerTool,
  renderInstances,
  renderTools,
  refreshLanding,
  initLanding,
  _resetTools,
} from '../../src/viewer/modules/landing/index.js';
import { addInstance, _resetInstances } from '../../src/viewer/core/instances-state.js';

const SCHEMA_DATA = {
  _instance: { instance_name: 'dev1' },
  nodes: [{ id: 'task' }],
  edges: [],
};
const PLUGIN_DATA = {
  nodes: [{ id: 'task' }],
  edges: [],
  _metadata: { plugins: [{ id: 'com.x', name: 'X' }] },
};

function setupDom() {
  document.body.innerHTML = `
    <button id="btn-home"></button>
    <div id="drop-zone"><input type="file" id="file-input"></div>
    <button id="btn-demo"></button>
    <div id="landing-instances"></div>
    <div id="landing-tools"></div>
  `;
}

beforeEach(() => {
  _resetInstances();
  _resetTools();
  localStorage.clear();
  selectInstanceForGraph.mockClear();
  setWorkspace.mockClear();
  setupDom();
});

describe('tool-tile registry', () => {
  it('registers a tile and renders it; registration is idempotent', () => {
    registerTool({ key: 't1', label: 'Tool One', description: 'does things' });
    registerTool({ key: 't1', label: 'dup' }); // ignored
    renderTools();
    const tiles = document.querySelectorAll('.landing-tool');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].querySelector('.lt-label').textContent).toBe('Tool One');
  });
});

describe('capability gating', () => {
  it('disables a tile until enough eligible instances are registered', () => {
    registerTool({
      key: 'cmp',
      label: 'Comparison',
      requires: ['plugins'],
      minInstances: 2,
      enter: vi.fn(),
    });

    renderTools();
    expect(document.querySelector('[data-tool="cmp"]').disabled).toBe(true);

    addInstance({ label: 'a', data: PLUGIN_DATA });
    refreshLanding();
    expect(document.querySelector('[data-tool="cmp"]').disabled).toBe(true); // only 1

    addInstance({ label: 'b', data: PLUGIN_DATA });
    refreshLanding();
    expect(document.querySelector('[data-tool="cmp"]').disabled).toBe(false); // now 2
  });

  it('clicking an enabled tile invokes enter() with the resolved target', () => {
    const enter = vi.fn();
    registerTool({ key: 'se', label: 'SE', requires: ['schema'], minInstances: 1, enter });
    const entry = addInstance({ label: 'a', data: SCHEMA_DATA }); // selected by addInstance? no
    refreshLanding();
    document.querySelector('[data-tool="se"]').click();
    expect(enter).toHaveBeenCalledWith(entry.id);
  });

  it('clicking a disabled tile does nothing', () => {
    const enter = vi.fn();
    registerTool({ key: 'se', label: 'SE', requires: ['schema'], minInstances: 1, enter });
    renderTools();
    document.querySelector('[data-tool="se"]').click();
    expect(enter).not.toHaveBeenCalled();
  });
});

describe('instance rows', () => {
  it('shows an empty state with no instances', () => {
    renderInstances();
    expect(document.querySelector('.landing-empty')).toBeTruthy();
  });

  it('renders a row with capability badges', () => {
    addInstance({ label: 'dev1', data: PLUGIN_DATA });
    renderInstances();
    const row = document.querySelector('.landing-instance');
    expect(row.querySelector('.li-label').textContent).toBe('dev1');
    const badges = [...row.querySelectorAll('.li-badge')].map(b => b.textContent);
    expect(badges).toContain('Schema');
    expect(badges).toContain('Plugins');
  });

  it('clicking a row selects the instance and marks it', () => {
    const a = addInstance({ label: 'a', data: SCHEMA_DATA });
    const b = addInstance({ label: 'b', data: SCHEMA_DATA });
    refreshLanding();
    const rows = document.querySelectorAll('.landing-instance');
    // click the second row
    rows[1].click();
    const selected = document.querySelector('.landing-instance.selected');
    expect(selected.dataset.instance).toBe(b.id);
    expect(a.id).not.toBe(b.id);
  });
});

describe('initLanding (built-in Schema Explorer tile)', () => {
  it('registers the schemaExplorer tile and wires the demo button', () => {
    initLanding();
    // Demo registers an instance and selects it.
    document.getElementById('btn-demo').click();
    expect(document.querySelectorAll('.landing-instance').length).toBeGreaterThanOrEqual(1);
    const tile = document.querySelector('[data-tool="schemaExplorer"]');
    expect(tile).toBeTruthy();
    expect(tile.disabled).toBe(false);
    // Entering calls into the load module + switches workspace.
    tile.click();
    expect(selectInstanceForGraph).toHaveBeenCalledTimes(1);
    expect(setWorkspace).toHaveBeenCalledWith('schema-explorer');
  });

  it('Home button switches back to the landing workspace', () => {
    initLanding();
    document.getElementById('btn-home').click();
    expect(setWorkspace).toHaveBeenCalledWith('landing');
  });
});

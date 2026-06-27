/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/viewer/modules/landing/index.js — the front-door landing
 * page (#101). Card-based layout: a grid of instance cards (with read-only
 * section status + per-instance tool icons) plus an Add-instance card.
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
  refreshLanding,
  initLanding,
  _resetTools,
} from '../../src/viewer/modules/landing/index.js';
import { addInstance, _resetInstances } from '../../src/viewer/core/instances-state.js';

const SCHEMA_DATA = {
  _instance: { instance_name: 'dev1' },
  _stats: { counts: { tables: 5 } },
  nodes: [{ id: 'task' }],
  edges: [],
};
const PLUGIN_DATA = {
  nodes: [{ id: 'task' }],
  edges: [],
  _metadata: {
    plugins: [
      { id: 'com.x', name: 'X' },
      { id: 'com.y', name: 'Y' },
    ],
  },
};

function setupDom() {
  document.body.innerHTML = `
    <button id="btn-home"></button>
    <input type="file" id="file-input" hidden>
    <div id="landing-instances"></div>
  `;
}
const cardTool = (id, key) =>
  document.querySelector(`.inst-card[data-instance="${id}"] [data-tool="${key}"]`);

beforeEach(() => {
  _resetInstances();
  _resetTools();
  localStorage.clear();
  selectInstanceForGraph.mockClear();
  setWorkspace.mockClear();
  setupDom();
});

describe('instance cards', () => {
  it('renders a card per instance plus an Add-instance card', () => {
    addInstance({ label: 'dev1', data: SCHEMA_DATA });
    renderInstances();
    expect(document.querySelectorAll('.inst-card:not(.add-card)')).toHaveLength(1);
    expect(document.querySelector('.add-card')).toBeTruthy();
  });

  it('shows section status with counts present / dash absent', () => {
    addInstance({ label: 'dev1', data: PLUGIN_DATA });
    renderInstances();
    const rows = [...document.querySelectorAll('.ic-sec')].map(r => [
      r.querySelector('.ic-sec-label').textContent,
      r.querySelector('.ic-sec-val').textContent,
      r.classList.contains('absent'),
    ]);
    const byLabel = Object.fromEntries(rows.map(([l, v, a]) => [l, { v, a }]));
    expect(byLabel['Plugins']).toEqual({ v: '2', a: false });
    expect(byLabel['Custom apps'].a).toBe(true); // absent
    expect(byLabel['Custom apps'].v).toBe('—');
  });

  it('renders the title from the instance label', () => {
    addInstance({ label: 'Prod', data: SCHEMA_DATA });
    renderInstances();
    expect(document.querySelector('.ic-title').textContent).toBe('Prod');
  });
});

describe('per-instance tool icons', () => {
  it('renders a tool icon on each card; registration is idempotent', () => {
    registerTool({ key: 't1', label: 'Tool One', icon: '◎' });
    registerTool({ key: 't1', label: 'dup' }); // ignored
    addInstance({ label: 'a', data: SCHEMA_DATA });
    renderInstances();
    expect(document.querySelectorAll('[data-tool="t1"]')).toHaveLength(1);
  });

  it('enables the icon only on cards whose instance satisfies requires', () => {
    registerTool({
      key: 'cmp',
      label: 'Compare',
      icon: '⇄',
      requires: ['plugins'],
      enter: vi.fn(),
    });
    const schemaOnly = addInstance({ label: 'a', data: SCHEMA_DATA });
    const withPlugins = addInstance({ label: 'b', data: PLUGIN_DATA });
    refreshLanding();
    expect(cardTool(schemaOnly.id, 'cmp').disabled).toBe(true);
    expect(cardTool(withPlugins.id, 'cmp').disabled).toBe(false);
  });

  it('clicking an enabled icon launches the tool with that instance id', () => {
    const enter = vi.fn();
    registerTool({ key: 'se', label: 'SE', icon: '◎', requires: ['schema'], enter });
    const a = addInstance({ label: 'a', data: SCHEMA_DATA });
    const b = addInstance({ label: 'b', data: SCHEMA_DATA });
    refreshLanding();
    cardTool(b.id, 'se').click();
    expect(enter).toHaveBeenCalledWith(b.id);
    expect(a.id).not.toBe(b.id);
  });

  it('clicking a disabled icon does nothing', () => {
    const enter = vi.fn();
    registerTool({ key: 'cmp', label: 'Compare', icon: '⇄', requires: ['plugins'], enter });
    const a = addInstance({ label: 'a', data: SCHEMA_DATA }); // no plugins
    refreshLanding();
    cardTool(a.id, 'cmp').click();
    expect(enter).not.toHaveBeenCalled();
  });

  it('minInstances gates the icon until enough eligible instances exist', () => {
    registerTool({ key: 'diff', label: 'Diff', icon: '⇄', requires: ['schema'], minInstances: 2 });
    const a = addInstance({ label: 'a', data: SCHEMA_DATA });
    refreshLanding();
    expect(cardTool(a.id, 'diff').disabled).toBe(true); // only 1 instance
    const b = addInstance({ label: 'b', data: SCHEMA_DATA });
    refreshLanding();
    expect(cardTool(a.id, 'diff').disabled).toBe(false); // now 2
    expect(cardTool(b.id, 'diff').disabled).toBe(false);
  });

  it('an enabled() predicate can disable the icon (e.g. a Settings feature off)', () => {
    let featureOn = false;
    registerTool({
      key: 'gated',
      label: 'Gated',
      icon: '⚑',
      requires: ['schema'],
      enabled: () => featureOn,
    });
    const a = addInstance({ label: 'a', data: SCHEMA_DATA });
    refreshLanding();
    expect(cardTool(a.id, 'gated').disabled).toBe(true);
    featureOn = true;
    refreshLanding();
    expect(cardTool(a.id, 'gated').disabled).toBe(false);
  });
});

describe('initLanding (built-in Schema Explorer + add card)', () => {
  it('wires the demo button to register + select an instance', () => {
    initLanding();
    document.getElementById('btn-demo').click();
    expect(document.querySelectorAll('.inst-card:not(.add-card)').length).toBe(1);
  });

  it('opens the selected instance in Schema Explorer from its card icon', () => {
    initLanding();
    document.getElementById('btn-demo').click();
    const tile = document.querySelector('[data-tool="schemaExplorer"]');
    expect(tile).toBeTruthy();
    expect(tile.disabled).toBe(false);
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

/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/core/header-instance.js (#127) — the header instance
 * dropdown. Shows schema-capable instances, switches the loaded one, and in
 * diff view routes the pick to the injected diff-base handler.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../helpers/localstorage.js';
import {
  renderHeaderInstance,
  setInstanceSelectHandler,
  setDiffBaseHandler,
} from '../../../src/core/header-instance.js';
import { addInstance, selectInstance, _resetInstances } from '../../../src/core/instances-state.js';
import { setWorkspace } from '../../../src/core/workspace.js';
import { uiState, diffState } from '../../../src/core/state.js';

const SCHEMA = { nodes: [{ id: 'task' }], edges: [] };
const NO_SCHEMA = { nodes: [], edges: [] };

let onSelect, onDiffBase;
beforeEach(() => {
  _resetInstances();
  localStorage.clear();
  document.body.innerHTML = '<div id="header-instance"></div>';
  onSelect = vi.fn();
  onDiffBase = vi.fn();
  setInstanceSelectHandler(onSelect);
  setDiffBaseHandler(onDiffBase);
  setWorkspace('schema-explorer');
  uiState.viewMode = 'force';
  diffState._diffData = null;
});

const host = () => document.getElementById('header-instance');
const opts = () => [...document.querySelectorAll('body > .sn-dd-menu .sn-dd-opt')];
const labelText = () => host().querySelector('.sn-dd-label')?.textContent;
// The dropdown is a module singleton, so reset its open state (Escape closes if a
// prior test left it open) before opening fresh.
const openMenu = () => {
  const b = host().querySelector('.sn-dd-btn');
  b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  b.click();
};
const pick = label => {
  openMenu();
  opts()
    .find(o => o.textContent === label)
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
};

describe('renderHeaderInstance', () => {
  it('lists schema-capable instances and shows the selected one', () => {
    const a = addInstance({ label: 'Dev', data: SCHEMA });
    addInstance({ label: 'Test', data: SCHEMA });
    addInstance({ label: 'Empty', data: NO_SCHEMA }); // excluded (no schema)
    selectInstance(a.id);
    renderHeaderInstance();
    openMenu();
    expect(opts().map(o => o.textContent)).toEqual(['Dev', 'Test']);
    expect(labelText()).toBe('Dev');
  });

  it('hides on the landing workspace and outside schema-explorer', () => {
    addInstance({ label: 'Dev', data: SCHEMA });
    setWorkspace('landing');
    renderHeaderInstance();
    expect(host().style.display).toBe('none');
    setWorkspace('schema-explorer');
    renderHeaderInstance();
    expect(host().style.display).toBe('');
  });

  it('picking switches the loaded instance (force view → select handler)', () => {
    const a = addInstance({ label: 'Dev', data: SCHEMA });
    const b = addInstance({ label: 'Test', data: SCHEMA });
    selectInstance(a.id);
    renderHeaderInstance();
    pick('Test');
    expect(onSelect).toHaveBeenCalledWith(b.id);
    expect(onDiffBase).not.toHaveBeenCalled();
  });

  it('picking while a comparison is active routes to the diff-base handler instead', () => {
    const a = addInstance({ label: 'Dev', data: SCHEMA });
    const b = addInstance({ label: 'Test', data: SCHEMA });
    selectInstance(a.id);
    diffState._diffData = {}; // a comparison is active → base switch re-runs the diff
    renderHeaderInstance();
    pick('Test');
    expect(onDiffBase).toHaveBeenCalledWith(b.id);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

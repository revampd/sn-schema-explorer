/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/modules/schema-diff/instance-picker.js (#102).
 * Schema Diff now picks Base/Compare from the registered instances instead of a
 * file upload. The picker only owns the two <select> controls + keeps them in
 * sync with the registry; loadDiffFromInstances is injected (stubbed here).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  initDiffInstancePicker,
  refreshDiffPicker,
} from '../../src/modules/schema-diff/instance-picker.js';
import {
  instancesState,
  addInstance,
  selectInstance,
  _resetInstances,
} from '../../src/core/instances-state.js';

const SCHEMA_DATA = { nodes: [{ id: 'task' }], edges: [] };
const NO_SCHEMA = { nodes: [], edges: [] }; // schema cap false (no nodes)

function setupDom() {
  document.body.innerHTML = `
    <select id="diff-base-select"></select>
    <select id="diff-compare-select"></select>
    <div id="diff-picker-empty" style="display:none"></div>
  `;
}

beforeEach(() => {
  _resetInstances();
  localStorage.clear();
  setupDom();
});

describe('refreshDiffPicker', () => {
  it('populates Base with schema instances and selects the loaded one', () => {
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    refreshDiffPicker();
    const base = document.getElementById('diff-base-select');
    expect(base.options).toHaveLength(2);
    expect(base.value).toBe(a.id); // the selected/loaded instance
  });

  it('Compare excludes the base and offers a blank clear option', () => {
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    const b = addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    refreshDiffPicker();
    const cmp = document.getElementById('diff-compare-select');
    const vals = [...cmp.options].map(o => o.value);
    expect(vals).toContain(''); // blank = clear
    expect(vals).toContain(b.id);
    expect(vals).not.toContain(a.id); // base excluded
  });

  it('excludes non-schema instances and shows the empty hint when <2 schema instances', () => {
    addInstance({ label: 'Dev', data: SCHEMA_DATA });
    addInstance({ label: 'Empty', data: NO_SCHEMA });
    refreshDiffPicker();
    const base = document.getElementById('diff-base-select');
    expect(base.options).toHaveLength(1); // only the schema instance
    expect(document.getElementById('diff-picker-empty').style.display).toBe('');
  });

  it('hides the empty hint with ≥2 schema instances', () => {
    addInstance({ label: 'Dev', data: SCHEMA_DATA });
    addInstance({ label: 'Test', data: SCHEMA_DATA });
    refreshDiffPicker();
    expect(document.getElementById('diff-picker-empty').style.display).toBe('none');
  });
});

describe('initDiffInstancePicker', () => {
  it('runs the diff when a Compare is chosen', () => {
    const loadDiffFromInstances = vi.fn();
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    const b = addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    initDiffInstancePicker({ loadDiffFromInstances });

    const cmp = document.getElementById('diff-compare-select');
    cmp.value = b.id;
    cmp.dispatchEvent(new Event('change'));
    expect(loadDiffFromInstances).toHaveBeenCalledWith(a.id, b.id);
  });

  it('clears the comparison when the blank Compare option is chosen', () => {
    const loadDiffFromInstances = vi.fn();
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    initDiffInstancePicker({ loadDiffFromInstances });

    const cmp = document.getElementById('diff-compare-select');
    cmp.value = '';
    cmp.dispatchEvent(new Event('change'));
    expect(loadDiffFromInstances).toHaveBeenCalledWith(a.id, '');
  });

  it('reruns the diff when the Base changes', () => {
    const loadDiffFromInstances = vi.fn();
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    const b = addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    initDiffInstancePicker({ loadDiffFromInstances });

    const base = document.getElementById('diff-base-select');
    base.value = b.id;
    base.dispatchEvent(new Event('change'));
    expect(loadDiffFromInstances).toHaveBeenCalledWith(b.id, expect.any(String));
    void instancesState; // referenced for clarity
  });
});

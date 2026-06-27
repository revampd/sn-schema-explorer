/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/modules/schema-diff/instance-picker.js (#102, #126).
 * Schema Diff picks Base/Compare from the registered instances. The picker owns
 * two custom dropdowns (core/dropdown.js) + a swap button, and keeps them in
 * sync with the registry; loadDiffFromInstances is injected (stubbed here).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../../helpers/localstorage.js';

import {
  initDiffInstancePicker,
  refreshDiffPicker,
} from '../../../../src/modules/schema-diff/instance-picker.js';
import {
  instancesState,
  addInstance,
  selectInstance,
  _resetInstances,
} from '../../../../src/core/instances-state.js';

const SCHEMA_DATA = { nodes: [{ id: 'task' }], edges: [] };
const NO_SCHEMA = { nodes: [], edges: [] }; // schema cap false (no nodes)

function setupDom() {
  document.body.innerHTML = `
    <div id="diff-base-mount"></div>
    <div id="diff-compare-mount"></div>
    <button id="diff-swap-btn" disabled></button>
    <div id="diff-picker-empty" style="display:none"></div>
  `;
}

// DOM helpers to drive the custom dropdowns.
const optLabels = mount =>
  [...document.querySelectorAll(`#${mount} .sn-dd-opt`)].map(o => o.textContent);
const selectedLabel = mount => document.querySelector(`#${mount} .sn-dd-label`).textContent;
const pick = (mount, label) => {
  const opt = [...document.querySelectorAll(`#${mount} .sn-dd-opt`)].find(
    o => o.textContent === label
  );
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
};

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
    initDiffInstancePicker({ loadDiffFromInstances: vi.fn() });
    refreshDiffPicker();
    expect(optLabels('diff-base-mount')).toEqual(['Dev', 'Test']);
    expect(selectedLabel('diff-base-mount')).toBe('Dev'); // the loaded instance
  });

  it('Compare excludes the base and offers a blank clear option', () => {
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    initDiffInstancePicker({ loadDiffFromInstances: vi.fn() });
    refreshDiffPicker();
    const labels = optLabels('diff-compare-mount');
    expect(labels).toContain('— select compare —'); // blank = clear
    expect(labels).toContain('Test');
    expect(labels).not.toContain('Dev'); // base excluded
  });

  it('excludes non-schema instances and shows the empty hint when <2 schema instances', () => {
    addInstance({ label: 'Dev', data: SCHEMA_DATA });
    addInstance({ label: 'Empty', data: NO_SCHEMA });
    initDiffInstancePicker({ loadDiffFromInstances: vi.fn() });
    refreshDiffPicker();
    expect(optLabels('diff-base-mount')).toEqual(['Dev']); // only the schema instance
    expect(document.getElementById('diff-picker-empty').style.display).toBe('');
  });

  it('hides the empty hint with ≥2 schema instances', () => {
    addInstance({ label: 'Dev', data: SCHEMA_DATA });
    addInstance({ label: 'Test', data: SCHEMA_DATA });
    initDiffInstancePicker({ loadDiffFromInstances: vi.fn() });
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

    pick('diff-compare-mount', 'Test');
    expect(loadDiffFromInstances).toHaveBeenCalledWith(a.id, b.id);
  });

  it('clears the comparison when the blank Compare option is chosen', () => {
    const loadDiffFromInstances = vi.fn();
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    const b = addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    initDiffInstancePicker({ loadDiffFromInstances });

    pick('diff-compare-mount', 'Test'); // select first…
    loadDiffFromInstances.mockClear();
    pick('diff-compare-mount', '— select compare —'); // …then clear
    expect(loadDiffFromInstances).toHaveBeenCalledWith(a.id, '');
    void b;
  });

  it('reruns the diff when the Base changes', () => {
    const loadDiffFromInstances = vi.fn();
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    const b = addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    initDiffInstancePicker({ loadDiffFromInstances });

    pick('diff-base-mount', 'Test');
    expect(loadDiffFromInstances).toHaveBeenCalledWith(b.id, expect.any(String));
    void instancesState;
  });

  it('swaps base and compare when the swap button is clicked', () => {
    const loadDiffFromInstances = vi.fn();
    const a = addInstance({ label: 'Dev', data: SCHEMA_DATA });
    const b = addInstance({ label: 'Test', data: SCHEMA_DATA });
    selectInstance(a.id);
    initDiffInstancePicker({ loadDiffFromInstances });

    const swap = document.getElementById('diff-swap-btn');
    expect(swap.disabled).toBe(true); // no compare yet → nothing to swap

    pick('diff-compare-mount', 'Test');
    refreshDiffPicker();
    expect(swap.disabled).toBe(false);

    loadDiffFromInstances.mockClear();
    swap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // base ⇄ compare: previous compare (b) becomes base, previous base (a) compare.
    expect(loadDiffFromInstances).toHaveBeenCalledWith(b.id, a.id);
  });
});

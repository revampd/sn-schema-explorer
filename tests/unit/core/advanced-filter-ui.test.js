/**
 * @vitest-environment jsdom
 *
 * UI-level tests for the filter builder in src/core/advanced-filter.js
 * (#47.5 / #46.6): buildFilterPanel DOM construction, add/remove, singleton
 * enforcement, operator cycling, and the active-filter badge.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { buildFilterPanel } from '../../../src/core/advanced-filter.js';
import { graphState, uiState } from '../../../src/core/state.js';

vi.mock('../../../src/core/state.js', () => ({
  graphState: { graphData: null, scopeColorMap: {} },
  uiState: { filterConditions: [], selectedScopes: new Set() },
}));

vi.mock('../../../src/modules/settings/index.js', () => ({
  Settings: {
    isCustomName: id => id.startsWith('u_') || id.startsWith('x_'),
    isEnabled: () => false,
  },
}));

const NODES = [
  { id: 'task', label: 'Task', scope: 'global', _isView: false, fields: [{ name: 'number' }] },
  { id: 'incident', label: 'Incident', scope: 'global', _isView: false, fields: [] },
  { id: 'sn_hr_case', label: 'HR Case', scope: 'sn_hr_core', _isView: false, fields: [] },
];

let container;
beforeEach(() => {
  document.body.innerHTML =
    '<span id="filter-badge" style="display:none"></span>' +
    '<button id="scope-filter-btn"></button>' +
    '<div id="filter-bar"></div>' +
    '<div id="container"></div>';
  container = document.getElementById('container');
  uiState.filterConditions = [];
  uiState.selectedScopes = new Set();
  graphState.graphData = { nodes: NODES };
});

// Click the "+ Add condition" picker item whose label matches.
// The picker is portalled to <body>, so query the document, not the container.
function addCondition(label) {
  container.querySelector('.fc-add-btn').click();
  const item = [...document.querySelectorAll('.fc-picker-item')].find(
    el => el.textContent === label
  );
  if (!item) throw new Error('picker item not found: ' + label);
  item.click();
}

describe('buildFilterPanel — add / remove', () => {
  it('adds a condition via the picker, mutates state, and fires onApply', () => {
    const onApply = vi.fn();
    buildFilterPanel(container, { onApply });

    addCondition('Application Scope');

    expect(uiState.filterConditions).toHaveLength(1);
    expect(uiState.filterConditions[0].type).toBe('scope');
    expect(onApply).toHaveBeenCalled();
    expect(container.querySelectorAll('.fc-row')).toHaveLength(1);
  });

  it('removes a condition row and fires onApply', () => {
    const onApply = vi.fn();
    buildFilterPanel(container, { onApply });
    addCondition('Table Name');
    expect(uiState.filterConditions).toHaveLength(1);

    onApply.mockClear();
    container.querySelector('.fc-remove-btn').click();

    expect(uiState.filterConditions).toHaveLength(0);
    expect(onApply).toHaveBeenCalled();
    expect(container.querySelectorAll('.fc-row')).toHaveLength(0);
  });
});

describe('buildFilterPanel — singleton enforcement', () => {
  it('hides an already-added singleton type from the picker', () => {
    buildFilterPanel(container, {});
    addCondition('Application Scope');

    container.querySelector('.fc-add-btn').click();
    const labels = [...document.querySelectorAll('.fc-picker-item')].map(el => el.textContent);
    expect(labels).not.toContain('Application Scope');
    // multi-instance types remain available
    expect(labels).toContain('Table Name');
  });

  it('keeps multi-instance types (Table Name) addable more than once', () => {
    buildFilterPanel(container, {});
    addCondition('Table Name');
    addCondition('Table Name');
    expect(uiState.filterConditions.filter(c => c.type === 'name')).toHaveLength(2);
  });
});

describe('buildFilterPanel — operator cycling', () => {
  it('cycles the Table Name operator startsWith → contains → is → startsWith', () => {
    buildFilterPanel(container, {});
    addCondition('Table Name');
    expect(uiState.filterConditions[0].operator).toBe('startsWith');

    const toggle = () => container.querySelector('.fc-op-toggle').click();
    toggle();
    expect(uiState.filterConditions[0].operator).toBe('contains');
    toggle();
    expect(uiState.filterConditions[0].operator).toBe('is');
    toggle();
    expect(uiState.filterConditions[0].operator).toBe('startsWith');
  });
});

describe('buildFilterPanel — active-filter badge', () => {
  it('reflects the number of active conditions', () => {
    buildFilterPanel(container, {});
    const badge = document.getElementById('filter-badge');
    expect(badge.style.display).toBe('none');

    addCondition('Application Scope');
    expect(badge.textContent).toBe('1');
    expect(badge.style.display).not.toBe('none');

    addCondition('Table Name');
    expect(badge.textContent).toBe('2');
  });
});

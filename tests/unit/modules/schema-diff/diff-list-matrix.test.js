/**
 * @vitest-environment jsdom
 *
 * Unit tests for the N-column roll-up branch of the diff sidebar list (#150),
 * schema-diff/build-list.js → buildMatrixList. Exercises the multi-compare path
 * (one row per differing table + a per-instance status strip) which the e2e suite
 * can't reach until the multi-select header (PR ④) lands.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../src/modules/settings/index.js', () => ({
  Settings: { isEnabled: () => false, isCustomName: () => false },
}));
vi.mock('../../../../src/core/dom.js', () => ({ Dom: { searchBox: null } }));
vi.mock('../../../../src/modules/search/index.js', () => ({ getSearchMode: () => 'tables' }));
vi.mock('../../../../src/core/advanced-filter.js', () => ({ filterOk: () => true }));
vi.mock('../../../../src/core/table-list.js', () => ({ buildTableList: vi.fn() }));

import { diffBuildList } from '../../../../src/modules/schema-diff/build-list.js';
import { computeDiff } from '../../../../src/modules/schema-diff/compute-diff.js';
import { diffState, uiState } from '../../../../src/core/state.js';

const node = (id, fields = []) => ({ id, fields });
const f = (name, type = 'string') => ({ name, type });

const base = {
  nodes: [node('task', [f('a')]), node('incident', [f('a')]), node('note')],
  edges: [],
};
// prod: incident removed, problem added, task unchanged
const prod = { nodes: [node('task', [f('a')]), node('problem'), node('note')], edges: [] };
// uat: task changed (b added), incident unchanged, note unchanged
const uat = {
  nodes: [node('task', [f('a'), f('b')]), node('incident', [f('a')]), node('note')],
  edges: [],
};

function setMatrix(subjects) {
  const matrix = subjects.map(s => {
    const diff = computeDiff(base, s.data);
    diff._compareId = s.id;
    diff._compareLabel = s.label;
    return diff;
  });
  diffState._diffMatrix = matrix;
  diffState._diffData = matrix[0];
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '<div id="diff-list"></div>';
  uiState.filterConditions = [];
  uiState.selectedNode = null;
  diffState._diffFilter = 'all';
  setMatrix([
    { id: 'i_prod', label: 'prod', data: prod },
    { id: 'i_uat', label: 'uat', data: uat },
  ]);
});

describe('diffBuildList — N-column roll-up', () => {
  it('renders one row per differing table with a header count', () => {
    diffBuildList();
    const header = document.querySelector('.diff-group-header');
    // task (changed in uat), incident (removed in prod), problem (added in prod).
    // note is identical everywhere → excluded.
    expect(header.textContent.replace('▾', '')).toBe('Differs across instances (3)');
    const ids = [...document.querySelectorAll('.diff-item')].map(i => i.dataset.id);
    expect(ids).toEqual(['incident', 'problem', 'task']);
  });

  it('gives each row a per-instance status strip (one chip per compare)', () => {
    diffBuildList();
    const taskRow = document.querySelector('.diff-item[data-id="task"]');
    const chips = taskRow.querySelectorAll('.diff-item-cols .dic-chip');
    expect(chips).toHaveLength(2); // prod, uat
    // task: same in prod, changed in uat
    expect(chips[0].className).toContain('dic-same');
    expect(chips[1].className).toContain('dic-changed');
  });

  it('chips reflect added / removed per instance', () => {
    diffBuildList();
    const incident = document.querySelector('.diff-item[data-id="incident"] .dic-chip');
    expect(incident.className).toContain('dic-removed'); // removed in prod
    const problem = document.querySelector('.diff-item[data-id="problem"] .dic-chip');
    expect(problem.className).toContain('dic-added'); // added in prod
  });

  it('respects the status filter (changed only)', () => {
    diffState._diffFilter = 'changed';
    diffBuildList();
    const ids = [...document.querySelectorAll('.diff-item')].map(i => i.dataset.id);
    expect(ids).toEqual(['task']); // only task is "changed" in any instance
  });

  it('Kind filter applies to added/removed rows — filters out tables with no matching edge type', () => {
    // prod adds "problem" (a plain table with fields, no view edges)
    // uat adds "view_extra" (a view with a view edge)
    const viewEdge = { source: 'view_extra', target: 'task', type: 'view' };
    const baseFull = { nodes: [node('task')], edges: [] };
    const prodFull = { nodes: [node('task'), node('problem', [f('x')])], edges: [] };
    const uatFull  = { nodes: [node('task'), node('view_extra')], edges: [viewEdge] };
    const m1 = computeDiff(baseFull, prodFull);
    m1._compareId = 'i_prod';
    const m2 = computeDiff(baseFull, uatFull);
    m2._compareId = 'i_uat';
    diffState._diffMatrix = [m1, m2];
    diffState._diffData = m1;
    diffState._diffElementFilter = ['view'];

    diffBuildList();
    const ids = [...document.querySelectorAll('.diff-item')].map(i => i.dataset.id);
    // "problem" has only fields — should be filtered out when Kind=view
    // "view_extra" has a view edge — should appear
    expect(ids).not.toContain('problem');
    expect(ids).toContain('view_extra');

    diffState._diffElementFilter = null;
  });

  it('renders edge sub-rows for tables that gained/lost relationships across compares', () => {
    // base has task with no edges; prod adds a view edge on task; uat removes nothing.
    const viewEdge = { source: 'task', target: 'task_view', type: 'view' };
    const baseFull = { nodes: [node('task'), node('task_view')], edges: [] };
    const prodFull = { nodes: [node('task'), node('task_view')], edges: [viewEdge] };
    const uatFull  = { nodes: [node('task'), node('task_view')], edges: [] };
    setMatrix([
      { id: 'i_prod', label: 'prod', data: prodFull },
      { id: 'i_uat',  label: 'uat',  data: uatFull },
    ]);
    // Override base to baseFull for this test
    diffState._diffMatrix[0] = computeDiff(baseFull, prodFull);
    diffState._diffMatrix[0]._compareId = 'i_prod';
    diffState._diffMatrix[1] = computeDiff(baseFull, uatFull);
    diffState._diffMatrix[1]._compareId = 'i_uat';
    diffState._diffData = diffState._diffMatrix[0];

    diffBuildList();
    const subgroup = document.querySelector('.diff-edge-subgroup');
    expect(subgroup).not.toBeNull();
    const edgeItem = subgroup.querySelector('.diff-edge-item');
    expect(edgeItem).not.toBeNull();
    expect(edgeItem.querySelector('.diff-edge-type').textContent).toBe('view');
    // Only one edge even though the matrix has 2 diffs (dedup by key)
    expect(subgroup.querySelectorAll('.diff-edge-item')).toHaveLength(1);
  });
});

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
});

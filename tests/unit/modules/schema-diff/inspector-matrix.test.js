/**
 * @vitest-environment jsdom
 *
 * Unit tests for the unified N-column comparison inspector (#150),
 * schema-diff/inspector-diff.js → diffFillInspector. Exercises the matrix at
 * N≥3 columns — which the e2e suite can't reach until the multi-select header
 * (PR ④) lands — plus the N=2 parity case and the fall-through to the rich
 * single-subject inspector when a table is identical everywhere.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Lightweight stand-ins for collaborators with their own tests / heavy deps.
const { inspectorContent } = vi.hoisted(() => ({
  inspectorContent: document.createElement('div'),
}));
vi.mock('../../../../src/core/dom.js', () => ({
  Dom: { inspectorEmpty: { style: {} }, inspectorContent },
}));
vi.mock('../../../../src/core/render.js', () => ({ typeLabel: t => t }));
vi.mock('../../../../src/modules/settings/index.js', () => ({
  Settings: { isEnabled: () => false, isCustomName: () => false },
}));
vi.mock('../../../../src/core/inspector.js', () => ({
  focusTable: vi.fn(),
  clearSelection: vi.fn(),
}));
// Config drift not comparable here — keeps the focus on the field/column matrix.
vi.mock('../../../../src/modules/schema-diff/config-drift.js', () => ({
  makeConfigDrift: () => ({ comparable: false, forScope: () => null }),
}));
vi.mock('../../../../src/modules/config-data/reconcile.js', () => ({ STATUS_LABELS: {} }));

import { diffFillInspector } from '../../../../src/modules/schema-diff/inspector-diff.js';
import { computeDiff } from '../../../../src/modules/schema-diff/compute-diff.js';
import { diffState, instancesState, uiState } from '../../../../src/core/state.js';

const node = (id, fields = [], scope = 'global') => ({ id, fields, scope });
const f = (name, type = 'string') => ({ name, type });

// base: task[a,b], incident[a], note[a]
const base = {
  nodes: [node('task', [f('a'), f('b')]), node('incident', [f('a')]), node('note', [f('a')])],
  edges: [],
};
// prod: task[a] (b removed), incident[a], note[a], problem[x] (added)
const prod = {
  nodes: [
    node('task', [f('a')]),
    node('incident', [f('a')]),
    node('note', [f('a')]),
    node('problem', [f('x')]),
  ],
  edges: [],
};
// uat: task[a,b:integer] (b changed), note[a]  (incident removed)
const uat = {
  nodes: [node('task', [f('a'), f('b', 'integer')]), node('note', [f('a')])],
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
  diffState._compareIds = subjects.map(s => s.id);
}

beforeEach(() => {
  inspectorContent.innerHTML = '';
  uiState.viewMode = 'force';
  uiState.selectedNode = null;
  instancesState.selectedId = 'i_base';
  instancesState.instances = [
    { id: 'i_base', label: 'base', data: base, capabilities: { schema: true } },
    { id: 'i_prod', label: 'prod', data: prod, capabilities: { schema: true } },
    { id: 'i_uat', label: 'uat', data: uat, capabilities: { schema: true } },
  ];
  // getInstance() resolves via the _byId index (reindex() is internal) — rebuild it.
  instancesState._byId.clear();
  instancesState.instances.forEach((e, i) => instancesState._byId.set(e.id, i));
});

describe('diffFillInspector — N≥3 columns', () => {
  beforeEach(() => {
    setMatrix([
      { id: 'i_prod', label: 'prod', data: prod },
      { id: 'i_uat', label: 'uat', data: uat },
    ]);
  });

  it('renders one column header per instance (Base + each compare)', () => {
    expect(diffFillInspector({ id: 'task', scope: 'global' })).toBe(true);
    const headers = [...inspectorContent.querySelectorAll('.diff-sbs-col-header')].map(
      h => h.textContent
    );
    expect(headers).toEqual(['base', 'prod', 'uat']);
  });

  it('colours the changed field cell per column (removed in prod, type-changed in uat)', () => {
    diffFillInspector({ id: 'task', scope: 'global' });
    // Field "b": present in base, absent in prod (removed), integer in uat (changed).
    expect(inspectorContent.querySelector('.diff-field-row.dfr-removed')).toBeTruthy();
    expect(inspectorContent.querySelector('.diff-field-row.dfr-changed')).toBeTruthy();
    expect(inspectorContent.textContent).toContain('integer');
    // Field "a" is identical across all three → not shown, reported as unchanged.
    expect(inspectorContent.textContent).toMatch(/identical across all instances/);
  });

  it('shows a per-instance status chip strip', () => {
    diffFillInspector({ id: 'task', scope: 'global' });
    const chips = [...inspectorContent.querySelectorAll('.diff-col-chip')];
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toContain('base');
  });
});

describe('diffFillInspector — N=2 parity + fall-through', () => {
  it('renders 2 columns for a single compare', () => {
    setMatrix([{ id: 'i_prod', label: 'prod', data: prod }]);
    expect(diffFillInspector({ id: 'task', scope: 'global' })).toBe(true);
    expect(inspectorContent.querySelectorAll('.diff-sbs-col-header')).toHaveLength(2);
  });

  it('returns false (rich inspector renders) when the table is identical everywhere', () => {
    setMatrix([
      { id: 'i_prod', label: 'prod', data: prod },
      { id: 'i_uat', label: 'uat', data: uat },
    ]);
    // "note" is byte-identical across base/prod/uat and has no config drift.
    expect(diffFillInspector({ id: 'note', scope: 'global' })).toBe(false);
  });

  it('returns false when not comparing', () => {
    diffState._diffMatrix = null;
    diffState._diffData = null;
    expect(diffFillInspector({ id: 'task' })).toBe(false);
  });
});

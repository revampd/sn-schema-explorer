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
vi.mock('../../../../src/core/render.js', () => ({
  typeLabel: t => t,
  typeBadgeColor: () => '#888',
}));
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

  it('renders a Properties section (parity with the single inspector)', () => {
    diffFillInspector({ id: 'task', scope: 'global' });
    const titles = [...inspectorContent.querySelectorAll('.diff-insp-section-title')].map(
      e => e.textContent
    );
    expect(titles).toContain('Properties');
    const keys = [...inspectorContent.querySelectorAll('.diff-props-key')].map(e => e.textContent);
    expect(keys).toEqual(['scope', 'core', 'children', 'records']);
  });

  it('shows record counts but never flags them as a diff', () => {
    // task has differing record counts across the three instances.
    base.nodes.find(n => n.id === 'task').recordCount = 100;
    prod.nodes.find(n => n.id === 'task').recordCount = 5000;
    uat.nodes.find(n => n.id === 'task').recordCount = 250;
    diffFillInspector({ id: 'task', scope: 'global' });

    const rows = [...inspectorContent.querySelectorAll('.diff-props-row')];
    const recordsRow = rows.find(
      r => r.querySelector('.diff-props-key')?.textContent === 'records'
    );
    // The differing counts are displayed…
    expect(recordsRow.textContent).toContain('5,000');
    // …but no cell is highlighted as changed (record counts aren't a diff).
    expect(recordsRow.querySelector('.diff-props-cell.dfr-changed')).toBeNull();
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

describe('diffFillInspector — relationship matrix (#150)', () => {
  // base: incident → sys_user (reference) and incident ⇄ grp (m2m)
  const relBase = {
    nodes: [node('incident', [f('a')]), node('sys_user'), node('grp')],
    edges: [
      { source: 'incident', target: 'sys_user', type: 'reference', field: 'caller' },
      { source: 'incident', target: 'grp', type: 'm2m' },
    ],
  };
  // compare: the reference is removed, a named relationship is added; m2m unchanged.
  const relCmp = {
    nodes: [node('incident', [f('a')]), node('sys_user'), node('grp'), node('plan')],
    edges: [
      { source: 'incident', target: 'grp', type: 'm2m' },
      { source: 'incident', target: 'plan', type: 'rel' },
    ],
  };

  it('renders one row per changed relationship under legend labels, never raw types', () => {
    instancesState.instances.push({
      id: 'i_rel',
      label: 'relc',
      data: relCmp,
      capabilities: { schema: true },
    });
    instancesState.instances[0].data = relBase; // base = relBase
    instancesState._byId.clear();
    instancesState.instances.forEach((e, i) => instancesState._byId.set(e.id, i));
    const diff = computeDiff(relBase, relCmp);
    diff._compareId = 'i_rel';
    diff._compareLabel = 'relc';
    diffState._diffMatrix = [diff];
    diffState._diffData = diff;

    expect(diffFillInspector({ id: 'incident', scope: 'global' })).toBe(true);

    // One matrix row per CHANGED relationship (m2m to grp is unchanged → not shown).
    const rows = [...inspectorContent.querySelectorAll('.diff-rel-matrix-row[data-id]')];
    const ids = rows.map(r => r.dataset.id).sort();
    expect(ids).toEqual(['plan', 'sys_user']);

    // Friendly legend labels, not raw edge types.
    const kinds = [...inspectorContent.querySelectorAll('.diff-rel-kind')].map(e => e.textContent);
    expect(kinds).toContain('Reference to'); // sys_user (removed)
    expect(kinds).toContain('Named relationship'); // plan (added)
    expect(inspectorContent.textContent).not.toMatch(/\breference\b/);

    // Presence cells: sys_user removed in compare (red), plan added (green).
    const sysUserRow = rows.find(r => r.dataset.id === 'sys_user');
    expect(sysUserRow.querySelector('.diff-rel-cell.dfr-removed')).toBeTruthy();
    const planRow = rows.find(r => r.dataset.id === 'plan');
    expect(planRow.querySelector('.diff-rel-cell.dfr-added')).toBeTruthy();
  });

  it('surfaces an inherited relationship from a parent table, tagged inherited', () => {
    // parent `task` references sys_user; child `incident` extends task and owns a
    // changed field so it's flagged. The compare drops the parent's reference →
    // the inherited relationship differs and must show on the child.
    const base2 = {
      nodes: [node('task'), node('incident', [f('a')]), node('sys_user')],
      edges: [
        { source: 'incident', target: 'task', type: 'extends' },
        { source: 'task', target: 'sys_user', type: 'reference', field: 'owner' },
      ],
    };
    const cmp2 = {
      nodes: [node('task'), node('incident', [f('a', 'integer')]), node('sys_user')],
      edges: [{ source: 'incident', target: 'task', type: 'extends' }], // parent ref dropped
    };
    instancesState.instances = [
      { id: 'i_base', label: 'base', data: base2, capabilities: { schema: true } },
      { id: 'i_cmp', label: 'cmp', data: cmp2, capabilities: { schema: true } },
    ];
    instancesState.selectedId = 'i_base';
    instancesState._byId.clear();
    instancesState.instances.forEach((e, i) => instancesState._byId.set(e.id, i));
    const diff = computeDiff(base2, cmp2);
    diff._compareId = 'i_cmp';
    diff._compareLabel = 'cmp';
    diffState._diffMatrix = [diff];
    diffState._diffData = diff;

    expect(diffFillInspector({ id: 'incident', scope: 'global' })).toBe(true);
    const ownerRow = [...inspectorContent.querySelectorAll('.diff-rel-matrix-row[data-id]')].find(
      r => r.dataset.id === 'sys_user'
    );
    expect(ownerRow).toBeTruthy();
    expect(ownerRow.querySelector('.diff-field-inh')).toBeTruthy(); // inherited tag
  });
});

describe('diffFillInspector — inheritance-aware fields (#150)', () => {
  // parent `task`[a]; child `incident` extends task, owns [b].
  const inhBase = {
    nodes: [node('task', [f('a')]), node('incident', [f('b')])],
    edges: [{ source: 'incident', target: 'task', type: 'extends' }],
  };
  // compare changes the child's OWN field (so the table is flagged changed) AND
  // the parent's inherited field type.
  const inhCmp = {
    nodes: [node('task', [f('a', 'integer')]), node('incident', [f('b', 'integer')])],
    edges: [{ source: 'incident', target: 'task', type: 'extends' }],
  };

  it('surfaces an inherited field on the child when it differs, tagged inherited', () => {
    instancesState.instances = [
      { id: 'i_base', label: 'base', data: inhBase, capabilities: { schema: true } },
      { id: 'i_cmp', label: 'cmp', data: inhCmp, capabilities: { schema: true } },
    ];
    instancesState.selectedId = 'i_base';
    instancesState._byId.clear();
    instancesState.instances.forEach((e, i) => instancesState._byId.set(e.id, i));
    const diff = computeDiff(inhBase, inhCmp);
    diff._compareId = 'i_cmp';
    diff._compareLabel = 'cmp';
    diffState._diffMatrix = [diff];
    diffState._diffData = diff;

    // 'incident' has no OWN field change, but its inherited 'a' differs (parent
    // changed) — the matrix must show it, tagged as inherited.
    expect(diffFillInspector({ id: 'incident', scope: 'global' })).toBe(true);
    const names = [...inspectorContent.querySelectorAll('.diff-field-name')].map(e =>
      e.textContent.replace('inherited', '').trim()
    );
    expect(names).toContain('a');
    expect(inspectorContent.querySelector('.diff-field-inh')).toBeTruthy();
  });

  it('flags a table whose ONLY difference is an inherited field (parent changed)', () => {
    // incident's own field b is unchanged; only the parent task's inherited a
    // differs. The single view always shows inherited fields, so the diff must
    // surface incident too — even though computeDiff (own-fields-only) calls it
    // "same". The column status upgrades to "changed".
    const base2 = {
      nodes: [node('task', [f('a')]), node('incident', [f('b')])],
      edges: [{ source: 'incident', target: 'task', type: 'extends' }],
    };
    const cmp2 = {
      nodes: [node('task', [f('a', 'integer')]), node('incident', [f('b')])],
      edges: [{ source: 'incident', target: 'task', type: 'extends' }],
    };
    instancesState.instances = [
      { id: 'i_base', label: 'base', data: base2, capabilities: { schema: true } },
      { id: 'i_cmp', label: 'cmp', data: cmp2, capabilities: { schema: true } },
    ];
    instancesState.selectedId = 'i_base';
    instancesState._byId.clear();
    instancesState.instances.forEach((e, i) => instancesState._byId.set(e.id, i));
    const diff = computeDiff(base2, cmp2);
    diff._compareId = 'i_cmp';
    diff._compareLabel = 'cmp';
    diffState._diffMatrix = [diff];
    diffState._diffData = diff;

    // computeDiff alone would NOT flag incident (no own change)…
    expect(diff.changed.has('incident')).toBe(false);
    // …but the inheritance-aware inspector renders it, with the compare column
    // marked changed (green→amber).
    expect(diffFillInspector({ id: 'incident', scope: 'global' })).toBe(true);
    const chips = [...inspectorContent.querySelectorAll('.diff-col-chip')];
    expect(chips[1].className).toContain('cstat-changed');
  });
});

/**
 * Unit tests for src/modules/schema-diff/compute-diff.js
 *
 * computeDiff is a pure function — no DOM or state dependencies.
 */
import { describe, it, expect } from 'vitest';
import { computeDiff } from '../../src/modules/schema-diff/compute-diff.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeSchema(nodes = [], edges = []) {
  return { nodes, edges };
}
function makeNode(id, fields = []) {
  return { id, fields };
}
function makeField(name, type = 'string') {
  return { name, type };
}
function makeEdge(source, target, type, field = '') {
  return { source, target, type, ...(field ? { field } : {}) };
}

// ── 1. Empty schemas ───────────────────────────────────────────────────────────
describe('empty schemas', () => {
  it('produces empty added/removed/changed for identical empty schemas', () => {
    const { added, removed, changed } = computeDiff(makeSchema(), makeSchema());
    expect(added.size).toBe(0);
    expect(removed.size).toBe(0);
    expect(changed.size).toBe(0);
  });
});

// ── 2. Added nodes ────────────────────────────────────────────────────────────
describe('added nodes', () => {
  it('detects a table present in compare but not in base', () => {
    const base = makeSchema([makeNode('task')]);
    const compare = makeSchema([makeNode('task'), makeNode('incident')]);
    const { added } = computeDiff(base, compare);
    expect(added.has('incident')).toBe(true);
    expect(added.size).toBe(1);
  });

  it('does not add tables that exist in both schemas', () => {
    const base = makeSchema([makeNode('task')]);
    const compare = makeSchema([makeNode('task')]);
    const { added } = computeDiff(base, compare);
    expect(added.size).toBe(0);
  });
});

// ── 3. Removed nodes ──────────────────────────────────────────────────────────
describe('removed nodes', () => {
  it('detects a table present in base but missing from compare', () => {
    const base = makeSchema([makeNode('task'), makeNode('incident')]);
    const compare = makeSchema([makeNode('task')]);
    const { removed } = computeDiff(base, compare);
    expect(removed.has('incident')).toBe(true);
    expect(removed.size).toBe(1);
  });
});

// ── 4. Changed fields ─────────────────────────────────────────────────────────
describe('changed — field added in compare', () => {
  it('appears in addedFields for that table', () => {
    const base = makeSchema([makeNode('task', [makeField('sys_id')])]);
    const compare = makeSchema([makeNode('task', [makeField('sys_id'), makeField('number')])]);
    const { changed } = computeDiff(base, compare);
    expect(changed.has('task')).toBe(true);
    expect(changed.get('task').addedFields).toHaveLength(1);
    expect(changed.get('task').addedFields[0].name).toBe('number');
  });
});

describe('changed — field removed from compare', () => {
  it('appears in removedFields for that table', () => {
    const base = makeSchema([makeNode('task', [makeField('sys_id'), makeField('number')])]);
    const compare = makeSchema([makeNode('task', [makeField('sys_id')])]);
    const { changed } = computeDiff(base, compare);
    expect(changed.has('task')).toBe(true);
    expect(changed.get('task').removedFields).toHaveLength(1);
    expect(changed.get('task').removedFields[0].name).toBe('number');
  });
});

describe('changed — field type changed', () => {
  it('appears in changedFields with both old and new type', () => {
    const base = makeSchema([makeNode('task', [makeField('priority', 'integer')])]);
    const compare = makeSchema([makeNode('task', [makeField('priority', 'string')])]);
    const { changed } = computeDiff(base, compare);
    expect(changed.has('task')).toBe(true);
    const cf = changed.get('task').changedFields;
    expect(cf).toHaveLength(1);
    expect(cf[0].name).toBe('priority');
    expect(cf[0].baseType).toBe('integer');
    expect(cf[0].compareType).toBe('string');
  });
});

// ── 5. Unchanged tables ───────────────────────────────────────────────────────
describe('unchanged tables', () => {
  it('does not appear in changed map when fields and edges are identical', () => {
    const node = makeNode('task', [makeField('sys_id')]);
    const base = makeSchema([node], [makeEdge('task', 'sys_user', 'reference', 'assigned_to')]);
    const compare = makeSchema([node], [makeEdge('task', 'sys_user', 'reference', 'assigned_to')]);
    const { changed } = computeDiff(base, compare);
    expect(changed.has('task')).toBe(false);
  });
});

// ── 6. Added edges ────────────────────────────────────────────────────────────
describe('changed — edge added in compare', () => {
  it('assigns addedEdge to the source table entry in changed', () => {
    const base = makeSchema([makeNode('task'), makeNode('sys_user')]);
    const compare = makeSchema(
      [makeNode('task'), makeNode('sys_user')],
      [makeEdge('task', 'sys_user', 'reference', 'assigned_to')]
    );
    const { changed } = computeDiff(base, compare);
    expect(changed.has('task')).toBe(true);
    expect(changed.get('task').addedEdges).toHaveLength(1);
    expect(changed.get('task').addedEdges[0].field).toBe('assigned_to');
  });
});

// ── 7. Removed edges ──────────────────────────────────────────────────────────
describe('changed — edge removed from compare', () => {
  it('assigns removedEdge to the source table entry in changed', () => {
    const base = makeSchema(
      [makeNode('task'), makeNode('sys_user')],
      [makeEdge('task', 'sys_user', 'reference', 'assigned_to')]
    );
    const compare = makeSchema([makeNode('task'), makeNode('sys_user')]);
    const { changed } = computeDiff(base, compare);
    expect(changed.has('task')).toBe(true);
    expect(changed.get('task').removedEdges).toHaveLength(1);
  });
});

// ── 8. edgeDiffKey handles object source/target ───────────────────────────────
describe('edgeDiffKey', () => {
  it('treats object {id} source/target the same as plain string', () => {
    const base = makeSchema(
      [makeNode('task'), makeNode('sys_user')],
      [makeEdge('task', 'sys_user', 'reference', 'assigned_to')]
    );
    // Compare has the same edge but with object-format source/target (D3 sim format)
    const compare = makeSchema(
      [makeNode('task'), makeNode('sys_user')],
      [
        {
          source: { id: 'task' },
          target: { id: 'sys_user' },
          type: 'reference',
          field: 'assigned_to',
        },
      ]
    );
    const { changed } = computeDiff(base, compare);
    // Same edge expressed differently → no change
    expect(changed.has('task')).toBe(false);
  });
});

// ── 9. baseMap / compareMap populated ────────────────────────────────────────
describe('output maps', () => {
  it('baseMap and compareMap are keyed by node id', () => {
    const base = makeSchema([makeNode('task')]);
    const compare = makeSchema([makeNode('task'), makeNode('incident')]);
    const { baseMap, compareMap } = computeDiff(base, compare);
    expect(baseMap.has('task')).toBe(true);
    expect(compareMap.has('task')).toBe(true);
    expect(compareMap.has('incident')).toBe(true);
    expect(baseMap.has('incident')).toBe(false);
  });
});

// ── Edge-set outputs: allAddedEdges / allRemovedEdges (#47.10) ────────────────
describe('edge-set outputs', () => {
  const nodes = [makeNode('task'), makeNode('sys_user')];

  it('reports an edge present only in compare as added', () => {
    const base = makeSchema(nodes, []);
    const compare = makeSchema(nodes, [makeEdge('task', 'sys_user', 'reference', 'assigned_to')]);
    const { allAddedEdges, allRemovedEdges } = computeDiff(base, compare);
    expect(allAddedEdges).toHaveLength(1);
    expect(allAddedEdges[0]).toMatchObject({
      source: 'task',
      target: 'sys_user',
      type: 'reference',
    });
    expect(allRemovedEdges).toHaveLength(0);
  });

  it('reports an edge present only in base as removed', () => {
    const base = makeSchema(nodes, [makeEdge('task', 'sys_user', 'reference', 'assigned_to')]);
    const compare = makeSchema(nodes, []);
    const { allAddedEdges, allRemovedEdges } = computeDiff(base, compare);
    expect(allRemovedEdges).toHaveLength(1);
    expect(allRemovedEdges[0]).toMatchObject({ source: 'task', target: 'sys_user' });
    expect(allAddedEdges).toHaveLength(0);
  });

  it('reports neither when the edge set is identical', () => {
    const edges = [makeEdge('task', 'sys_user', 'reference', 'assigned_to')];
    const { allAddedEdges, allRemovedEdges } = computeDiff(
      makeSchema(nodes, edges),
      makeSchema(nodes, edges)
    );
    expect(allAddedEdges).toHaveLength(0);
    expect(allRemovedEdges).toHaveLength(0);
  });
});

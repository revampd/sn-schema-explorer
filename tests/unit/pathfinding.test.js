/**
 * Unit tests for src/viewer/modules/path-finder/pathfinding.js
 *
 * pathfinding.js depends on graphState and uiState from state.js.
 * We mock state.js and mutate graphState.graphData before each test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock state.js before importing the module under test ────────────────────
// vi.mock is hoisted by vitest, so this runs before any imports below.
vi.mock('../../src/viewer/core/state.js', () => ({
  graphState: { graphData: { nodes: [], edges: [] } },
  uiState:    { pfExcludedHops: new Set() },
}));

import { graphState, uiState } from '../../src/viewer/core/state.js';
import { Pathfinding }  from '../../src/viewer/modules/path-finder/pathfinding.js';

const { tableToTable, tableToTableK, tableToField, fieldOwners, fieldDefinedAt, ancestorsOf } = Pathfinding;

// ── Helpers ──────────────────────────────────────────────────────────────────
function setGraph(nodes, edges) {
  // Replace the reference so the adjacency cache invalidates
  graphState.graphData = { nodes, edges };
}
function node(id, label) {
  return { id, label: label ?? id, scope: 'Global', fields: [] };
}
function nodeWithFields(id, ...fieldNames) {
  return { id, label: id, scope: 'Global', fields: fieldNames.map(n => ({ name: n })) };
}
function refEdge(source, target, field = 'ref') {
  return { source, target, type: 'reference', field, label: field };
}
function extEdge(child, parent) {
  return { source: child, target: parent, type: 'extends', label: 'extends' };
}

// ── Reset graph and exclusions before each test ──────────────────────────────
beforeEach(() => {
  setGraph([], []);
  uiState.pfExcludedHops.clear();
});

// ── tableToTable ──────────────────────────────────────────────────────────────
describe('tableToTable', () => {
  it('returns null when source and target are the same', () => {
    setGraph([node('task')], []);
    expect(tableToTable('task', 'task')).toBeNull();
  });

  it('returns null when no path exists between disconnected nodes', () => {
    setGraph([node('task'), node('sys_user')], []);
    expect(tableToTable('task', 'sys_user')).toBeNull();
  });

  it('finds a direct reference edge', () => {
    setGraph(
      [node('task'), node('sys_user')],
      [refEdge('task', 'sys_user', 'assigned_to')]
    );
    const result = tableToTable('task', 'sys_user');
    expect(result).not.toBeNull();
    expect(result.path).toEqual(['task', 'sys_user']);
  });

  it('finds a path via an intermediate table', () => {
    setGraph(
      [node('incident'), node('task'), node('sys_user')],
      [extEdge('incident', 'task'), refEdge('task', 'sys_user', 'assigned_to')]
    );
    const result = tableToTable('incident', 'sys_user');
    expect(result).not.toBeNull();
    expect(result.path).toEqual(['incident', 'task', 'sys_user']);
  });

  it('prefers extends edges (cost 0) over reference edges (cost 1)', () => {
    // Two routes from A to C:
    //   A → B (ref, cost 1) → C (ref, cost 1)  total cost 2
    //   A → C (extends, cost 0)                 total cost 0
    setGraph(
      [node('A'), node('B'), node('C')],
      [
        refEdge('A', 'B', 'ref_b'),
        refEdge('B', 'C', 'ref_c'),
        extEdge('A', 'C'),
      ]
    );
    const result = tableToTable('A', 'C');
    expect(result).not.toBeNull();
    expect(result.path).toEqual(['A', 'C']);
    expect(result.totalCost).toBe(0);
  });

  it('returns null for unknown source node', () => {
    setGraph([node('task')], []);
    expect(tableToTable('nonexistent', 'task')).toBeNull();
  });

  it('returns null for unknown target node', () => {
    setGraph([node('task')], []);
    expect(tableToTable('task', 'nonexistent')).toBeNull();
  });
});

// ── tableToTableK ─────────────────────────────────────────────────────────────
describe('tableToTableK', () => {
  it('returns an empty array when no path exists', () => {
    setGraph([node('A'), node('B')], []);
    expect(tableToTableK('A', 'B', 3)).toEqual([]);
  });

  it('returns at least the shortest path', () => {
    setGraph(
      [node('task'), node('sys_user')],
      [refEdge('task', 'sys_user')]
    );
    const paths = tableToTableK('task', 'sys_user', 3);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(paths[0].path).toEqual(['task', 'sys_user']);
  });

  it('returns multiple distinct paths when they exist', () => {
    // Two independent reference paths: A→B and A→C→B
    setGraph(
      [node('A'), node('B'), node('C')],
      [refEdge('A', 'B', 'direct'), refEdge('A', 'C', 'via_c'), refEdge('C', 'B', 'c_to_b')]
    );
    const paths = tableToTableK('A', 'B', 5);
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });
});

// ── tableToField ──────────────────────────────────────────────────────────────
describe('tableToField', () => {
  it('returns null when source node does not exist', () => {
    setGraph([], []);
    expect(tableToField('nonexistent', 'some_field')).toBeNull();
  });

  it('finds a field on the source table itself (zero-cost path)', () => {
    setGraph([nodeWithFields('task', 'sys_id', 'number')], []);
    const result = tableToField('task', 'sys_id');
    expect(result).not.toBeNull();
    expect(result.path).toEqual(['task']);
  });

  it('finds a field inherited from a parent via extends', () => {
    setGraph(
      [nodeWithFields('task', 'number'), nodeWithFields('incident', 'caller_id')],
      [extEdge('incident', 'task')]
    );
    const result = tableToField('incident', 'number');
    expect(result).not.toBeNull();
    // Inherited fields are considered accessible from the child with no extra hops,
    // so the path starts and ends at the source node.
    expect(result.path[0]).toBe('incident');
  });

  it('finds a field reachable via reference', () => {
    setGraph(
      [nodeWithFields('task', 'assigned_to'), nodeWithFields('sys_user', 'email')],
      [refEdge('task', 'sys_user', 'assigned_to')]
    );
    const result = tableToField('task', 'email');
    expect(result).not.toBeNull();
    expect(result.path).toEqual(['task', 'sys_user']);
  });

  it('returns null when the field does not exist anywhere reachable', () => {
    setGraph([nodeWithFields('task', 'sys_id')], []);
    expect(tableToField('task', 'nonexistent_field')).toBeNull();
  });
});

// ── hop exclusions — table-level ──────────────────────────────────────────────
describe('hop exclusions — table-level', () => {
  it('skips an excluded intermediate table, routing around it', () => {
    // A → hub → B  (hub excluded)
    // A → detour → B  (alternate route)
    setGraph(
      [node('A'), node('hub'), node('detour'), node('B')],
      [
        refEdge('A', 'hub',    'via_hub'),
        refEdge('hub', 'B',    'hub_to_b'),
        refEdge('A', 'detour', 'via_detour'),
        refEdge('detour', 'B', 'detour_to_b'),
      ]
    );
    uiState.pfExcludedHops.add('hub');

    const result = tableToTable('A', 'B');
    expect(result).not.toBeNull();
    expect(result.path).not.toContain('hub');
    expect(result.path).toEqual(['A', 'detour', 'B']);
  });

  it('returns null when the only path goes through an excluded intermediate', () => {
    // A → hub → B  (only route; hub excluded)
    setGraph(
      [node('A'), node('hub'), node('B')],
      [refEdge('A', 'hub', 'via_hub'), refEdge('hub', 'B', 'hub_to_b')]
    );
    uiState.pfExcludedHops.add('hub');

    expect(tableToTable('A', 'hub')).not.toBeNull(); // hub as TARGET is still reachable
    expect(tableToTable('A', 'B')).toBeNull();       // hub as INTERMEDIATE is blocked
  });

  it('allows an excluded table to be the path target', () => {
    // The exclusion only prevents using hub as a waypoint, not as a destination.
    setGraph(
      [node('A'), node('hub')],
      [refEdge('A', 'hub', 'ref')]
    );
    uiState.pfExcludedHops.add('hub');

    const result = tableToTable('A', 'hub');
    expect(result).not.toBeNull();
    expect(result.path).toEqual(['A', 'hub']);
  });

  it('allows an excluded table to be the path source', () => {
    setGraph(
      [node('hub'), node('B')],
      [refEdge('hub', 'B', 'ref')]
    );
    uiState.pfExcludedHops.add('hub');

    // hub is the source — it is never visited as an intermediate
    const result = tableToTable('hub', 'B');
    expect(result).not.toBeNull();
    expect(result.path).toEqual(['hub', 'B']);
  });

  it('exclusion has no effect when no path passes through the excluded table', () => {
    setGraph(
      [node('A'), node('B'), node('unrelated')],
      [refEdge('A', 'B', 'direct')]
    );
    uiState.pfExcludedHops.add('unrelated');

    const result = tableToTable('A', 'B');
    expect(result).not.toBeNull();
    expect(result.path).toEqual(['A', 'B']);
  });

  it('tableToTableK respects table exclusion for all K paths', () => {
    // Three routes: A→hub→B, A→mid→B, A→B (direct)
    setGraph(
      [node('A'), node('hub'), node('mid'), node('B')],
      [
        refEdge('A', 'B',   'direct'),
        refEdge('A', 'hub', 'r1'), refEdge('hub', 'B', 'r2'),
        refEdge('A', 'mid', 'r3'), refEdge('mid', 'B', 'r4'),
      ]
    );
    uiState.pfExcludedHops.add('hub');

    const paths = tableToTableK('A', 'B', 5);
    expect(paths.every(p => !p.path.includes('hub'))).toBe(true);
  });
});

// ── hop exclusions — field-level ──────────────────────────────────────────────
describe('hop exclusions — field-level', () => {
  it('skips an excluded reference field, routing via another field to the same target', () => {
    // task.assigned_to → sys_user  (excluded)
    // task.opened_by   → sys_user  (allowed)
    setGraph(
      [node('task'), node('sys_user')],
      [
        refEdge('task', 'sys_user', 'assigned_to'),
        refEdge('task', 'sys_user', 'opened_by'),
      ]
    );
    uiState.pfExcludedHops.add('task.assigned_to');

    const result = tableToTable('task', 'sys_user');
    expect(result).not.toBeNull();
    // The result should use opened_by, not assigned_to
    const usedField = result.steps?.[0]?.fieldName;
    expect(usedField).toBe('opened_by');
  });

  it('returns null when the only reference field to the target is excluded', () => {
    setGraph(
      [node('task'), node('sys_user')],
      [refEdge('task', 'sys_user', 'assigned_to')]
    );
    uiState.pfExcludedHops.add('task.assigned_to');

    expect(tableToTable('task', 'sys_user')).toBeNull();
  });

  it('field exclusion is source-table specific — same field name on another table is unaffected', () => {
    // incident.assigned_to excluded; task.assigned_to still allowed
    setGraph(
      [node('task'), node('incident'), node('sys_user')],
      [
        refEdge('task',     'sys_user', 'assigned_to'),
        refEdge('incident', 'sys_user', 'assigned_to'),
      ]
    );
    uiState.pfExcludedHops.add('incident.assigned_to');

    expect(tableToTable('task', 'sys_user')).not.toBeNull();      // unaffected
    expect(tableToTable('incident', 'sys_user')).toBeNull();      // blocked
  });

  it('table exclusion and field exclusion can coexist', () => {
    // Routes: A→hub→B (hub excluded), A→mid via assigned_to→B (field excluded), A→mid via other→B
    setGraph(
      [node('A'), node('hub'), node('mid'), node('B')],
      [
        refEdge('A',   'hub', 'r1'),   refEdge('hub', 'B', 'r2'),
        refEdge('A',   'mid', 'assigned_to'),
        refEdge('A',   'mid', 'other'),
        refEdge('mid', 'B',   'r5'),
      ]
    );
    uiState.pfExcludedHops.add('hub');
    uiState.pfExcludedHops.add('A.assigned_to');

    const result = tableToTable('A', 'B');
    expect(result).not.toBeNull();
    expect(result.path).not.toContain('hub');
    // First hop must use 'other', not 'assigned_to'
    const firstField = result.steps?.[0]?.fieldName;
    expect(firstField).toBe('other');
  });

  it('extends edges are never subject to field exclusion', () => {
    // Extends edges have no .field — exclusion key A.extends wouldn't match anything
    // but this test confirms extends traversal is not broken by a field exclusion
    setGraph(
      [node('incident'), node('task'), node('sys_user')],
      [
        extEdge('incident', 'task'),
        refEdge('task', 'sys_user', 'assigned_to'),
      ]
    );
    uiState.pfExcludedHops.add('task.assigned_to');

    // incident → task (extends, free) → sys_user blocked because task.assigned_to excluded
    expect(tableToTable('incident', 'sys_user')).toBeNull();
  });
});

// ── ancestorsOf ───────────────────────────────────────────────────────────────
describe('ancestorsOf', () => {
  it('returns empty array for a table with no parent', () => {
    setGraph([node('task')], []);
    expect(ancestorsOf('task')).toEqual([]);
  });

  it('returns the direct parent of a child table', () => {
    setGraph(
      [node('task'), node('incident')],
      [extEdge('incident', 'task')]
    );
    expect(ancestorsOf('incident')).toEqual(['task']);
  });

  it('returns the full ancestor chain in order', () => {
    setGraph(
      [node('sys_audit'), node('task'), node('incident'), node('em_alert')],
      [extEdge('incident', 'task'), extEdge('em_alert', 'incident'), extEdge('task', 'sys_audit')]
    );
    expect(ancestorsOf('em_alert')).toEqual(['incident', 'task', 'sys_audit']);
  });

  it('returns empty array for an unknown table', () => {
    setGraph([node('task')], []);
    expect(ancestorsOf('nonexistent')).toEqual([]);
  });
});

// ── fieldDefinedAt ────────────────────────────────────────────────────────────
describe('fieldDefinedAt', () => {
  it('returns the table id when the field is defined directly on it', () => {
    setGraph([nodeWithFields('task', 'number', 'state')], []);
    expect(fieldDefinedAt('task', 'number')).toBe('task');
  });

  it('returns the ancestor id when the field is inherited', () => {
    setGraph(
      [nodeWithFields('task', 'number'), nodeWithFields('incident', 'caller_id')],
      [extEdge('incident', 'task')]
    );
    // 'number' is on task, accessible from incident via inheritance
    expect(fieldDefinedAt('incident', 'number')).toBe('task');
  });

  it('returns the deepest ancestor that defines the field', () => {
    // Chain: sub_task → task → sys_template; 'number' defined on sys_template
    setGraph(
      [nodeWithFields('sys_template', 'number'), nodeWithFields('task', 'state'), nodeWithFields('sub_task', 'order')],
      [extEdge('task', 'sys_template'), extEdge('sub_task', 'task')]
    );
    expect(fieldDefinedAt('sub_task', 'number')).toBe('sys_template');
  });

  it('returns null when the field does not exist on the table or any ancestor', () => {
    setGraph([nodeWithFields('task', 'number')], []);
    expect(fieldDefinedAt('task', 'nonexistent')).toBeNull();
  });

  it('returns null for an unknown table', () => {
    setGraph([nodeWithFields('task', 'number')], []);
    expect(fieldDefinedAt('nonexistent', 'number')).toBeNull();
  });
});

// ── fieldOwners ───────────────────────────────────────────────────────────────
describe('fieldOwners', () => {
  it('returns empty array when no table has the field', () => {
    setGraph([nodeWithFields('task', 'number')], []);
    expect(fieldOwners('nonexistent')).toEqual([]);
  });

  it('returns the table that directly owns the field', () => {
    setGraph([nodeWithFields('task', 'number')], []);
    const owners = fieldOwners('number');
    expect(owners).toHaveLength(1);
    expect(owners[0].tableId).toBe('task');
    expect(owners[0].isOwn).toBe(true);
    expect(owners[0].isInherited).toBe(false);
    expect(owners[0].inheritedFrom).toBeNull();
  });

  it('marks a child table as inheriting a field from its parent', () => {
    setGraph(
      [nodeWithFields('task', 'number'), nodeWithFields('incident', 'caller_id')],
      [extEdge('incident', 'task')]
    );
    const owners = fieldOwners('number');
    const taskEntry     = owners.find(o => o.tableId === 'task');
    const incidentEntry = owners.find(o => o.tableId === 'incident');

    expect(taskEntry.isOwn).toBe(true);
    expect(incidentEntry.isInherited).toBe(true);
    expect(incidentEntry.inheritedFrom).toBe('task');
  });

  it('returns empty array when graphData is null', () => {
    graphState.graphData = null;
    expect(fieldOwners('number')).toEqual([]);
    // Restore for subsequent tests
    setGraph([], []);
  });
});

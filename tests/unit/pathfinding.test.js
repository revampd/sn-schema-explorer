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

import { graphState } from '../../src/viewer/core/state.js';
import { Pathfinding }  from '../../src/viewer/modules/path-finder/pathfinding.js';

const { tableToTable, tableToTableK, tableToField } = Pathfinding;

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

// ── Reset graph before each test ─────────────────────────────────────────────
beforeEach(() => {
  setGraph([], []);
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

/**
 * Unit tests for src/viewer/core/graph-state.js — the edge-id helpers and the
 * shared index builder introduced in the Phase 3 refactor (M1/M3).
 */
import { describe, it, expect } from 'vitest';
import {
  edgeSourceId,
  edgeTargetId,
  buildIndexes,
} from '../../src/viewer/core/graph-state.js';

function sampleGraph() {
  return {
    nodes: [{ id: 'task' }, { id: 'incident' }, { id: 'sys_user' }],
    edges: [
      { source: 'incident', target: 'task', type: 'extends' },
      { source: 'task', target: 'sys_user', type: 'reference' },
    ],
  };
}

describe('edgeSourceId / edgeTargetId', () => {
  it('returns the id when source/target are plain strings', () => {
    const e = { source: 'a', target: 'b' };
    expect(edgeSourceId(e)).toBe('a');
    expect(edgeTargetId(e)).toBe('b');
  });

  it('returns the id when source/target are D3-resolved node objects', () => {
    const e = { source: { id: 'a', x: 1, y: 2 }, target: { id: 'b', x: 3, y: 4 } };
    expect(edgeSourceId(e)).toBe('a');
    expect(edgeTargetId(e)).toBe('b');
  });
});

describe('buildIndexes', () => {
  it('stamps stable _sourceId/_targetId on every edge', () => {
    const g = sampleGraph();
    buildIndexes(g);
    expect(g.edges[0]._sourceId).toBe('incident');
    expect(g.edges[0]._targetId).toBe('task');
    expect(g.edges[1]._sourceId).toBe('task');
    expect(g.edges[1]._targetId).toBe('sys_user');
  });

  it('re-derives _sourceId/_targetId from D3-mutated edges', () => {
    const g = sampleGraph();
    buildIndexes(g);
    // Simulate D3 forceLink replacing string endpoints with node objects.
    g.edges[0].source = { id: 'incident' };
    g.edges[0].target = { id: 'task' };
    buildIndexes(g);
    expect(g.edges[0]._sourceId).toBe('incident');
    expect(g.edges[0]._targetId).toBe('task');
  });

  it('builds a _nodeById lookup over all nodes', () => {
    const g = sampleGraph();
    buildIndexes(g);
    expect(g._nodeById.size).toBe(3);
    expect(g._nodeById.get('task')).toBe(g.nodes[0]);
    expect(g._nodeById.has('missing')).toBe(false);
  });

  it('builds an _adj map with correct out/in adjacency', () => {
    const g = sampleGraph();
    buildIndexes(g);
    const task = g._adj.get('task');
    // task has one incoming (incident extends task) and one outgoing (task ref sys_user)
    expect(task.in).toHaveLength(1);
    expect(task.out).toHaveLength(1);
    expect(task.in[0].type).toBe('extends');
    expect(task.out[0].type).toBe('reference');

    expect(g._adj.get('incident').out).toHaveLength(1);
    expect(g._adj.get('incident').in).toHaveLength(0);
    expect(g._adj.get('sys_user').in).toHaveLength(1);
    expect(g._adj.get('sys_user').out).toHaveLength(0);
  });

  it('ignores edges that point at unknown nodes without throwing', () => {
    const g = {
      nodes: [{ id: 'a' }],
      edges: [{ source: 'a', target: 'ghost', type: 'reference' }],
    };
    expect(() => buildIndexes(g)).not.toThrow();
    expect(g._adj.get('a').out).toHaveLength(1);
    expect(g._adj.has('ghost')).toBe(false);
  });

  it('is idempotent — rebuilding yields the same adjacency counts', () => {
    const g = sampleGraph();
    buildIndexes(g);
    buildIndexes(g);
    expect(g._adj.get('task').in).toHaveLength(1);
    expect(g._adj.get('task').out).toHaveLength(1);
  });
});

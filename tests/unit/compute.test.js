/**
 * Unit tests for src/viewer/engine/compute.js — computeNeighbourhood.
 *
 * computeNeighbourhood reads from graphState/uiState/diffState and Settings.
 * Both are mocked so tests control state directly without DOM or module init.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { computeNeighbourhood } from '../../src/viewer/engine/compute.js';
import { graphState, uiState } from '../../src/viewer/core/state.js';

vi.mock('../../src/viewer/core/state.js', () => {
  const graphState = {
    graphData: { nodes: [], edges: [], _adj: null, _nodeById: null, _edgeCnt: {} }
  };
  const uiState = {
    selectedNode:   null,
    hopDepth:       2,
    maxNodes:       50,
    selectedScopes: new Set(),
    showRefTo:      true,
    showRefFrom:    true,
    showExt:        true,
    showM2M:        true,
    showRel:        true,
    showView:       true,
    showCmdbRel:    true,
    hiddenNodes:    new Set(),
    viewMode:       'force',
    connectedNodes: new Set(),
    _lastInheritedSeeds: new Set(),
  };
  const diffState = { _diffData: null, _diffShowAll: false };
  return { graphState, uiState, diffState };
});

vi.mock('../../src/viewer/modules/settings/index.js', () => ({
  Settings: { isEnabled: vi.fn().mockReturnValue(false) },
}));

// ── Test graph ────────────────────────────────────────────────────────────────
//
//  incident  →(extends)→  task  ←(extends)←  change_request
//                           |
//                    (reference, assigned_to)
//                           ↓
//                         sys_user

const NODES = [
  { id: 'task',           scope: 'Global' },
  { id: 'incident',       scope: 'Global' },
  { id: 'change_request', scope: 'Global' },
  { id: 'sys_user',       scope: 'Global' },
];

const EDGES = [
  { source: 'incident',       target: 'task',     type: 'extends'   },
  { source: 'change_request', target: 'task',     type: 'extends'   },
  { source: 'task',           target: 'sys_user', type: 'reference',
    field: 'assigned_to', label: 'Assigned to' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function resetState() {
  graphState.graphData = {
    nodes: NODES.map(n => ({ ...n })),
    edges: EDGES.map(e => ({ ...e })),
    _adj: null,
    _nodeById: null,
    _edgeCnt: {},
  };
  uiState.selectedNode   = null;
  uiState.hopDepth       = 2;
  uiState.maxNodes       = 50;
  uiState.selectedScopes = new Set();
  uiState.showRefTo      = true;
  uiState.showRefFrom    = true;
  uiState.showExt        = true;
  uiState.showM2M        = true;
  uiState.showRel        = true;
  uiState.showView       = true;
  uiState.showCmdbRel    = true;
  uiState.hiddenNodes    = new Set();
  uiState.viewMode       = 'force';
  uiState.connectedNodes = new Set();
  uiState._lastInheritedSeeds = new Set();
}

beforeEach(resetState);

// ── 1. No selection ────────────────────────────────────────────────────────────
describe('no selection', () => {
  it('returns all nodes when count is within maxNodes', () => {
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.size).toBe(4);
    expect(visNodeIds.has('task')).toBe(true);
    expect(visNodeIds.has('incident')).toBe(true);
    expect(visNodeIds.has('change_request')).toBe(true);
    expect(visNodeIds.has('sys_user')).toBe(true);
  });

  it('caps at maxNodes when there are more nodes than the limit', () => {
    uiState.maxNodes = 2;
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.size).toBe(2);
  });

  it('all edges between visible nodes are included (no hop filter without selection)', () => {
    const { visEdges } = computeNeighbourhood();
    expect(visEdges.length).toBeGreaterThan(0);
    // Every edge endpoint must be in visNodeIds
    const { visNodeIds } = computeNeighbourhood();
    for (const e of visEdges) {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      expect(visNodeIds.has(s)).toBe(true);
      expect(visNodeIds.has(t)).toBe(true);
    }
  });
});

// ── 2. Selection + hop depth ───────────────────────────────────────────────────
describe('selection with hop depth', () => {
  it('hop depth 1 from incident includes only direct neighbours', () => {
    uiState.selectedNode = 'incident';
    uiState.hopDepth     = 1;
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.has('incident')).toBe(true);
    expect(visNodeIds.has('task')).toBe(true);       // extends edge hop 1
    expect(visNodeIds.has('change_request')).toBe(false);
    expect(visNodeIds.has('sys_user')).toBe(false);
  });

  it('hop depth 2 from incident reaches the full graph', () => {
    uiState.selectedNode = 'incident';
    uiState.hopDepth     = 2;
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.has('incident')).toBe(true);
    expect(visNodeIds.has('task')).toBe(true);
    expect(visNodeIds.has('change_request')).toBe(true); // hop 2 via task
    expect(visNodeIds.has('sys_user')).toBe(true);       // hop 2 via task ref
  });

  it('selected node is always in visNodeIds regardless of filters', () => {
    uiState.selectedNode = 'incident';
    uiState.showExt      = false;
    uiState.showRefTo    = false;
    uiState.showRefFrom  = false;
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.has('incident')).toBe(true);
  });
});

// ── 3. Edge type filtering ─────────────────────────────────────────────────────
describe('edge type filtering', () => {
  it('disabling extends edges prevents traversal via extends', () => {
    uiState.selectedNode = 'incident';
    uiState.showExt      = false;
    uiState.hopDepth     = 2;
    const { visNodeIds } = computeNeighbourhood();
    // incident has no non-extends outbound edges → stays isolated
    expect(visNodeIds.has('task')).toBe(false);
    expect(visNodeIds.has('sys_user')).toBe(false);
  });

  it('disabling reference edges prevents traversal to referenced tables', () => {
    uiState.selectedNode = 'task';
    uiState.showRefTo    = false;
    uiState.showRefFrom  = false;
    uiState.hopDepth     = 1;
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.has('task')).toBe(true);
    // extends edges still work — incident and change_request are reachable
    expect(visNodeIds.has('incident')).toBe(true);
    expect(visNodeIds.has('change_request')).toBe(true);
    expect(visNodeIds.has('sys_user')).toBe(false);
  });
});

// ── 4. Reference directionality ───────────────────────────────────────────────
describe('reference directionality', () => {
  it('showRefTo follows source→target direction', () => {
    uiState.selectedNode = 'task';
    uiState.showRefTo    = true;
    uiState.showRefFrom  = false;
    uiState.showExt      = false;
    uiState.hopDepth     = 1;
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.has('sys_user')).toBe(true);  // task → sys_user
  });

  it('showRefFrom follows target←source direction', () => {
    uiState.selectedNode = 'sys_user';
    uiState.showRefTo    = false;
    uiState.showRefFrom  = true;
    uiState.showExt      = false;
    uiState.hopDepth     = 1;
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.has('task')).toBe(true);      // sys_user ← task
  });

  it('both ref directions disabled prevents any ref traversal', () => {
    uiState.selectedNode = 'task';
    uiState.showRefTo    = false;
    uiState.showRefFrom  = false;
    uiState.showExt      = false;
    uiState.hopDepth     = 2;
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.has('sys_user')).toBe(false);
  });
});

// ── 5. Multi-reference edge collapse ─────────────────────────────────────────
describe('multi-reference edge collapse', () => {
  it('collapses two ref edges to same target into one with _count=2', () => {
    graphState.graphData.edges = [
      { source: 'task', target: 'sys_user', type: 'reference',
        field: 'assigned_to', label: 'Assigned to' },
      { source: 'task', target: 'sys_user', type: 'reference',
        field: 'closed_by', label: 'Closed by' },
    ];
    uiState.selectedNode = 'task';
    uiState.showExt      = false;
    uiState.hopDepth     = 1;
    const { visEdges } = computeNeighbourhood();
    expect(visEdges).toHaveLength(1);
    expect(visEdges[0]._count).toBe(2);
  });

  it('tracks _fields and _fieldLabels on collapsed edge', () => {
    graphState.graphData.edges = [
      { source: 'task', target: 'sys_user', type: 'reference',
        field: 'assigned_to', label: 'Assigned to' },
      { source: 'task', target: 'sys_user', type: 'reference',
        field: 'closed_by', label: 'Closed by' },
    ];
    uiState.selectedNode = 'task';
    uiState.showExt      = false;
    uiState.hopDepth     = 1;
    const { visEdges } = computeNeighbourhood();
    expect(visEdges[0]._fields).toEqual(['assigned_to', 'closed_by']);
    expect(visEdges[0]._fieldLabels).toEqual(['Assigned to', 'Closed by']);
  });

  it('single edge has _count=1', () => {
    uiState.selectedNode = 'task';
    uiState.showExt      = false;
    uiState.hopDepth     = 1;
    const { visEdges } = computeNeighbourhood();
    const refEdge = visEdges.find(e => e.type === 'reference');
    expect(refEdge._count).toBe(1);
  });
});

// ── 6. Hidden nodes ────────────────────────────────────────────────────────────
describe('hidden nodes', () => {
  it('excludes hidden nodes from visNodeIds', () => {
    uiState.hiddenNodes = new Set(['sys_user']);
    const { visNodeIds } = computeNeighbourhood();
    expect(visNodeIds.has('sys_user')).toBe(false);
  });
});

// ── 7. Self-loops ──────────────────────────────────────────────────────────────
describe('self-loops', () => {
  it('excludes self-loop edges from visEdges', () => {
    graphState.graphData.edges = [
      ...EDGES,
      { source: 'task', target: 'task', type: 'extends' },
    ];
    const { visEdges } = computeNeighbourhood();
    for (const e of visEdges) {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      expect(s).not.toBe(t);
    }
  });
});

// ── 8. countOnly ──────────────────────────────────────────────────────────────
describe('countOnly mode', () => {
  it('returns visNodeIds and connectedNodes but no visEdges or hopDist', () => {
    const result = computeNeighbourhood({ countOnly: true });
    expect(result.visNodeIds).toBeDefined();
    expect(result.connectedNodes).toBeDefined();
    expect(result.visEdges).toBeUndefined();
    expect(result.hopDist).toBeUndefined();
  });
});

// ── 9. hopDist return value ────────────────────────────────────────────────────
describe('hopDist', () => {
  it('is an empty object when no node is selected', () => {
    const { hopDist } = computeNeighbourhood();
    expect(hopDist).toBeDefined();
    expect(Object.keys(hopDist)).toHaveLength(0);
  });

  it('assigns hopDist 0 to the selected node', () => {
    uiState.selectedNode = 'task';
    const { hopDist } = computeNeighbourhood();
    expect(hopDist['task']).toBe(0);
  });

  it('assigns hopDist 1 to direct neighbours', () => {
    uiState.selectedNode = 'task';
    uiState.hopDepth     = 1;
    const { hopDist } = computeNeighbourhood();
    // task → sys_user (reference), incident → task and change_request → task (extends)
    expect(hopDist['sys_user']).toBe(1);
    expect(hopDist['incident']).toBe(1);
    expect(hopDist['change_request']).toBe(1);
  });

  it('assigns hopDist 2 to two-hop neighbours', () => {
    uiState.selectedNode = 'incident';
    uiState.hopDepth     = 2;
    const { hopDist } = computeNeighbourhood();
    expect(hopDist['incident']).toBe(0);
    expect(hopDist['task']).toBe(1);       // incident → task (extends)
    expect(hopDist['sys_user']).toBe(2);   // task → sys_user (reference, hop 2)
    expect(hopDist['change_request']).toBe(2); // change_request → task (hop 2 via task)
  });

  it('respects hopDepth — nodes beyond the limit have no hopDist entry', () => {
    uiState.selectedNode = 'incident';
    uiState.hopDepth     = 1;
    const { hopDist } = computeNeighbourhood();
    expect(hopDist['task']).toBe(1);
    expect(hopDist['sys_user']).toBeUndefined(); // hop 2, beyond depth 1
  });

  it('showRefTo only — sys_user reachable from task with correct hop', () => {
    uiState.selectedNode = 'task';
    uiState.showRefTo    = true;
    uiState.showRefFrom  = false;
    uiState.showExt      = false;
    uiState.hopDepth     = 1;
    const { hopDist } = computeNeighbourhood();
    expect(hopDist['task']).toBe(0);
    expect(hopDist['sys_user']).toBe(1);   // task → sys_user
    expect(hopDist['incident']).toBeUndefined();       // not reachable without extends
    expect(hopDist['change_request']).toBeUndefined(); // not reachable without extends
  });
});

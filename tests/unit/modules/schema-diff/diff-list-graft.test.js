/**
 * @vitest-environment jsdom
 *
 * Unit tests for the schema-diff list renderer + graft helpers extracted from
 * schema-diff/index.js (#73): build-list.js, graft.js, and list-cursor.js.
 * Behaviour-preserving safety net landed before the extraction.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Isolate build-list from its heavier siblings — these collaborators have their
// own tests; here we only care that the renderer wires them in.
vi.mock('../../../../src/modules/settings/index.js', () => ({
  Settings: { isEnabled: () => false, isCustomName: () => false },
}));
vi.mock('../../../../src/core/dom.js', () => ({ Dom: { searchBox: null } }));
vi.mock('../../../../src/modules/search/index.js', () => ({ getSearchMode: () => 'tables' }));
vi.mock('../../../../src/core/advanced-filter.js', () => ({ filterOk: () => true }));
vi.mock('../../../../src/core/table-list.js', () => ({ buildTableList: vi.fn() }));

import {
  diffBuildList,
  filteredDiffCounts,
  presentElementTypes,
  defaultCollapsedGroups,
  GROUP_ROW_CAP,
  GROUP_COLLAPSE_THRESHOLD,
} from '../../../../src/modules/schema-diff/build-list.js';
import {
  diffGraftAddedIntoBase,
  diffUngraftAddedFromBase,
} from '../../../../src/modules/schema-diff/graft.js';
import {
  moveDiffCursor,
  clearDiffCursor,
  getFocusedDiffItem,
} from '../../../../src/modules/schema-diff/list-cursor.js';
import { graphState, diffState, uiState } from '../../../../src/core/state.js';

// A diff-data fixture: one added, one removed, one changed table.
function makeDiffData() {
  return {
    added: new Set(['incident']),
    removed: new Set(['old_table']),
    changed: new Map([
      [
        'task',
        {
          addedFields: [{ name: 'f1' }, { name: 'f2' }],
          removedFields: [{ name: 'f3' }],
          addedEdges: [{ source: 'task', target: 'cmdb_ci', type: 'ref', field: 'ci' }],
          removedEdges: [],
        },
      ],
    ]),
    compareMap: new Map([['incident', { id: 'incident', label: 'Incident' }]]),
    baseMap: new Map([
      ['old_table', { id: 'old_table', label: 'Old' }],
      ['task', { id: 'task', label: 'Task' }],
    ]),
    allAddedEdges: [{ source: 'incident', target: 'task', type: 'extends' }],
    // Per-table edges: the added table `incident` owns a new reference; the
    // removed table `old_table` owned a reference that vanished with it.
    tableEdges: new Map([
      [
        'incident',
        {
          addedEdges: [{ source: 'incident', target: 'task', type: 'reference', field: 'parent' }],
          removedEdges: [],
        },
      ],
      [
        'old_table',
        {
          addedEdges: [],
          removedEdges: [{ source: 'old_table', target: 'task', type: 'reference', field: 'old' }],
        },
      ],
    ]),
  };
}

beforeEach(() => {
  // jsdom has no layout engine — scrollIntoView is undefined on elements.
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '<div id="diff-list"></div>';
  diffState._diffData = makeDiffData();
  diffState._diffFilter = 'all';
  diffState._diffElementFilter = null;
  diffState._diffMatrix = null;
  uiState.filterConditions = [];
  uiState.selectedNode = null;
});

describe('diffBuildList', () => {
  it('renders Added/Removed/Changed groups with the right counts', () => {
    diffBuildList();
    const headers = [...document.querySelectorAll('.diff-group-header')].map(h =>
      h.textContent.replace('▾', '')
    );
    expect(headers).toEqual(['Added (1)', 'Removed (1)', 'Changed (1)']);
    expect(document.querySelectorAll('.diff-item').length).toBe(3);
  });

  it('shows an added table’s own relationships as a sub-group', () => {
    diffState._diffFilter = 'added';
    diffBuildList();
    const addedGroup = document.querySelector('.diff-group[data-group="added"]');
    const sub = addedGroup.querySelector('.diff-edge-subgroup-header');
    expect(sub.textContent).toBe('Relationships (1)'); // not "Relationship changes"
    const edge = addedGroup.querySelector('.diff-edge-item');
    expect(edge.querySelector('.diff-edge-sign').textContent).toBe('+');
    diffState._diffFilter = 'all';
  });

  it('shows a removed table’s vanished relationships as a sub-group', () => {
    diffState._diffFilter = 'removed';
    diffBuildList();
    const removedGroup = document.querySelector('.diff-group[data-group="removed"]');
    const sub = removedGroup.querySelector('.diff-edge-subgroup-header');
    expect(sub.textContent).toBe('Relationships (1)');
    expect(removedGroup.querySelector('.diff-edge-sign').textContent).toBe('−');
    diffState._diffFilter = 'all';
  });

  it('shows the field-delta count on changed rows', () => {
    diffBuildList();
    const changed = document.querySelector('.diff-item[data-kind="changed"] .diff-item-count');
    expect(changed.textContent).toBe('+1'); // 2 added − 1 removed
  });

  it('element-type filter (#4) slices the Changed group by kind', () => {
    diffState._diffFilter = 'changed';
    const changedIds = () =>
      [...document.querySelectorAll('.diff-group[data-group="changed"] .diff-item')].map(
        e => e.dataset.id
      );
    // task touches fields + a 'ref' edge.
    diffState._diffElementFilter = ['ref'];
    diffBuildList();
    expect(changedIds()).toEqual(['task']);

    diffState._diffElementFilter = ['fields'];
    diffBuildList();
    expect(changedIds()).toEqual(['task']);

    diffState._diffElementFilter = ['m2m']; // task has no m2m change
    diffBuildList();
    expect(changedIds()).toEqual([]);

    diffState._diffElementFilter = null; // reset shared state
  });

  it('presentElementTypes lists only kinds the comparison actually contains', () => {
    // changed task → fields + 'ref'; added/removed tables → a 'reference' edge.
    expect([...presentElementTypes()].sort()).toEqual(['fields', 'ref', 'reference']);
  });

  it('presentElementTypes is memoized per diff and recomputes on a new diff', () => {
    const first = presentElementTypes();
    expect(presentElementTypes()).toBe(first); // same diff → cached Set instance
    diffState._diffData = makeDiffData(); // a new comparison
    const second = presentElementTypes();
    expect(second).not.toBe(first); // recomputed
    expect([...second].sort()).toEqual(['fields', 'ref', 'reference']);
  });

  it('filteredDiffCounts slices Added/Removed/Changed by the Kind selection', () => {
    // No slice → null, so the summary keeps the raw counts.
    diffState._diffElementFilter = null;
    expect(filteredDiffCounts()).toBe(null);

    // 'reference' matches the added/removed tables' edge, not the changed table.
    diffState._diffElementFilter = ['reference'];
    expect(filteredDiffCounts()).toEqual({ added: 1, removed: 1, changed: 0 });

    // 'fields'/'ref' match the changed table, not the reference-only add/remove.
    diffState._diffElementFilter = ['fields'];
    expect(filteredDiffCounts()).toEqual({ added: 0, removed: 0, changed: 1 });
    diffState._diffElementFilter = ['ref'];
    expect(filteredDiffCounts()).toEqual({ added: 0, removed: 0, changed: 1 });

    // A kind nothing touches hides everything.
    diffState._diffElementFilter = ['m2m'];
    expect(filteredDiffCounts()).toEqual({ added: 0, removed: 0, changed: 0 });

    diffState._diffElementFilter = null; // reset shared state
  });

  it('the Kind slice also filters the Added/Removed list groups', () => {
    diffState._diffElementFilter = ['reference']; // matches the add/remove edges only
    diffBuildList();
    const ids = group =>
      [...document.querySelectorAll(`.diff-group[data-group="${group}"] .diff-item`)].map(
        e => e.dataset.id
      );
    expect(ids('added')).toEqual(['incident']);
    expect(ids('removed')).toEqual(['old_table']);
    expect(ids('changed')).toEqual([]); // changed table touches fields/ref, not reference

    diffState._diffElementFilter = ['m2m']; // nothing touches m2m
    diffBuildList();
    expect(ids('added')).toEqual([]);
    expect(ids('removed')).toEqual([]);

    diffState._diffElementFilter = null;
  });

  it('renders a relationship-change subgroup for changed tables', () => {
    diffBuildList();
    const changedGroup = document.querySelector('.diff-group[data-group="changed"]');
    expect(changedGroup.querySelector('.diff-edge-subgroup-header').textContent).toBe(
      'Relationship changes (1)'
    );
    const edgeRow = changedGroup.querySelector('.diff-edge-item');
    expect(edgeRow.dataset.id).toBe('cmdb_ci');
  });

  it('honours the active filter (changed only)', () => {
    diffState._diffFilter = 'changed';
    diffBuildList();
    const headers = [...document.querySelectorAll('.diff-group-header')].map(h =>
      h.textContent.replace('▾', '')
    );
    expect(headers).toEqual(['Changed (1)']);
  });

  // Header-search filtering of the diff list (Tbl mode) is covered by the
  // "header search filters the diff list" e2e — it needs Dom.searchBox, which is
  // resolved at module load against the real shell DOM. The inline sidebar
  // search was removed (#126); the header bar is the single filter.

  it('clears the list and hides it when there is no diff data', () => {
    diffState._diffData = null;
    diffBuildList();
    const list = document.getElementById('diff-list');
    expect(list.classList.contains('visible')).toBe(false);
    expect(list.children.length).toBe(0);
  });
});

describe('large-diff DOM bounds', () => {
  // A diff with more added tables than the cap, to exercise collapse + cap.
  function makeBigDiffData(nAdded) {
    const added = new Set();
    const compareMap = new Map();
    for (let i = 0; i < nAdded; i++) {
      const id = `t_${i}`;
      added.add(id);
      compareMap.set(id, { id, label: id });
    }
    return {
      added,
      removed: new Set(),
      changed: new Map(),
      compareMap,
      baseMap: new Map(),
      allAddedEdges: [],
      tableEdges: new Map(),
    };
  }

  beforeEach(() => {
    diffState._diffData = makeBigDiffData(GROUP_ROW_CAP + 50);
    diffState._diffFilter = 'all';
    diffState._diffElementFilter = null;
    diffState._diffMatrix = null;
  });

  it('defaultCollapsedGroups collapses groups above the threshold', () => {
    expect(GROUP_ROW_CAP + 50).toBeGreaterThan(GROUP_COLLAPSE_THRESHOLD);
    expect(defaultCollapsedGroups()).toContain('added');
  });

  it('a collapsed group builds no rows but shows the full count in its header', () => {
    diffState._collapsedGroups = ['added'];
    diffBuildList();
    const group = document.querySelector('.diff-group[data-group="added"]');
    expect(group.querySelector('.diff-group-header').textContent).toContain(
      `(${GROUP_ROW_CAP + 50})`
    );
    expect(group.querySelectorAll('.diff-item').length).toBe(0);
  });

  it('an expanded group caps rows and appends a "+N more" footer', () => {
    diffState._collapsedGroups = [];
    diffBuildList();
    const group = document.querySelector('.diff-group[data-group="added"]');
    expect(group.querySelectorAll('.diff-item').length).toBe(GROUP_ROW_CAP);
    const more = group.querySelector('.diff-group-more');
    expect(more).not.toBeNull();
    expect(more.textContent).toContain('50 more');
  });
});

describe('list-cursor', () => {
  beforeEach(() => diffBuildList());

  it('moves focus and exposes the focused item', () => {
    expect(getFocusedDiffItem()).toBe(null);
    moveDiffCursor(1);
    const focused = getFocusedDiffItem();
    expect(focused.classList.contains('diff-item--focused')).toBe(true);
    expect(focused).toBe(document.querySelectorAll('.diff-item')[0]);
  });

  it('clamps at the last item moving down', () => {
    moveDiffCursor(1);
    moveDiffCursor(1);
    moveDiffCursor(1);
    moveDiffCursor(1); // only 3 items
    const items = document.querySelectorAll('.diff-item');
    expect(getFocusedDiffItem()).toBe(items[items.length - 1]);
  });

  it('clearDiffCursor unfocuses and resets', () => {
    moveDiffCursor(1);
    clearDiffCursor();
    expect(getFocusedDiffItem()).toBe(null);
    expect(document.querySelector('.diff-item--focused')).toBe(null);
  });
});

describe('graft helpers', () => {
  beforeEach(() => {
    graphState.graphData = {
      nodes: [{ id: 'task' }],
      edges: [{ source: 'task', target: 'task', type: 'self' }],
    };
    diffState._diffData = makeDiffData();
  });

  it('grafts added nodes + edges marked _diffOnly and rebuilds counts', () => {
    diffGraftAddedIntoBase();
    expect(graphState.graphData.nodes.some(n => n.id === 'incident' && n._diffOnly)).toBe(true);
    expect(graphState.graphData.edges.some(e => e._diffOnly && e.type === 'extends')).toBe(true);
    expect(graphState.graphData._edgeCnt).toBeDefined();
  });

  it('ungraft removes everything marked _diffOnly', () => {
    diffGraftAddedIntoBase();
    diffUngraftAddedFromBase();
    expect(graphState.graphData.nodes.some(n => n._diffOnly)).toBe(false);
    expect(graphState.graphData.edges.some(e => e._diffOnly)).toBe(false);
    expect(graphState.graphData.nodes).toHaveLength(1);
  });

  it('ungraft is a no-op when nothing was grafted', () => {
    const before = graphState.graphData.nodes.length;
    diffUngraftAddedFromBase();
    expect(graphState.graphData.nodes).toHaveLength(before);
  });
});

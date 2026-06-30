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

import { diffBuildList } from '../../../../src/modules/schema-diff/build-list.js';
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
  };
}

beforeEach(() => {
  // jsdom has no layout engine — scrollIntoView is undefined on elements.
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '<div id="diff-list"></div>';
  diffState._diffData = makeDiffData();
  diffState._diffFilter = 'all';
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

  it('renders a relationship-change subgroup for changed tables', () => {
    diffBuildList();
    expect(document.querySelector('.diff-edge-subgroup-header').textContent).toBe(
      'Relationship changes (1)'
    );
    const edgeRow = document.querySelector('.diff-edge-item');
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

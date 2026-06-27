/**
 * @vitest-environment jsdom
 *
 * Unit tests for the path-finder result-list renderer extracted from
 * path-finder/index.js (#73): pfRenderResults / pfRenderResult in path-view.js,
 * plus the shared pfState singleton. The DAG canvas renderer (renderPathView)
 * stays covered by the Path Finder e2e suite. Behaviour-preserving safety net.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub the heavy/irrelevant collaborators — canvas + render pull in d3, and we
// drive the force-view (highlight) path so render() is never the thing under test.
vi.mock('../../../../src/core/render.js', () => ({ render: vi.fn() }));
vi.mock('../../../../src/core/canvas.js', () => ({ svg: {}, root: {}, zoom: {} }));
vi.mock('../../../../src/core/inspector.js', () => ({ focusTable: vi.fn() }));
vi.mock('../../../../src/modules/settings/index.js', () => ({
  Settings: { isEnabled: () => false, isCustomName: () => false },
}));
vi.mock('../../../../src/core/dom.js', () => ({ Dom: {} }));

import { pfRenderResults } from '../../../../src/modules/path-finder/path-view.js';
import { pfState } from '../../../../src/modules/path-finder/pf-state.js';
import { uiState } from '../../../../src/core/state.js';

function tableResult(steps, dotWalk, totalCost) {
  return {
    steps,
    totalCost,
    dotWalk,
    path: ['incident', ...steps.map(s => s.to)],
  };
}

let container;
beforeEach(() => {
  document.body.innerHTML = '<div id="box"></div>';
  container = document.getElementById('box');
  uiState.viewMode = 'force'; // force highlight path, not the canvas renderer
  uiState.selectedNode = null;
  pfState.paths = [];
  pfState.activePathIdx = 7;
  pfState.fieldName = 'stale';
  pfState.sourceId = 'stale';
});

const PRIMARY = tableResult(
  [{ from: 'incident', to: 'cmdb_ci', edgeType: 'reference', fieldName: 'cmdb_ci' }],
  'incident.cmdb_ci',
  1
);

describe('pfRenderResults — state', () => {
  it('writes the result set and resets the active index into pfState', () => {
    pfRenderResults(container, [PRIMARY], 'incident', null);
    expect(pfState.paths).toHaveLength(1);
    expect(pfState.sourceId).toBe('incident');
    expect(pfState.fieldName).toBe(null);
    expect(pfState.activePathIdx).toBe(0);
  });

  it('no-ops on an empty result set', () => {
    pfRenderResults(container, [], 'incident', null);
    expect(container.children.length).toBe(0);
  });
});

describe('pfRenderResults — DOM', () => {
  it('renders the primary summary, dot-walk, and step rows', () => {
    pfRenderResults(container, [PRIMARY], 'incident', null);
    expect(container.querySelector('.pf-result-summary').textContent).toContain('Path found in');
    const codes = [...container.querySelectorAll('.pf-dotwalk')].map(c => c.textContent);
    expect(codes).toContain('incident.cmdb_ci');
    expect(codes).toContain('incident.cmdb_ci=<value>');
    expect(container.querySelectorAll('.pf-step').length).toBe(1);
  });

  it('renders an alternatives section when there is more than one path', () => {
    const alt = tableResult(
      [
        { from: 'incident', to: 'task', edgeType: 'extends' },
        { from: 'task', to: 'cmdb_ci', edgeType: 'reference', fieldName: 'ci' },
      ],
      'incident.ci',
      2
    );
    pfRenderResults(container, [PRIMARY, alt], 'incident', null);
    expect(container.querySelector('.pf-alts-header').textContent).toBe('Alternative paths (1)');
    expect(container.querySelectorAll('.pf-alt-item').length).toBe(1);
  });

  it('appends a trailing field row in field mode', () => {
    pfRenderResults(container, [PRIMARY], 'incident', 'name');
    const tags = [...container.querySelectorAll('.pf-step-tag')].map(t => t.textContent);
    expect(tags).toContain('field');
    expect(pfState.fieldName).toBe('name');
  });

  it('renders a same-table direct-access summary for a zero-step result', () => {
    const direct = {
      steps: [],
      totalCost: 0,
      dotWalk: 'incident.number',
      path: ['incident'],
      fieldOwner: 'incident',
      inheritedFromAncestor: false,
    };
    pfRenderResults(container, [direct], 'incident', 'number');
    expect(container.querySelector('.pf-result-summary').textContent).toContain('Direct access');
  });
});

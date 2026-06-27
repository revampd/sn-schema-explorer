/**
 * Unit tests for src/core/edge-title.js — the edge tooltip text
 * builder extracted from render.js (#73). makeEdgeTitleText() snapshots the
 * graph once and returns a per-edge title function.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let tooltipInheritedRefs = false;
vi.mock('../../src/modules/settings/index.js', () => ({
  Settings: { isEnabled: key => (key === 'tooltipInheritedRefs' ? tooltipInheritedRefs : false) },
}));

import { makeEdgeTitleText } from '../../src/core/edge-title.js';
import { graphState } from '../../src/core/state.js';

// Edge data as it looks at render time: source/target are node objects.
function nodeObj(id, label) {
  return { id, label: label || id };
}

beforeEach(() => {
  tooltipInheritedRefs = false;
  graphState.graphData = { nodes: [], edges: [] };
});

describe('makeEdgeTitleText', () => {
  it('builds a source → target header, preferring "label (id)"', () => {
    const title = makeEdgeTitleText();
    const text = title({ source: nodeObj('incident', 'Incident'), target: nodeObj('task') });
    expect(text).toBe('Incident (incident) → task');
  });

  it('lists the edge own reference fields as bullets', () => {
    const title = makeEdgeTitleText();
    const text = title({
      source: nodeObj('incident'),
      target: nodeObj('cmdb_ci'),
      type: 'reference',
      _fields: ['cmdb_ci'],
      _fieldLabels: ['Configuration item'],
    });
    expect(text).toContain('• Configuration item (cmdb_ci)');
  });

  it('appends the relationship label for non-reference edges', () => {
    const title = makeEdgeTitleText();
    const text = title({
      source: nodeObj('a'),
      target: nodeObj('b'),
      type: 'cmdb_rel',
      label: 'Powers',
    });
    expect(text).toBe('a → b\nPowers');
  });

  it('omits inherited refs when the feature is off', () => {
    graphState.graphData = {
      nodes: [nodeObj('parent'), nodeObj('child'), nodeObj('tgt')],
      edges: [
        { source: 'child', target: 'parent', type: 'extends' },
        { source: 'parent', target: 'tgt', type: 'reference', field: 'pref', label: 'Parent ref' },
      ],
    };
    const title = makeEdgeTitleText();
    const text = title({ source: nodeObj('child'), target: nodeObj('tgt'), type: 'reference' });
    expect(text).not.toContain('inherited from');
  });

  it('walks the ancestor chain for inherited refs when the feature is on', () => {
    tooltipInheritedRefs = true;
    graphState.graphData = {
      nodes: [nodeObj('parent', 'Parent'), nodeObj('child'), nodeObj('tgt')],
      edges: [
        { source: 'child', target: 'parent', type: 'extends' },
        { source: 'parent', target: 'tgt', type: 'reference', field: 'pref', label: 'Parent ref' },
      ],
    };
    const title = makeEdgeTitleText();
    const text = title({ source: nodeObj('child'), target: nodeObj('tgt'), type: 'reference' });
    expect(text).toContain('↳ inherited from Parent:');
    expect(text).toContain('• Parent ref (pref)');
  });
});

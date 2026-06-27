/**
 * @vitest-environment jsdom
 *
 * Unit tests for the edge-type legend export helpers in
 * src/modules/export/index.js. The module imports DOM-bound siblings
 * (Dom, canvas, render, Settings); we mock those so it imports in tests.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/core/dom.js', () => ({ Dom: {} }));
vi.mock('../../src/core/canvas.js', () => ({ svg: {}, root: {}, zoom: {} }));
vi.mock('../../src/core/render.js', () => ({ typeLabel: t => t || '' }));
vi.mock('../../src/modules/settings/index.js', () => ({
  Settings: { initMaxPngScale() {}, getMaxPngScale: () => 20 },
}));

// jsdom in this config doesn't expose localStorage — provide an in-memory shim.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
}

import {
  _buildEdgeLegendGroup,
  _presentEdgeTypes,
  getExportIncludeLegend,
  setExportIncludeLegend,
} from '../../src/modules/export/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('getExportIncludeLegend / setExportIncludeLegend', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to false', () => {
    expect(getExportIncludeLegend()).toBe(false);
  });

  it('round-trips through localStorage', () => {
    setExportIncludeLegend(true);
    expect(getExportIncludeLegend()).toBe(true);
    setExportIncludeLegend(false);
    expect(getExportIncludeLegend()).toBe(false);
  });
});

describe('_presentEdgeTypes', () => {
  function svgWith(classes) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const c of classes) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', c);
      svg.appendChild(line);
    }
    return svg;
  }

  it('returns only the legend items whose edge class is present', () => {
    const svg = svgWith(['edge-extends', 'edge-ref-to']);
    const keys = _presentEdgeTypes(svg).map(i => i.key);
    expect(keys).toEqual(['ref-to', 'ext']); // EDGE_LEGEND_ITEMS order preserved
  });

  it('skips edges hidden via display:none', () => {
    const svg = svgWith(['edge-m2m']);
    svg.querySelector('.edge-m2m').style.display = 'none';
    expect(_presentEdgeTypes(svg)).toEqual([]);
  });

  it('returns [] for a null element', () => {
    expect(_presentEdgeTypes(null)).toEqual([]);
  });
});

describe('_buildEdgeLegendGroup', () => {
  it('renders a header and one swatch+label per item', () => {
    const items = [
      {
        key: 'ext',
        cssClass: 'edge-extends',
        label: 'Inheritance',
        stroke: '#2a6496',
        dash: '4 2',
      },
      { key: 'm2m', cssClass: 'edge-m2m', label: 'M2M junction', stroke: '#06d6a0', dash: '2 3' },
    ];
    const { group, height } = _buildEdgeLegendGroup(document, items, { x: 5, y: 7 });

    expect(group.getAttribute('transform')).toBe('translate(5,7)');
    const texts = [...group.querySelectorAll('text')].map(t => t.textContent);
    expect(texts).toContain('EDGE TYPES');
    expect(texts).toContain('Inheritance');
    expect(texts).toContain('M2M junction');

    const lines = group.querySelectorAll('line');
    expect(lines.length).toBe(2);
    expect(lines[0].getAttribute('stroke')).toBe('#2a6496');
    expect(lines[0].getAttribute('stroke-dasharray')).toBe('4 2');
    expect(height).toBeGreaterThan(0);
  });
});

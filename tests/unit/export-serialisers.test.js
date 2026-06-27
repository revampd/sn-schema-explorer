/**
 * Unit tests for the pure serialisers in src/modules/export/index.js
 * (#43 / #47.1).
 *
 * The serialisers themselves are pure (nodes/data/opts → string), but the module
 * imports DOM-bound siblings (Dom, canvas, render, Settings). We mock those so
 * the module imports in a Node context; the serialisers under test never touch
 * them (markdown's typeLabel is the one exception, mocked to identity here).
 */
import { vi, describe, it, expect, beforeAll } from 'vitest';
import { buildIndexes } from '../../src/core/graph-state.js';

vi.mock('../../src/core/dom.js', () => ({ Dom: {} }));
vi.mock('../../src/core/canvas.js', () => ({ svg: {}, root: {}, zoom: {} }));
vi.mock('../../src/core/render.js', () => ({ typeLabel: t => t || '' }));
vi.mock('../../src/modules/settings/index.js', () => ({
  Settings: { initMaxPngScale() {}, getMaxPngScale: () => 20 },
}));

import {
  _nodeToMarkdown,
  _schemaToJsonLd,
  _schemaToTurtle,
  _schemaToOpenApi,
  _normaliseHex,
  _hsvToRgb,
  _rgbToHsv,
  _rgbToHex,
} from '../../src/modules/export/index.js';

// ── Fixture: incident extends task; task.assigned_to → sys_user ───────────────
let data, nodeById;
beforeAll(() => {
  const nodes = [
    {
      id: 'task',
      label: 'Task',
      scope: 'Global',
      fields: [
        { name: 'number', label: 'Number', type: 'string' },
        { name: 'assigned_to', label: 'Assigned to', type: 'reference' },
      ],
    },
    { id: 'incident', label: 'Incident', scope: 'Global', fields: [] },
    { id: 'sys_user', label: 'User', scope: 'Global', fields: [{ name: 'email', type: 'string' }] },
  ];
  const edges = [
    { source: 'incident', target: 'task', type: 'extends' },
    { source: 'task', target: 'sys_user', type: 'reference', field: 'assigned_to' },
  ];
  data = { nodes, edges, _instance: { instance_name: 'dev' } };
  buildIndexes(data);
  nodeById = id => nodes.find(n => n.id === id);
});

describe('_nodeToMarkdown', () => {
  it('emits a heading, field table, and outgoing references', () => {
    const md = _nodeToMarkdown(nodeById('task'), data);
    expect(md).toContain('## task — Task');
    expect(md).toContain('| Field | Type | Label |');
    expect(md).toContain('`number`');
    expect(md).toMatch(/\*\*References:\*\*.*sys_user/);
  });

  it('notes the parent table for an extending node', () => {
    const md = _nodeToMarkdown(nodeById('incident'), data);
    expect(md).toContain('*(extends: task)*');
  });
});

describe('_schemaToJsonLd', () => {
  let doc;
  beforeAll(() => {
    doc = JSON.parse(_schemaToJsonLd(data.nodes, data));
  });

  it('has a @context with the expected prefixes', () => {
    expect(doc['@context']).toMatchObject({
      owl: expect.any(String),
      rdfs: expect.any(String),
      sn: expect.any(String),
    });
  });

  it('emits an owl:Ontology meta node and an owl:Class per table', () => {
    expect(doc['@graph'][0]['@type']).toBe('owl:Ontology');
    const task = doc['@graph'].find(n => n['@id'] === 'snp:task');
    expect(task['@type']).toBe('owl:Class');
  });

  it('models a reference field as owl:ObjectProperty with rdfs:range, and extends as rdfs:subClassOf', () => {
    const task = doc['@graph'].find(n => n['@id'] === 'snp:task');
    const ref = task['sn:fields'].find(f => f['sn:technicalName'] === 'assigned_to');
    expect(ref['@type']).toBe('owl:ObjectProperty');
    expect(ref['rdfs:range']).toEqual({ '@id': 'snp:sys_user' });
    const incident = doc['@graph'].find(n => n['@id'] === 'snp:incident');
    expect(incident['rdfs:subClassOf']).toEqual({ '@id': 'snp:task' });
  });
});

describe('_schemaToTurtle', () => {
  let ttl;
  beforeAll(() => {
    ttl = _schemaToTurtle(data.nodes, data);
  });

  it('declares the standard prefixes', () => {
    expect(ttl).toContain('@prefix owl:');
    expect(ttl).toContain('@prefix rdfs:');
    expect(ttl).toContain('@prefix snp:');
  });

  it('declares owl:Class, subClassOf, and an ObjectProperty for the reference', () => {
    expect(ttl).toContain('owl:Class');
    expect(ttl).toContain('rdfs:subClassOf');
    expect(ttl).toContain('owl:ObjectProperty');
  });
});

describe('_schemaToOpenApi', () => {
  let yaml;
  beforeAll(() => {
    yaml = _schemaToOpenApi(data.nodes, data);
  });

  it('declares the OpenAPI version and Table API paths', () => {
    expect(yaml).toContain('openapi: 3.0.3');
    expect(yaml).toContain('paths:');
    expect(yaml).toContain('/api/now/table/task');
    expect(yaml).toContain('components:');
  });
});

describe('colour math', () => {
  it('_normaliseHex expands shorthand, lowercases, and rejects invalid input', () => {
    expect(_normaliseHex('#FFF')).toBe('#ffffff');
    expect(_normaliseHex('FF0000')).toBe('#ff0000');
    expect(_normaliseHex('nope')).toBeNull();
  });

  it('_rgbToHex formats a 6-digit hex', () => {
    expect(_rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(_rgbToHex(0, 128, 255)).toBe('#0080ff');
  });

  it('_hsvToRgb maps primary hues correctly', () => {
    expect(_hsvToRgb(0, 1, 1)).toEqual({ r: 255, g: 0, b: 0 });
    expect(_hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('hsv→rgb→hsv round-trips a saturated colour', () => {
    const { r, g, b } = _hsvToRgb(210, 0.8, 0.6);
    const back = _rgbToHsv(r, g, b);
    expect(back.h).toBeGreaterThan(195);
    expect(back.h).toBeLessThan(225);
    expect(back.s).toBeGreaterThan(0.7);
    expect(back.v).toBeGreaterThan(0.5);
  });
});

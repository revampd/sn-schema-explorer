/**
 * Unit tests for the Node extractor's format serialisers
 * (src/exporter/node/serialisers.js), extracted from the CLI in #73.
 *
 * The module is CommonJS-authored (like schema-builder.js) and has no internal
 * `require`s, so we load it via readFileSync + new Function — the same pattern as
 * node-exporter.test.js — and exercise the pure (schema, opts) → string helpers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../src/exporter/node/serialisers.js'), 'utf8');

function loadSerialisers() {
  const moduleObj = { exports: {} };
  const fn = new Function('module', 'exports', 'require', SRC);
  fn(moduleObj, moduleObj.exports, () => ({}));
  return moduleObj.exports;
}

// Fixture: incident extends task; task.assigned_to → sys_user
let S, schema;
beforeAll(() => {
  S = loadSerialisers();
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
    { type: 'extends', source: 'incident', target: 'task' },
    { type: 'reference', source: 'task', target: 'sys_user', field: 'assigned_to' },
  ];
  schema = { nodes, edges, _instance: { instance_name: 'dev' } };
  schema._adj = S.buildAdj(schema);
});

describe('buildAdj', () => {
  it('indexes outgoing and incoming edges per node', () => {
    expect(schema._adj.get('task').out.some(e => e.type === 'reference')).toBe(true);
    expect(schema._adj.get('task').in.some(e => e.type === 'extends')).toBe(true);
  });
});

describe('serializeMarkdown', () => {
  it('emits a heading, field table, references, and the extends parent', () => {
    const md = S.serializeMarkdown(schema, {});
    expect(md).toContain('## task — Task');
    expect(md).toContain('| Field | Type | Label |');
    expect(md).toMatch(/\*\*References:\*\*.*sys_user/);
    expect(md).toContain('*(extends: task)*');
  });
});

describe('serializeJsonLd', () => {
  it('models classes, a reference ObjectProperty, and subClassOf', () => {
    const doc = JSON.parse(S.serializeJsonLd(schema, {}));
    expect(doc['@graph'][0]['@type']).toBe('owl:Ontology');
    const task = doc['@graph'].find(n => n['@id'] === 'snp:task');
    const ref = task['sn:fields'].find(f => f['sn:technicalName'] === 'assigned_to');
    expect(ref['@type']).toBe('owl:ObjectProperty');
    expect(ref['rdfs:range']).toEqual({ '@id': 'snp:sys_user' });
    const incident = doc['@graph'].find(n => n['@id'] === 'snp:incident');
    expect(incident['rdfs:subClassOf']).toEqual({ '@id': 'snp:task' });
  });
});

describe('serializeTurtle', () => {
  it('declares prefixes, owl:Class, subClassOf, and an ObjectProperty', () => {
    const ttl = S.serializeTurtle(schema, {});
    expect(ttl).toContain('@prefix snp:');
    expect(ttl).toContain('owl:Class');
    expect(ttl).toContain('rdfs:subClassOf');
    expect(ttl).toContain('owl:ObjectProperty');
  });
});

describe('serializeOpenApi', () => {
  it('declares the OpenAPI version, Table API paths, and component schemas', () => {
    const yaml = S.serializeOpenApi(schema, {});
    expect(yaml).toContain('openapi: 3.0.3');
    expect(yaml).toContain('/api/now/table/task');
    expect(yaml).toContain('components:');
  });
});

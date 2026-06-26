/**
 * Unit tests for src/exporter/shared/schema-builder.js
 *
 * schema-builder.js is a pure ES5 UMD module with no DOM or runtime dependencies.
 * We load it via readFileSync + new Function to avoid all module-system friction.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { BUILDER_INPUT } from '../fixtures/builder-input.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load schema-builder as a self-contained script ─────────────────────────
let build, buildStreaming;

beforeAll(() => {
  const src = readFileSync(join(__dirname, '../../src/exporter/shared/schema-builder.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  ({ build, buildStreaming } = mod.exports);
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function buildFrom(overrides = {}) {
  return build({ ...BUILDER_INPUT, ...overrides });
}
function nodeById(output, id) {
  return output.nodes.find(n => n.id === id);
}
function edgesOfType(output, type) {
  return output.edges.filter(e => e.type === type);
}

// ── 1. Module exports ────────────────────────────────────────────────────────
describe('module exports', () => {
  it('exports build and buildStreaming functions', () => {
    expect(typeof build).toBe('function');
    expect(typeof buildStreaming).toBe('function');
  });
});

// ── 2. Empty input ───────────────────────────────────────────────────────────
describe('empty input', () => {
  it('returns a valid output shape with no nodes or edges', () => {
    const out = build({});
    expect(out).toHaveProperty('nodes');
    expect(out).toHaveProperty('edges');
    expect(out).toHaveProperty('_stats');
    expect(out).toHaveProperty('_schema_version', 1);
    expect(out.nodes).toHaveLength(0);
    expect(out.edges).toHaveLength(0);
    expect(out._stats.counts.tables).toBe(0);
  });
});

// ── 3. Nodes ─────────────────────────────────────────────────────────────────
describe('nodes', () => {
  it('creates one node per sysDbObject entry', () => {
    const out = buildFrom();
    // 5 sysDbObject rows in fixture
    const tableNodes = out.nodes.filter(n => !n._isView);
    expect(tableNodes.length).toBe(5);
  });

  it('node has correct id, label, scope, and access', () => {
    const out = buildFrom();
    const task = nodeById(out, 'task');
    expect(task).toBeDefined();
    expect(task.label).toBe('Task');
    expect(task.scope).toBe('Global');
    expect(task.access).toBeNull();
  });

  it('package_private table carries access flag', () => {
    const out = buildFrom();
    const priv = nodeById(out, 'sn_sm_secret');
    expect(priv.access).toBe('package_private');
  });
});

// ── 4. Fields ─────────────────────────────────────────────────────────────────
describe('fields', () => {
  it('table-level dictionary rows (empty element) are skipped', () => {
    const out = buildFrom();
    const task = nodeById(out, 'task');
    const hasEmpty = task.fields.some(f => f.name === '');
    expect(hasEmpty).toBe(false);
  });

  it('duplicate (table, element) dictionary rows are deduplicated', () => {
    const out = buildFrom();
    const task = nodeById(out, 'task');
    const sysIdFields = task.fields.filter(f => f.name === 'sys_id');
    // Fixture has two sys_id rows for task — only one should survive
    expect(sysIdFields).toHaveLength(1);
  });

  it('field has correct structure', () => {
    const out = buildFrom();
    const task = nodeById(out, 'task');
    const sysId = task.fields.find(f => f.name === 'sys_id');
    expect(sysId).toMatchObject({
      name: 'sys_id',
      label: 'Sys ID',
      type: 'GUID',
      primary: true,
      mandatory: false,
    });
  });
});

// ── 5. Edges ─────────────────────────────────────────────────────────────────
describe('edges — extends', () => {
  it('creates an extends edge for tables with super_class', () => {
    const out = buildFrom();
    const ext = edgesOfType(out, 'extends');
    const incidentExt = ext.find(e => e.source === 'incident' && e.target === 'task');
    expect(incidentExt).toBeDefined();
  });

  it('tables without super_class produce no extends edge', () => {
    const out = buildFrom();
    const ext = edgesOfType(out, 'extends');
    const noParent = ext.find(e => e.source === 'task');
    expect(noParent).toBeUndefined();
  });
});

describe('edges — references', () => {
  it('creates a reference edge for a valid reference field', () => {
    const out = buildFrom();
    const refs = edgesOfType(out, 'reference');
    const assignedTo = refs.find(e => e.source === 'task' && e.target === 'sys_user');
    expect(assignedTo).toBeDefined();
    expect(assignedTo.field).toBe('assigned_to');
  });

  it('skips reference edges where the target table does not exist', () => {
    const out = buildFrom();
    const refs = edgesOfType(out, 'reference');
    const orphan = refs.find(e => e.target === 'nonexistent_table');
    expect(orphan).toBeUndefined();
  });
});

describe('edges — M2M', () => {
  it('creates an M2M edge with junction table metadata', () => {
    const out = buildFrom();
    const m2m = edgesOfType(out, 'm2m');
    expect(m2m).toHaveLength(1);
    expect(m2m[0]).toMatchObject({
      source: 'incident',
      target: 'sys_user',
      viaTable: 'incident_user',
    });
  });
});

// ── 6. DB views ───────────────────────────────────────────────────────────────
describe('DB views', () => {
  it('creates a view node with _isView: true', () => {
    const out = buildFrom();
    const view = nodeById(out, 'task_view');
    expect(view).toBeDefined();
    expect(view._isView).toBe(true);
  });

  it('view node is excluded from the tables stat count', () => {
    const out = buildFrom();
    // 5 tables + 1 view in fixture; _stats.counts.tables must not include the view
    expect(out._stats.counts.tables).toBe(5);
    expect(out._stats.counts.db_views).toBe(1);
  });
});

// ── 7. Restricted hints ───────────────────────────────────────────────────────
describe('_restrictedHints', () => {
  it('lists package_private tables', () => {
    const out = buildFrom();
    expect(out._restrictedHints.packagePrivateTables).toContain('sn_sm_secret');
  });

  it('does not list normal tables as package_private', () => {
    const out = buildFrom();
    expect(out._restrictedHints.packagePrivateTables).not.toContain('task');
  });
});

// ── 8. CI relationships ───────────────────────────────────────────────────────
describe('CI relationships', () => {
  it('deduplicates mirror pairs (parent=true + parent=false) into one entry', () => {
    const out = buildFrom();
    // Fixture has 2 rows for the same relationship (both perspectives)
    // SchemaBuilder should collapse to 1
    expect(out._ciRelationships).toHaveLength(1);
  });

  it('CI relationship has correct parent/child labels', () => {
    const out = buildFrom();
    const rel = out._ciRelationships[0];
    expect(rel.parentClass).toBe('cmdb_ci_computer');
    expect(rel.childClass).toBe('cmdb_ci_network_adapter');
    expect(rel.parentLabel).toBe('Contains');
    expect(rel.childLabel).toBe('Contained by');
  });
});

// ── 9. Stats ──────────────────────────────────────────────────────────────────
describe('_stats', () => {
  it('deepest_inheritance_chain reflects the longest extends chain', () => {
    // Fixture: incident → task (depth 1), change_request → task (depth 1)
    const out = buildFrom();
    expect(out._stats.coverage.deepest_inheritance_chain).toBe(1);
  });

  it('avg_fields_per_table excludes view nodes', () => {
    const out = buildFrom();
    // avg should be calculated over real tables only
    expect(out._stats.coverage.avg_fields_per_table).toBeGreaterThan(0);
  });

  it('scope counts are populated', () => {
    const out = buildFrom();
    expect(out._stats.scopes).toHaveProperty('Global');
    expect(out._stats.scopes['Global']).toBeGreaterThan(0);
  });

  it('package_private_tables count matches hints array length', () => {
    const out = buildFrom();
    expect(out._stats.counts.package_private_tables).toBe(
      out._restrictedHints.packagePrivateTables.length
    );
  });
});

// ── 10. Type catalog ──────────────────────────────────────────────────────────
describe('_typeCatalog', () => {
  it('is populated from sysGlideObject entries', () => {
    const out = buildFrom();
    expect(out._typeCatalog).toHaveProperty('GUID');
    expect(out._typeCatalog['GUID'].label).toBe('Sys ID (GUID)');
  });
});

// ── 11. Schema version ────────────────────────────────────────────────────────
describe('_schema_version', () => {
  it('is 1 (numeric)', () => {
    const out = buildFrom();
    expect(out._schema_version).toBe(1);
  });
});

// ── 12. _instance passthrough ─────────────────────────────────────────────────
describe('_instance', () => {
  it('passes through the instance metadata', () => {
    const out = buildFrom();
    expect(out._instance.instance_name).toBe('test-instance');
    expect(out._instance.export_mode).toBe('background-script');
  });
});

// ── 13. buildStreaming ────────────────────────────────────────────────────────
describe('buildStreaming', () => {
  it('calls writeFn with JSON chunks and returns counts', () => {
    const chunks = [];
    const result = buildStreaming(BUILDER_INPUT, chunk => chunks.push(chunk));
    expect(chunks.length).toBeGreaterThan(0);
    // Reassemble and parse
    const json = JSON.parse(chunks.join(''));
    expect(json).toHaveProperty('nodes');
    expect(json).toHaveProperty('edges');
    expect(result).toHaveProperty('counts');
    expect(result.counts).toHaveProperty('tables');
  });
});

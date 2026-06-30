/**
 * Unit tests for src/modules/export/diff-export.js
 *
 * The diff-export serialisers are pure — they consume a diff matrix (the output
 * of computeDiffMatrix) and produce serialisable structures / strings.
 */
import { describe, it, expect } from 'vitest';
import { computeDiffMatrix } from '../../../../src/modules/schema-diff/compute-matrix.js';
import {
  diffToExport,
  diffToMarkdown,
  diffToTurtleComment,
  toYaml,
} from '../../../../src/modules/export/diff-export.js';

const node = (id, label, fields = []) => ({ id, label: label || id, fields });
const field = (name, type = 'string') => ({ name, type });
const schema = (nodes = [], edges = []) => ({ nodes, edges });

// Base has incident(+number) and task. Compare A adds problem, removes task,
// retypes incident.number, drops field incident.state.
const base = schema([
  node('incident', 'Incident', [field('number'), field('state')]),
  node('task', 'Task'),
]);
const compareA = schema([
  node('incident', 'Incident', [field('number', 'integer')]),
  node('problem', 'Problem'),
]);
const compareB = schema([
  node('incident', 'Incident', [field('number'), field('state')]),
  node('task', 'Task'),
]); // identical to base → no diff

function matrix() {
  return computeDiffMatrix(base, [
    { id: 'a', label: 'Prod', data: compareA },
    { id: 'b', label: 'Stage', data: compareB },
  ]);
}

describe('diffToExport', () => {
  it('returns null when nothing is included', () => {
    expect(diffToExport([], {})).toBeNull();
    expect(diffToExport(matrix(), { includedIds: [] })).toBeNull();
  });

  it('builds a per-table, per-compare structure with a roll-up summary', () => {
    const de = diffToExport(matrix(), { baseLabel: 'Dev' });
    expect(de.base).toBe('Dev');
    expect(de.compares.map(c => c.id)).toEqual(['a', 'b']);
    // problem (added by A), task (removed by A), incident (changed by A) all differ.
    const ids = de.tables.map(t => t.id);
    expect(ids).toEqual(['incident', 'problem', 'task']); // sorted
    expect(de.summary).toMatchObject({ tablesDiffering: 3, added: 1, removed: 1, changed: 1 });
  });

  it('captures field-level changes for changed tables', () => {
    const de = diffToExport(matrix(), {});
    const inc = de.tables.find(t => t.id === 'incident');
    const a = inc.perCompare.a;
    expect(a.status).toBe('changed');
    expect(a.removedFields.map(f => f.name)).toContain('state');
    expect(a.changedFields).toEqual([
      { name: 'number', baseType: 'string', compareType: 'integer' },
    ]);
    // Stage (b) is identical → no entry for incident under b.
    expect(inc.perCompare.b).toBeUndefined();
  });

  it('honors the includedIds subset', () => {
    const de = diffToExport(matrix(), { includedIds: ['b'] });
    // b is identical to base → no differing tables → null.
    expect(de).toBeNull();
  });
});

describe('diffToMarkdown', () => {
  it('renders a Differences section with per-compare detail', () => {
    const md = diffToMarkdown(diffToExport(matrix(), { baseLabel: 'Dev' }));
    expect(md).toContain('## Comparison — differences');
    expect(md).toContain('**Base:** Dev');
    expect(md).toContain('`incident`');
    expect(md).toContain('Prod');
    expect(md).toMatch(/retyped.*number.*string → integer/);
  });
});

describe('diffToTurtleComment', () => {
  it('renders a comment block, every line prefixed with #', () => {
    const ttl = diffToTurtleComment(diffToExport(matrix(), { baseLabel: 'Dev' }));
    expect(
      ttl
        .split('\n')
        .filter(Boolean)
        .every(l => l.startsWith('#'))
    ).toBe(true);
    expect(ttl).toContain('incident:');
  });
});

describe('toYaml', () => {
  it('emits nested objects and arrays deterministically', () => {
    const y = toYaml({ a: 1, b: ['x', 'y'], c: { d: true } });
    expect(y).toContain('a: 1');
    expect(y).toContain('b:');
    expect(y).toContain('- x');
    expect(y).toContain('c:');
    expect(y).toContain('d: true');
  });

  it('quotes strings that could be misread as other scalars', () => {
    expect(toYaml('true')).toBe("'true'");
    expect(toYaml('a: b')).toBe("'a: b'");
    expect(toYaml('plain')).toBe('plain');
  });
});

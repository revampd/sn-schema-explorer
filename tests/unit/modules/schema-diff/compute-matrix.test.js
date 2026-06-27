/**
 * Unit tests for src/modules/schema-diff/compute-matrix.js (#150)
 *
 * computeDiffMatrix / rollupMatrix are pure — no DOM or state. The matrix is just
 * one pairwise computeDiff per compare subject; the roll-up aggregates per-table
 * status across subjects for the N-column sidebar/inspector.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDiffMatrix,
  rollupMatrix,
} from '../../../../src/modules/schema-diff/compute-matrix.js';

const schema = (nodes = [], edges = []) => ({ nodes, edges });
const node = (id, fields = []) => ({ id, fields });
const field = (name, type = 'string') => ({ name, type });

describe('computeDiffMatrix', () => {
  it('returns one diff per subject, in order, stamped with id + label', () => {
    const base = schema([node('task'), node('incident')]);
    const subjects = [
      { id: 'i_prod', label: 'Prod', data: schema([node('task')]) }, // incident removed
      {
        id: 'i_uat',
        label: 'UAT',
        data: schema([node('task'), node('incident'), node('problem')]),
      }, // problem added
    ];
    const matrix = computeDiffMatrix(base, subjects);
    expect(matrix).toHaveLength(2);
    expect(matrix[0]._compareId).toBe('i_prod');
    expect(matrix[0]._compareLabel).toBe('Prod');
    expect(matrix[0].removed.has('incident')).toBe(true);
    expect(matrix[1]._compareId).toBe('i_uat');
    expect(matrix[1].added.has('problem')).toBe(true);
  });

  it('falls back to id when no label is given, and handles empty subjects', () => {
    const base = schema([node('task')]);
    const matrix = computeDiffMatrix(base, [{ id: 'i_x', data: schema([node('task')]) }]);
    expect(matrix[0]._compareLabel).toBe('i_x');
    expect(computeDiffMatrix(base, [])).toEqual([]);
    expect(computeDiffMatrix(base, null)).toEqual([]);
  });
});

describe('rollupMatrix', () => {
  it('lists every table differing in at least one subject, with per-subject status', () => {
    const base = schema([node('task', [field('a')]), node('incident')]);
    const subjects = [
      // prod: incident removed, task unchanged
      { id: 'i_prod', label: 'Prod', data: schema([node('task', [field('a')])]) },
      // uat: task changed (field b added), incident present & identical, problem added
      {
        id: 'i_uat',
        label: 'UAT',
        data: schema([node('task', [field('a'), field('b')]), node('incident'), node('problem')]),
      },
    ];
    const matrix = computeDiffMatrix(base, subjects);
    const { tables } = rollupMatrix(matrix);

    // task differs in uat (changed) but is 'same' in prod
    const task = tables.get('task');
    expect(task.statuses.get('i_prod')).toBe('same');
    expect(task.statuses.get('i_uat')).toBe('changed');
    expect(task.anyChanged).toBe(true);

    // incident removed in prod, same in uat
    const incident = tables.get('incident');
    expect(incident.statuses.get('i_prod')).toBe('removed');
    expect(incident.statuses.get('i_uat')).toBe('same');
    expect(incident.anyRemoved).toBe(true);

    // problem added in uat, absent in prod (base has no such table)
    const problem = tables.get('problem');
    expect(problem.statuses.get('i_uat')).toBe('added');
    expect(problem.statuses.get('i_prod')).toBe('absent');
    expect(problem.anyAdded).toBe(true);
  });

  it('omits tables identical across every subject', () => {
    const base = schema([node('task', [field('a')])]);
    const subjects = [
      { id: 'i_a', data: schema([node('task', [field('a')])]) },
      { id: 'i_b', data: schema([node('task', [field('a')])]) },
    ];
    const { tables } = rollupMatrix(computeDiffMatrix(base, subjects));
    expect(tables.size).toBe(0);
  });

  it('handles an empty / null matrix', () => {
    expect(rollupMatrix([]).tables.size).toBe(0);
    expect(rollupMatrix(null).tables.size).toBe(0);
  });
});

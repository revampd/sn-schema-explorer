/**
 * N-way diff computation (#150) — the seam that lets the inspector and sidebar
 * scale from 1 → N compare instances while the canvas stays pairwise.
 *
 * Rather than a bespoke N-way diff engine, this composes the existing pairwise
 * `computeDiff` once per compare subject (base vs each). The array it returns —
 * the "diff matrix" — is ordered to match `diffState._compareIds`, so entry [0]
 * is the primary compare and is identical to the pairwise `_diffData` that drives
 * the canvas/graft. The inspector and sidebar aggregate the whole array.
 *
 * Pure: no DOM, no module-level state — unit-testable in isolation.
 */
import { computeDiff } from './compute-diff.js';

/**
 * Build the diff matrix: one pairwise diff per compare subject.
 *
 * @param {object} baseGraph  the loaded graph data (base side of every diff)
 * @param {Array<{id:string,label?:string,data:object}>} subjects compare instances,
 *        in selection order (primary first)
 * @returns {Array} per-subject computeDiff results, each stamped with `_compareId`
 *        / `_compareLabel`, in the same order as `subjects`.
 */
export function computeDiffMatrix(baseGraph, subjects) {
  return (subjects || []).map(s => {
    const diff = computeDiff(baseGraph, s.data);
    diff._compareId = s.id;
    diff._compareLabel = s.label || s.id;
    return diff;
  });
}

/**
 * The per-subject status of one table, derived from a single pairwise diff.
 * 'absent' means the base side has no such table at all (so the row only exists
 * because some OTHER subject added it). Returns one of:
 *   'added' | 'removed' | 'changed' | 'same' | 'absent'
 */
function statusFor(diff, tableId) {
  if (diff.added.has(tableId)) return 'added';
  if (diff.removed.has(tableId)) return 'removed';
  if (diff.changed.has(tableId)) return 'changed';
  // Present & identical in both base and this compare.
  if (diff.baseMap.has(tableId) && diff.compareMap.has(tableId)) return 'same';
  return 'absent';
}

/**
 * Aggregate the matrix into a per-table roll-up for the N-column sidebar/inspector.
 * Lists every table that differs in AT LEAST one subject, with its per-subject
 * status keyed by compareId.
 *
 * @param {Array} matrix  output of computeDiffMatrix
 * @returns {{ tables: Map<string,{statuses:Map<string,string>, anyAdded:boolean,
 *   anyRemoved:boolean, anyChanged:boolean}> }}
 */
export function rollupMatrix(matrix) {
  const tables = new Map();
  if (!matrix || !matrix.length) return { tables };

  // The universe of tables that differ anywhere: union of every subject's
  // added/removed/changed. A table identical across all subjects never appears.
  const differing = new Set();
  for (const diff of matrix) {
    for (const id of diff.added) differing.add(id);
    for (const id of diff.removed) differing.add(id);
    for (const id of diff.changed.keys()) differing.add(id);
  }

  for (const id of differing) {
    const statuses = new Map();
    let anyAdded = false;
    let anyRemoved = false;
    let anyChanged = false;
    for (const diff of matrix) {
      const st = statusFor(diff, id);
      statuses.set(diff._compareId, st);
      if (st === 'added') anyAdded = true;
      else if (st === 'removed') anyRemoved = true;
      else if (st === 'changed') anyChanged = true;
    }
    tables.set(id, { statuses, anyAdded, anyRemoved, anyChanged });
  }

  return { tables };
}

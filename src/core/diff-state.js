export const diffState = {
  _diffData: null,
  _diffShowAll: false,
  _diffFilter: 'all',
  // Registry id of the instance currently selected as the compare side, or null
  // when no comparison is active. The picker reads this (not its own <select>
  // value) so a base switch — e.g. the swap button — can repopulate the compare
  // dropdown from the true diff state rather than a value cleared mid-swap.
  //
  // This is the PRIMARY compare — the low-cardinality reference the canvas, graft,
  // and edge overlays key off (#150: a graph node is a single mark that can't
  // encode N-way diff). It is always `_compareIds[0]`.
  _compareId: null,
  // #150 — N-way comparison. The full, ordered list of compare instances the
  // user has selected (primary = [0] = `_compareId`). The inspector + sidebar
  // scale to N columns over this list; the canvas stays pairwise vs the primary.
  // Empty when no comparison is active.
  _compareIds: [],
  // Per-subject pairwise diffs (one computeDiff result per entry in `_compareIds`,
  // same order; `_diffMatrix[0]` === `_diffData`). The inspector + sidebar
  // aggregate this array; the canvas keeps using `_diffData` alone. Null when no
  // comparison is active. (#150)
  _diffMatrix: null,
  // Group keys collapsed in the report list ('added' | 'removed' | 'changed' |
  // 'matrix'). Purely a display state; doesn't affect counts.
  _collapsedGroups: [],
  // Element-type slice for the report's CHANGED rows (#4): null = all kinds; else
  // an array of element-type keys ('fields' | 'reference' | 'extends' | 'm2m' |
  // 'rel' | 'view' | 'cmdb_rel'). A changed table shows only when its change
  // touches a selected kind. Added/Removed rows are unaffected.
  _diffElementFilter: null,
};

/**
 * Is a comparison active? Drives the Differences layer on the Schema Map now that
 * Diff is a layer rather than a separate view-mode (#141).
 */
export function isComparing() {
  return !!diffState._diffData;
}

/** Is the Differences overlay painting? It's always on while a comparison is
 *  active — there is no separate toggle anymore (the canvas just shows the diff). */
export function isStructureLayerOn() {
  return isComparing();
}

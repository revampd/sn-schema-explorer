export const diffState = {
  _diffData: null,
  _diffShowAll: false,
  _diffFilter: 'all',
  // Config-drift sidebar (#139b): which config status the app list is filtered to
  // ('all' = all non-sync changes), and the scope key of the app whose tables are
  // currently highlighted on the canvas (or null).
  _configFilter: 'all',
  _activeConfigApp: null,
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
  // #150 — the canvas comparison overlay is ONE "Differences" layer: a single
  // toggle that paints the structural difference (added/removed/changed node
  // colours + edge pills) for the compared instances. There is no structure/config
  // split — "diff is diff"; config drift is surfaced in the INSPECTOR for the
  // selected table (and in the sidebar report), not as a separate canvas channel.
  // Turning it off mutes the overlay without dropping the comparison.
  _diffLayerOn: true,
  // Report row-type filter: which categories are included in the "Differences"
  // sidebar list AND folded into the Added/Removed/Changed summary counts.
  // `table` = structural table changes; `app` = configuration drift rows.
  _diffTypes: { table: true, app: true },
  // Group keys collapsed in the report list ('config' | 'added' | 'removed' |
  // 'changed' | 'matrix'). Purely a display state; doesn't affect counts.
  _collapsedGroups: [],
};

/**
 * Is a comparison active? Drives the Differences layer on the Schema Map now that
 * Diff is a layer rather than a separate view-mode (#141).
 */
export function isComparing() {
  return !!diffState._diffData;
}

/** Is the Differences overlay painting (comparison active + the layer toggle on)? */
export function isStructureLayerOn() {
  return isComparing() && diffState._diffLayerOn;
}

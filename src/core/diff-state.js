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
  _compareId: null,
  // #141 — Diff collapsed from a view-mode into a LAYER on the Schema Map. A
  // comparison is "active" whenever a compare is loaded (`_diffData` set); the
  // structure-diff layer (added/removed/changed colouring + graft) can be toggled
  // off without dropping the comparison.
  _structureLayer: true,
};

/**
 * Is a comparison active? Drives the structure/config layers on the Schema Map
 * now that Diff is a layer rather than a separate view-mode (#141).
 */
export function isComparing() {
  return !!diffState._diffData;
}

/** Is the structure-diff layer currently painting (comparison active + toggle on)? */
export function isStructureLayerOn() {
  return isComparing() && diffState._structureLayer;
}

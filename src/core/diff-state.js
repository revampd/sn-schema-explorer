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
  // #141 — Diff collapsed from a view-mode into a LAYER on the Schema Map. A
  // comparison is "active" whenever a compare is loaded (`_diffData` set); the
  // structure-diff layer (added/removed/changed colouring + graft) can be toggled
  // off without dropping the comparison.
  _structureLayer: true,
  // #150 — the canvas comparison overlay is ONE "Differences" layer with two
  // channels (sub-mutes): `_structureLayer` (node stroke colours + edge pills) and
  // `_configLayer` (config-drift corner badges). `_diffLayerOn` is the master
  // switch; turning it off mutes both channels without dropping the comparison.
  _diffLayerOn: true,
  _configLayer: true,
};

/**
 * Is a comparison active? Drives the structure/config layers on the Schema Map
 * now that Diff is a layer rather than a separate view-mode (#141).
 */
export function isComparing() {
  return !!diffState._diffData;
}

/** Is the structure channel painting (comparison active + master on + structure sub on)? */
export function isStructureLayerOn() {
  return isComparing() && diffState._diffLayerOn && diffState._structureLayer;
}

/** Is the config-drift channel painting (comparison active + master on + config sub on)? */
export function isConfigLayerOn() {
  return isComparing() && diffState._diffLayerOn && diffState._configLayer;
}

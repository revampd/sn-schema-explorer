// ── Path Finder result state ──────────────────────────────────────────────────
//
// Shared singleton for the current path-search result. Extracted from the
// path-finder module-locals (#73) so the DAG renderer + result-list renderer in
// path-view.js and the search driver in index.js mutate one object by reference.
//
//   paths         — all returned PathResult objects (primary first, then alts)
//   activePathIdx — index of the path currently highlighted on the canvas
//   fieldName     — the resolved target field name (field mode), else null
//   sourceId      — the search source table id
export const pfState = {
  paths: [],
  activePathIdx: 0,
  fieldName: null,
  sourceId: null,
};

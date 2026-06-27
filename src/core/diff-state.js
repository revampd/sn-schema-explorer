export const diffState = {
  _diffData: null,
  _diffShowAll: false,
  _diffFilter: 'all',
  _diffSearch: '',
  // Registry id of the instance currently selected as the compare side, or null
  // when no comparison is active. The picker reads this (not its own <select>
  // value) so a base switch — e.g. the swap button — can repopulate the compare
  // dropdown from the true diff state rather than a value cleared mid-swap.
  _compareId: null,
};

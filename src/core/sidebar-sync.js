import { uiState } from './state.js';
import { Dom } from './dom.js';
import { tlSetSpacerHeight, tlRenderVisible } from './table-list.js';

// Single source of truth for which sidebar elements are visible in each view
// mode. Previously the Schema Diff and Path Finder modules each toggled the same
// shared elements with slightly different, cross-referencing rules (each guarding
// against the other's mode). This sets every element deterministically from
// uiState.viewMode, so it's idempotent and a new view mode only needs a branch
// here rather than another copy.
//
// Mode-specific side effects (diff list rebuild, pfValidate) stay in their own
// modules — this only owns DOM visibility.
export function syncSidebarForMode() {
  const mode = uiState.viewMode;
  const isDiff = mode === 'diff';
  const isPath = mode === 'path';
  const isDefault = !isDiff && !isPath;

  const diffSidebar = document.getElementById('diff-sidebar');
  const pfSidebar = document.getElementById('pf-sidebar');
  if (diffSidebar) diffSidebar.style.display = isDiff ? 'flex' : 'none';
  if (pfSidebar) pfSidebar.style.display = isPath ? 'flex' : 'none';

  // Default-view sidebar elements — only shown in the default (force) view.
  const show = (idOrEl, visible) => {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (el) el.style.display = visible ? '' : 'none';
  };
  show('table-list', isDefault);
  show('sort-bar', isDefault);
  show('scope-info-group', isDefault);

  // Density controls: visible in default + diff, hidden in path.
  show(document.getElementById('density-group') || Dom.densityGroup, !isPath);

  // Filter bar + button: hidden only in path (advanced filter still applies in
  // diff). In other modes restore display so the `.open` class controls it.
  if (Dom.filterBar) Dom.filterBar.style.display = isPath ? 'none' : '';
  if (Dom.filterOpenBtn) Dom.filterOpenBtn.style.display = isPath ? 'none' : '';

  // Search placeholder reflects what searching does in the active view.
  if (Dom.searchBox) {
    Dom.searchBox.placeholder =
      isPath || Dom.searchBox.dataset.mode !== 'fields' ? 'search tables…' : 'search fields…';
  }

  // Returning to the default view needs the virtualised table list re-measured.
  if (isDefault) {
    requestAnimationFrame(() => {
      tlSetSpacerHeight();
      tlRenderVisible();
    });
  }
}

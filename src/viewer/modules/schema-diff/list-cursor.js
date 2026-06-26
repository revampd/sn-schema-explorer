// ── Diff list keyboard cursor ─────────────────────────────────────────────────
//
// Tracks the keyboard-navigation cursor over the `#diff-list .diff-item` rows.
// Extracted from schema-diff/index.js (#73) so the list renderer and the sidebar
// keyboard handler share one cursor singleton instead of a module-local. The raw
// index stays private; callers read the focused row via getFocusedDiffItem().

let _diffCursor = -1;

function getDiffItems() {
  return [...document.querySelectorAll('#diff-list .diff-item')];
}

export function moveDiffCursor(delta) {
  const items = getDiffItems();
  if (!items.length) return;
  if (_diffCursor >= 0 && _diffCursor < items.length) {
    items[_diffCursor].classList.remove('diff-item--focused');
  }
  _diffCursor = Math.max(
    0,
    Math.min(
      items.length - 1,
      _diffCursor < 0 ? (delta > 0 ? 0 : items.length - 1) : _diffCursor + delta
    )
  );
  items[_diffCursor].classList.add('diff-item--focused');
  items[_diffCursor].scrollIntoView({ block: 'nearest' });
}

export function clearDiffCursor() {
  getDiffItems().forEach(el => el.classList.remove('diff-item--focused'));
  _diffCursor = -1;
}

// The currently-focused row element, or null when the cursor is unset.
export function getFocusedDiffItem() {
  if (_diffCursor < 0) return null;
  return getDiffItems()[_diffCursor] || null;
}

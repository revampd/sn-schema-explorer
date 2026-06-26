// Shared keyboard-navigation core for the two autocomplete widgets (filter
// builder + Path Finder). It owns the active-index state and the
// ArrowUp/ArrowDown/Enter/Escape handling — the part both implementations
// previously duplicated. Each call-site keeps its own rendering, positioning,
// and select semantics and just supplies the hooks below.
//
//   attachAutocompleteKeys({
//     input,        // the <input> element
//     isOpen,       // () => boolean — is the dropdown currently shown?
//     getRows,      // () => HTMLElement[] — current row elements, in order
//     onAccept,     // (index) => void — commit the row at index (Enter)
//     onClose,      // () => void — hide the dropdown (Escape)
//     activeClass?, // highlight class toggled on the active row (default 'active')
//     wrap?,        // wrap around past the ends (default true)
//   }) => { reset() }
export function attachAutocompleteKeys({
  input,
  isOpen,
  getRows,
  onAccept,
  onClose,
  activeClass = 'active',
  wrap = true,
}) {
  let activeIdx = -1;

  function setActive(idx) {
    const rows = getRows();
    if (!rows.length) {
      activeIdx = -1;
      return;
    }
    activeIdx = wrap
      ? ((idx % rows.length) + rows.length) % rows.length
      : Math.max(0, Math.min(idx, rows.length - 1));
    rows.forEach((r, i) => r.classList.toggle(activeClass, i === activeIdx));
    rows[activeIdx]?.scrollIntoView?.({ block: 'nearest' });
  }

  function reset() {
    activeIdx = -1;
  }

  input.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIdx - 1);
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        onAccept(activeIdx);
      }
    } else if (e.key === 'Escape') {
      onClose();
      reset();
    }
  });

  return { reset };
}

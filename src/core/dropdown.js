/* ============================================================================
 * core/dropdown.js — custom single-select dropdown (app-themed)
 * ============================================================================
 * A lightweight replacement for a native <select> whose OPEN option list can't
 * be styled by CSS. Renders a button + a custom popup list so both the closed
 * control and the open menu match the app theme. Keyboard-accessible
 * (ArrowUp/Down, Enter/Space, Escape, Home/End) and ARIA-labelled as a listbox.
 *
 * Usage:
 *   const dd = createDropdown({ title, ariaLabel, onChange });
 *   mount.appendChild(dd.el);
 *   dd.setOptions([{ value, label, disabled? }], selectedValue);
 *   dd.getValue();  dd.setValue(v, { silent: true });
 *
 * onChange(value) fires only on user-driven selection, never on a silent
 * setValue/setOptions — mirroring how callers treat a <select>.change event.
 * ============================================================================ */

let _ddSeq = 0;

export function createDropdown({
  title = '',
  ariaLabel = '',
  onChange = null,
  className = '',
} = {}) {
  const uid = 'sndd-' + ++_ddSeq;
  let options = [];
  let value = null;
  let open = false;
  let activeIdx = -1;

  const root = document.createElement('div');
  root.className = 'sn-dd' + (className ? ' ' + className : '');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sn-dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  if (title) btn.title = title;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'sn-dd-label';
  const chev = document.createElement('span');
  chev.className = 'sn-dd-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.textContent = '▾';
  btn.append(labelSpan, chev);

  const menu = document.createElement('div');
  menu.className = 'sn-dd-menu';
  menu.id = uid + '-menu';
  menu.setAttribute('role', 'listbox');
  menu.style.display = 'none';
  btn.setAttribute('aria-controls', menu.id);

  root.append(btn, menu);

  const currentOption = () => options.find(o => o.value === value) || null;

  function renderLabel() {
    const opt = currentOption();
    labelSpan.textContent = opt ? opt.label : '';
    labelSpan.classList.toggle('sn-dd-placeholder', !opt || opt.value === '');
  }

  function renderMenu() {
    menu.textContent = '';
    options.forEach((o, i) => {
      const row = document.createElement('div');
      row.className = 'sn-dd-opt';
      row.setAttribute('role', 'option');
      row.dataset.idx = String(i);
      row.textContent = o.label;
      const selected = o.value === value;
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) row.classList.add('is-selected');
      if (o.disabled) row.classList.add('is-disabled');
      if (i === activeIdx) row.classList.add('is-active');
      row.addEventListener('mousemove', () => setActive(i));
      row.addEventListener('mousedown', e => {
        // mousedown (not click) so the selection lands before the button blurs.
        e.preventDefault();
        if (!o.disabled) commit(i);
      });
      menu.appendChild(row);
    });
  }

  function setActive(i) {
    activeIdx = i;
    [...menu.children].forEach((el, idx) => el.classList.toggle('is-active', idx === i));
    const el = menu.children[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  // Close when clicking anywhere outside this dropdown. Attached only while open
  // and removed on close, so dropdowns that are created and discarded en masse
  // (e.g. the advanced-filter rows, rebuilt on every apply) don't leak listeners.
  function onOutside(e) {
    if (!root.contains(e.target) && !menu.contains(e.target)) closeMenu();
  }

  // The menu is position:fixed and anchored to the button each time it opens, so
  // it escapes any clipping/overflow ancestors (e.g. the filter bar, which clips
  // — that's why its "+ Add condition" picker is portalled to <body>). Recompute
  // on scroll/resize while open so it tracks the button.
  function positionMenu() {
    const r = btn.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    menu.style.width = r.width + 'px';
  }

  function openMenu() {
    if (open || !options.length) return;
    open = true;
    btn.setAttribute('aria-expanded', 'true');
    // Portal the menu to <body> so it escapes any clipping/transformed ancestor
    // (the filter bar does this for its own popups). position:fixed anchors it.
    document.body.appendChild(menu);
    menu.style.display = '';
    positionMenu();
    const sel = options.findIndex(o => o.value === value);
    setActive(sel >= 0 ? sel : 0);
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);
  }

  function closeMenu() {
    if (!open) return;
    open = false;
    btn.setAttribute('aria-expanded', 'false');
    menu.style.display = 'none';
    root.appendChild(menu); // return it to the component
    document.removeEventListener('mousedown', onOutside);
    window.removeEventListener('scroll', positionMenu, true);
    window.removeEventListener('resize', positionMenu);
  }

  function commit(i) {
    const o = options[i];
    if (!o || o.disabled) return;
    const changed = o.value !== value;
    value = o.value;
    renderLabel();
    renderMenu();
    closeMenu();
    btn.focus();
    if (changed && onChange) onChange(value);
  }

  function step(dir) {
    if (!options.length) return;
    let i = activeIdx;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) {
        setActive(i);
        return;
      }
    }
  }

  btn.addEventListener('click', () => (open ? closeMenu() : openMenu()));
  btn.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        open ? step(1) : openMenu();
        break;
      case 'ArrowUp':
        e.preventDefault();
        open ? step(-1) : openMenu();
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActive(0);
          if (options[0] && options[0].disabled) step(1);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActive(options.length - 1);
          if (options[activeIdx] && options[activeIdx].disabled) step(-1);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        open ? commit(activeIdx) : openMenu();
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          closeMenu();
        }
        break;
      case 'Tab':
        closeMenu();
        break;
    }
  });

  return {
    el: root,
    setOptions(opts, selectedValue) {
      options = (opts || []).map(o => ({
        value: o.value,
        label: o.label,
        disabled: !!o.disabled,
      }));
      if (selectedValue !== undefined) value = selectedValue;
      if (!options.some(o => o.value === value)) value = options.length ? options[0].value : null;
      renderLabel();
      renderMenu();
    },
    getValue: () => value,
    setValue(v, { silent = false } = {}) {
      if (!options.some(o => o.value === v)) return;
      const changed = v !== value;
      value = v;
      renderLabel();
      renderMenu();
      if (changed && !silent && onChange) onChange(value);
    },
    setDisabled(on) {
      btn.disabled = !!on;
      if (on) closeMenu();
    },
    close: closeMenu,
  };
}

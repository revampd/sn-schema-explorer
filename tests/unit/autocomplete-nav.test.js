/**
 * @vitest-environment jsdom
 *
 * Unit tests for the shared autocomplete keyboard-nav core (#42).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { attachAutocompleteKeys } from '../../src/core/autocomplete-nav.js';

let input, dropdown, open;
function rows() {
  return [...dropdown.querySelectorAll('.row')];
}
function setRows(n) {
  dropdown.innerHTML = Array.from({ length: n }, (_, i) => `<div class="row">${i}</div>`).join('');
}
function key(k) {
  input.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  );
}
function activeIndex() {
  return rows().findIndex(r => r.classList.contains('active'));
}

beforeEach(() => {
  document.body.innerHTML = '<input id="i"><div id="d"></div>';
  input = document.getElementById('i');
  dropdown = document.getElementById('d');
  open = true;
  setRows(3);
});

function attach(opts = {}) {
  return attachAutocompleteKeys({
    input,
    isOpen: () => open,
    getRows: rows,
    onAccept: vi.fn(),
    onClose: vi.fn(),
    ...opts,
  });
}

describe('attachAutocompleteKeys', () => {
  it('ArrowDown moves the active row down from nothing to the first', () => {
    attach();
    key('ArrowDown');
    expect(activeIndex()).toBe(0);
    key('ArrowDown');
    expect(activeIndex()).toBe(1);
  });

  it('wrap:true wraps past the ends', () => {
    attach({ wrap: true });
    key('ArrowDown'); // 0
    key('ArrowUp'); // from 0 wraps to last
    expect(activeIndex()).toBe(2);
    key('ArrowDown'); // from last wraps back to 0
    expect(activeIndex()).toBe(0);
  });

  it('wrap:false clamps at the ends', () => {
    attach({ wrap: false });
    key('ArrowUp'); // clamps to 0
    expect(activeIndex()).toBe(0);
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown'); // clamp at last (2)
    expect(activeIndex()).toBe(2);
  });

  it('Enter accepts the active row index; no-op when nothing active', () => {
    const onAccept = vi.fn();
    attach({ onAccept });
    key('Enter');
    expect(onAccept).not.toHaveBeenCalled();
    key('ArrowDown');
    key('Enter');
    expect(onAccept).toHaveBeenCalledWith(0);
  });

  it('Escape closes and clears the active row', () => {
    const onClose = vi.fn();
    attach({ onClose });
    key('ArrowDown');
    expect(activeIndex()).toBe(0);
    key('Escape');
    expect(onClose).toHaveBeenCalled();
    // reset() clears internal active index — next ArrowDown starts from 0 again
    key('ArrowDown');
    expect(activeIndex()).toBe(0);
  });

  it('does nothing when the dropdown is closed', () => {
    const onAccept = vi.fn();
    attach({ onAccept });
    open = false;
    key('ArrowDown');
    expect(activeIndex()).toBe(-1);
    key('Enter');
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('reset() clears the active highlight', () => {
    const nav = attach();
    key('ArrowDown');
    key('ArrowDown');
    expect(activeIndex()).toBe(1);
    nav.reset();
    key('ArrowDown'); // starts over from the top
    expect(activeIndex()).toBe(0);
  });
});

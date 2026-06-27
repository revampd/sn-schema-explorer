/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/core/dropdown.js (#126) — the custom app-themed single
 * select used in place of a native <select> (whose open list can't be themed).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDropdown } from '../../../src/core/dropdown.js';

const OPTS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie', disabled: true },
];

let dd;
beforeEach(() => {
  document.body.innerHTML = '';
  dd = createDropdown({ title: 'Pick', ariaLabel: 'Picker' });
  document.body.appendChild(dd.el);
});

const btn = () => dd.el.querySelector('.sn-dd-btn');
const menu = () => dd.el.querySelector('.sn-dd-menu');
const opts = () => [...dd.el.querySelectorAll('.sn-dd-opt')];
const key = k => btn().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('createDropdown', () => {
  it('renders options and reflects the selected value in the label', () => {
    dd.setOptions(OPTS, 'b');
    expect(opts().map(o => o.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(dd.el.querySelector('.sn-dd-label').textContent).toBe('Bravo');
    expect(dd.getValue()).toBe('b');
  });

  it('defaults to the first option when the selected value is unknown', () => {
    dd.setOptions(OPTS, 'nope');
    expect(dd.getValue()).toBe('a');
  });

  it('opens on click and selects an option via mousedown, firing onChange once', () => {
    const onChange = vi.fn();
    dd = createDropdown({ onChange });
    document.body.appendChild(dd.el);
    dd.setOptions(OPTS, 'a');

    btn().click();
    expect(btn().getAttribute('aria-expanded')).toBe('true');
    opts()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(dd.getValue()).toBe('b');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('b');
    expect(menu().style.display).toBe('none'); // closed after select
  });

  it('does not select a disabled option', () => {
    const onChange = vi.fn();
    dd = createDropdown({ onChange });
    document.body.appendChild(dd.el);
    dd.setOptions(OPTS, 'a');
    opts()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(dd.getValue()).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyboard: ArrowDown opens, skips disabled, Enter commits', () => {
    const onChange = vi.fn();
    dd = createDropdown({ onChange });
    document.body.appendChild(dd.el);
    dd.setOptions(OPTS, 'a');

    key('ArrowDown'); // opens, active = current (a, idx 0)
    expect(btn().getAttribute('aria-expanded')).toBe('true');
    key('ArrowDown'); // → Bravo (idx 1)
    key('ArrowDown'); // would be Charlie (disabled) → wraps to Alpha (idx 0)
    expect(dd.el.querySelector('.sn-dd-opt.is-active').textContent).toBe('Alpha');
    key('Enter');
    expect(dd.getValue()).toBe('a');
    expect(onChange).not.toHaveBeenCalled(); // unchanged value → no fire
  });

  it('Escape closes without changing the value', () => {
    dd.setOptions(OPTS, 'a');
    btn().click();
    key('Escape');
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    expect(dd.getValue()).toBe('a');
  });

  it('setValue updates silently or fires onChange', () => {
    const onChange = vi.fn();
    dd = createDropdown({ onChange });
    document.body.appendChild(dd.el);
    dd.setOptions(OPTS, 'a');

    dd.setValue('b', { silent: true });
    expect(dd.getValue()).toBe('b');
    expect(onChange).not.toHaveBeenCalled();

    dd.setValue('a');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a');

    dd.setValue('zzz'); // unknown → ignored
    expect(dd.getValue()).toBe('a');
  });

  it('closes the open menu on an outside click', () => {
    dd.setOptions(OPTS, 'a');
    btn().click();
    expect(menu().style.display).toBe('');
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu().style.display).toBe('none');
  });

  it('setDisabled disables the button and closes the menu', () => {
    dd.setOptions(OPTS, 'a');
    btn().click();
    dd.setDisabled(true);
    expect(btn().disabled).toBe(true);
    expect(menu().style.display).toBe('none');
  });
});

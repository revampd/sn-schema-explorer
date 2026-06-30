/* ============================================================================
 * core/header-compare.js — shared header "Compare" multi-select control
 * ============================================================================
 * A generic, provider-driven version of the header Compare dropdown (#150) so
 * more than one tool can present the SAME comparison UX. The control renders a
 * single marked-toggle dropdown (a ✓ marks instances in the comparison; the
 * closed-button label summarises the selection) plus an optional swap (⇄) button.
 *
 * Each consumer registers a provider describing its workspace + selection model;
 * the active provider (the one whose `eligible()` returns true) owns the control.
 *
 * Provider shape:
 *   {
 *     eligible(): boolean,                 // is this provider's workspace active + usable?
 *     getSelected(): string[],             // currently-selected compare ids
 *     getCandidates(): {id,label}[],       // instances selectable as compares (exclude base)
 *     labelFor(id): string,                // display label for a selected id
 *     onToggle(id): void,                  // user toggled a candidate in/out
 *     onClear(): void,                     // user picked "Compare: none"
 *     swap?: {                             // optional base↔primary swap
 *       canSwap(): boolean,
 *       onSwap(): void,
 *     },
 *   }
 *
 * Consumers call refreshHeaderCompare() (re-exported into their module) on the
 * events they care about; the control resolves the active provider each time.
 * ============================================================================ */

import { createDropdown } from './dropdown.js';

const NO_COMPARE = '__none__';

let _dd = null;
let _swapWired = false;
const _providers = [];

export function registerCompareProvider(provider) {
  _providers.push(provider);
}

function activeProvider() {
  return _providers.find(p => p.eligible && p.eligible()) || null;
}

export function refreshHeaderCompare() {
  const host = document.getElementById('header-compare');
  if (!host) return;
  const swapBtn = document.getElementById('header-swap');
  const provider = activeProvider();

  if (!provider) {
    host.style.display = 'none';
    if (swapBtn) swapBtn.style.display = 'none';
    return;
  }
  host.style.display = '';

  if (!_dd) {
    _dd = createDropdown({
      ariaLabel: 'Compare against',
      title: 'Compare the loaded instance against one or more others',
      onChange: id => {
        const p = activeProvider();
        if (!p) return;
        if (id === NO_COMPARE) p.onClear();
        else if (id) p.onToggle(id);
        refreshHeaderCompare();
      },
    });
  }
  if (_dd.el.parentElement !== host) host.appendChild(_dd.el);

  // Rows: every candidate, each toggleable; a ✓ marks the ones in the comparison.
  // The closed-button label (a value-'' row) summarises the selection.
  const selected = new Set(provider.getSelected());
  const n = selected.size;
  const summary =
    n === 0
      ? 'Compare…'
      : n === 1
        ? 'vs ' + provider.labelFor([...selected][0])
        : 'Compare: ' + n + ' instances';
  const candOpts = provider
    .getCandidates()
    .map(e => ({ value: e.id, label: (selected.has(e.id) ? '✓ ' : '') + 'vs ' + e.label }));
  const opts = [
    { value: '', label: summary },
    ...(n ? [{ value: NO_COMPARE, label: 'Compare: none' }] : []),
    ...candOpts,
  ];
  _dd.setOptions(opts, '');

  // Swap (⇄) — flips Base and the primary compare; only when the provider supports it.
  if (swapBtn) {
    if (!_swapWired) {
      swapBtn.addEventListener('click', () => {
        const p = activeProvider();
        if (p?.swap) {
          p.swap.onSwap();
          refreshHeaderCompare();
        }
      });
      _swapWired = true;
    }
    const sw = provider.swap;
    swapBtn.style.display = sw ? '' : 'none';
    swapBtn.disabled = sw ? !sw.canSwap() : true;
  }
}

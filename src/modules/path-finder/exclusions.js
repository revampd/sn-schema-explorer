/**
 * Path Finder hop-exclusions UI — extracted from path-finder/index.js (#73).
 *
 * Manages the set of tables / reference fields skipped as intermediates in
 * pathfinding (persisted in uiState.pfExcludedHops): the removable chips, the
 * add-exclusion autocomplete input, the "Clear all" button, and the
 * `pf-excluded-hops-changed` event dispatched by the canvas context menu.
 * Behaviour-preserving; the search re-runs via the injected onChange callback.
 */
import { graphState, uiState } from '../../core/state.js';
import { h } from '../../core/template.js';
import { Pathfinding } from './pathfinding.js';

const PF_EXCLUDED_KEY = 'snse:pfExcludedHops';

// Re-run the current search whenever exclusions change. Injected by initExclusions.
let _onChange = () => {};

function pfLoadExcludedHops() {
  try {
    const raw = localStorage.getItem(PF_EXCLUDED_KEY);
    if (!raw) return;
    const ids = JSON.parse(raw);
    if (Array.isArray(ids)) ids.forEach(id => uiState.pfExcludedHops.add(id));
  } catch (e) {}
}

function pfSaveExcludedHops() {
  try {
    localStorage.setItem(PF_EXCLUDED_KEY, JSON.stringify([...uiState.pfExcludedHops]));
  } catch (e) {
    console.warn('PathFinder: localStorage write failed', e);
  }
}

function pfRefreshExcludedChips() {
  const chips = document.getElementById('pf-excluded-chips');
  const clearBtn = document.getElementById('pf-excluded-clear');
  if (!chips) return;
  const excluded = uiState.pfExcludedHops;
  // "Clear all" only shown when there is something to clear
  if (clearBtn) clearBtn.style.display = excluded.size > 0 ? '' : 'none';
  chips.replaceChildren(
    ...[...excluded].sort().map(id => {
      const gd = graphState.graphData;
      const isField = id.includes('.');
      const chip = h('div', {
        class: 'pf-excluded-chip' + (isField ? ' pf-excluded-chip-field' : ''),
      });
      let displayText;
      if (isField) {
        const dotIdx = id.indexOf('.');
        const tbl = id.slice(0, dotIdx);
        const fld = id.slice(dotIdx + 1);
        const tblNode = gd?._nodeById?.get(tbl);
        const fieldMeta = tblNode?.fields?.find(f => f.name === fld);
        displayText =
          fieldMeta?.label && fieldMeta.label !== fld ? `${tbl}.${fieldMeta.label} (${fld})` : id;
      } else {
        const node = gd?._nodeById?.get(id);
        displayText = node?.label && node.label !== id ? `${node.label} (${id})` : id;
      }
      const name = h('span', { class: 'pf-excluded-chip-name', title: id }, displayText);
      const rm = h(
        'button',
        {
          class: 'pf-excluded-chip-remove',
          title: `Remove ${id} from exclusions`,
          onClick: () => {
            uiState.pfExcludedHops.delete(id);
            pfSaveExcludedHops();
            pfRefreshExcludedChips();
            _onChange();
          },
        },
        '×'
      );
      chip.append(name, rm);
      return chip;
    })
  );
}

function pfWireExclusionInput() {
  const input = document.getElementById('pf-excluded-add');
  const dropdown = document.getElementById('pf-excluded-ac');
  if (!input || !dropdown) return;

  let activeIdx = -1;
  let currentItems = [];

  function getSuggestions(query) {
    if (!graphState.graphData) return [];
    const raw = query || '';
    const dotIdx = raw.indexOf('.');

    if (dotIdx >= 0) {
      // Field-exclusion mode: "table.refField" completions
      const rawTable = raw.slice(0, dotIdx);
      const fieldPart = raw.slice(dotIdx + 1).toLowerCase();
      const tableNode =
        graphState.graphData._nodeById?.get(rawTable) ??
        graphState.graphData.nodes.find(n => n.id.toLowerCase() === rawTable.toLowerCase());
      if (!tableNode) return [];
      // Collect reference fields from the table and all its ancestors
      const refFields = new Map();
      const chain = [tableNode.id, ...Pathfinding.ancestorsOf(tableNode.id)];
      for (const tid of chain) {
        const t = graphState.graphData._nodeById?.get(tid);
        for (const f of t?.fields ?? []) {
          if (f.type === 'reference' && !refFields.has(f.name)) {
            refFields.set(f.name, { label: f.label, source: tid });
          }
        }
      }
      const prefix = tableNode.id + '.';
      const out = [];
      for (const [fname, meta] of refFields) {
        if (fieldPart && !fname.toLowerCase().includes(fieldPart)) continue;
        out.push({
          value: prefix + fname,
          subtitle: meta.label && meta.label !== fname ? meta.label : null,
          tag: meta.source !== tableNode.id ? `from ${meta.source}` : null,
          isField: true,
        });
        if (out.length >= 50) break;
      }
      out.sort((a, b) => {
        const av = a.value.slice(prefix.length).toLowerCase();
        const bv = b.value.slice(prefix.length).toLowerCase();
        const aP = av.startsWith(fieldPart);
        const bP = bv.startsWith(fieldPart);
        if (aP !== bP) return aP ? -1 : 1;
        return av.localeCompare(bv);
      });
      return out;
    }

    // Table-exclusion mode
    const q = raw.toLowerCase().trim();
    const out = [];
    for (const n of graphState.graphData.nodes) {
      if (q && !n.id.toLowerCase().includes(q) && !(n.label || '').toLowerCase().includes(q))
        continue;
      out.push({ value: n.id, subtitle: n.label && n.label !== n.id ? n.label : null });
      if (out.length >= 50) break;
    }
    out.sort((a, b) => {
      const aP = a.value.toLowerCase().startsWith(q);
      const bP = b.value.toLowerCase().startsWith(q);
      if (aP !== bP) return aP ? -1 : 1;
      return a.value.localeCompare(b.value);
    });
    return out;
  }

  function renderList(items) {
    currentItems = items;
    activeIdx = -1;
    dropdown.replaceChildren();
    if (!items.length) {
      dropdown.appendChild(h('div', { class: 'pf-ac-empty' }, 'No matches'));
      dropdown.classList.add('visible');
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      frag.appendChild(
        h(
          'div',
          {
            class: 'pf-ac-item' + (item.isField ? ' field-item' : ''),
            onMousedown: e => {
              e.preventDefault();
              accept(idx);
            },
          },
          h('span', { class: 'pf-ac-item-id' }, item.value),
          item.subtitle ? h('span', { class: 'pf-ac-item-label' }, item.subtitle) : null,
          item.tag ? h('span', { class: 'pf-ac-item-tag' }, item.tag) : null
        )
      );
    });
    dropdown.appendChild(frag);
    dropdown.classList.add('visible');
  }

  function close() {
    dropdown.classList.remove('visible');
    dropdown.replaceChildren();
    currentItems = [];
    activeIdx = -1;
  }

  function setActive(idx) {
    const rows = dropdown.querySelectorAll('.pf-ac-item');
    if (!rows.length) return;
    activeIdx = ((idx % rows.length) + rows.length) % rows.length;
    rows.forEach((r, i) => r.classList.toggle('active', i === activeIdx));
    rows[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }

  function accept(idx) {
    const item = currentItems[idx];
    if (!item) return;
    input.value = '';
    close();
    if (!uiState.pfExcludedHops.has(item.value)) {
      uiState.pfExcludedHops.add(item.value);
      pfSaveExcludedHops();
      pfRefreshExcludedChips();
      _onChange();
    }
  }

  function refresh() {
    const items = getSuggestions(input.value);
    if (!items.length) {
      if (input.value.trim()) renderList([]);
      else close();
      return;
    }
    renderList(items);
  }

  input.addEventListener('input', refresh);
  input.addEventListener('focus', refresh);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if (!dropdown.classList.contains('visible')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIdx - 1);
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0) {
        e.preventDefault();
        accept(activeIdx);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });
}

/**
 * Load persisted exclusions, render the chips, and wire the input, the
 * "Clear all" button, and the canvas context-menu event.
 * @param {object} opts
 * @param {() => void} opts.onChange called whenever the exclusion set changes,
 *   so the caller can auto-refresh the current search.
 */
export function initExclusions({ onChange } = {}) {
  if (onChange) _onChange = onChange;
  pfLoadExcludedHops();
  pfRefreshExcludedChips();
  pfWireExclusionInput();
  document.getElementById('pf-excluded-clear')?.addEventListener('click', () => {
    uiState.pfExcludedHops.clear();
    pfSaveExcludedHops();
    pfRefreshExcludedChips();
    _onChange();
  });
  // Listen for changes dispatched by interactions.js context menu
  document.addEventListener('pf-excluded-hops-changed', () => {
    pfSaveExcludedHops();
    pfRefreshExcludedChips();
    _onChange();
  });
}

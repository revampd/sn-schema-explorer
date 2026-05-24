import { graphState, uiState } from './state.js';
import { Settings } from '../modules/settings/index.js';
import { h } from './template.js';

// ── Edge-set accessors keyed by the 8 hasEdge condition types ─────────────────

const EDGE_SETS = {
  'ref-out':  gd => gd._refOutIds,
  'ref-in':   gd => gd._refInIds,
  'ext-out':  gd => gd._extOutIds,
  'ext-in':   gd => gd._extInIds,
  'm2m':      gd => gd._m2mIds,
  'rel':      gd => gd._relIds,
  'view':     gd => gd._viewIds,
  'cmdb_rel': gd => gd._cmdbRelIds,
};

// ── Cascading helper — nodes passing all conditions BEFORE condIndex ───────────
//
// Returns the set of nodes that would survive applying conditions 0..(condIndex-1)
// as a simple AND chain (ignoring connectors for the purpose of narrowing UI choices).
// This lets later condition UI show only values/options that are actually reachable.

function _nodesPassingBefore(condIndex) {
  const gd = graphState.graphData;
  if (!gd?.nodes) return [];
  if (condIndex === 0) return gd.nodes;

  const conds = uiState.filterConditions;

  // An OR condition opens a new independent AND-group → always cascade from all nodes,
  // not from the previous group's result set.
  if ((conds[condIndex]?.connector ?? 'AND') === 'OR') return gd.nodes;

  // AND condition: find where the current OR-group begins (the last OR boundary before
  // condIndex, which marks the first condition of this group).
  let groupStart = 0;
  for (let i = 1; i < condIndex; i++) {
    if ((conds[i].connector ?? 'AND') === 'OR') groupStart = i;
  }

  // Apply only the conditions within this OR-group that precede condIndex.
  const priorConds = conds.slice(groupStart, condIndex);
  return gd.nodes.filter(n => priorConds.every(c => _evalOne(c, n)));
}

// ── Single-condition evaluator ────────────────────────────────────────────────

function _evalOne(c, node) {
  const gd = graphState.graphData;
  switch (c.type) {
    case 'scope':
      return !c.values?.length || c.values.includes(node.scope);

    case 'tableType':
      if (c.value === 'regular') return !node._isView;
      if (c.value === 'views')   return !!node._isView;
      if (c.value === 'custom')  return Settings.isCustomName(node.id);
      if (c.value === 'cmdb')    return !!(gd?._cmdbCiIds?.has(node.id));  // backward compat
      return true;

    case 'name': {
      if (!c.value?.trim()) return true;
      const term = c.value.trim().toLowerCase();
      const nid  = node.id.toLowerCase();
      const nlb  = (node.label || '').toLowerCase();
      const op   = c.operator ?? 'startsWith';
      if (op === 'is')         return nid === term || nlb === term;
      if (op === 'startsWith') return nid.startsWith(term) || nlb.startsWith(term);
      return nid.includes(term) || nlb.includes(term);
    }

    case 'hasField': {
      if (!c.value?.trim()) return true;
      const term = c.value.trim().toLowerCase();
      const op   = c.operator ?? 'contains';
      return (node.fields || []).some(f => {
        const fn = (f.name  || '').toLowerCase();
        const fl = (f.label || '').toLowerCase();
        if (op === 'is')         return fn === term || fl === term;
        if (op === 'startsWith') return fn.startsWith(term) || fl.startsWith(term);
        return fn.includes(term) || fl.includes(term);
      });
    }

    case 'hasEdge':
      return !!(EDGE_SETS[c.edgeType]?.(gd)?.has(node.id));

    case 'fieldCount': {
      const fc = node.fields?.length ?? 0;
      if (c.min !== null && c.min !== '' && fc < Number(c.min)) return false;
      if (c.max !== null && c.max !== '' && fc > Number(c.max)) return false;
      return true;
    }

    case 'isCustom':
      return Settings.isCustomName(node.id);

    default:
      return true;
  }
}

// ── filterOk — evaluates AND/OR groups with standard precedence ───────────────
//
// Each condition (index ≥ 1) carries a `connector` field: 'AND' (default) or 'OR'.
// OR splits the condition list into AND-groups; a node passes if it satisfies
// ALL conditions in ANY one group.  Example:
//   A  AND  B  OR  C  AND  D  →  (A AND B) OR (C AND D)

export function filterOk(node) {
  if (!uiState.filterConditions?.length) return true;
  const conds = uiState.filterConditions;

  // Partition into OR-separated AND-groups
  const groups = [];
  let group = [conds[0]];
  for (let i = 1; i < conds.length; i++) {
    if ((conds[i].connector ?? 'AND') === 'OR') {
      groups.push(group);
      group = [];
    }
    group.push(conds[i]);
  }
  groups.push(group);

  // Pass if every condition in any one group is satisfied
  return groups.some(g => g.every(c => _evalOne(c, node)));
}

// ── Sync selectedScopes (derived) from filterConditions ───────────────────────

export function syncSelectedScopes() {
  const c = uiState.filterConditions.find(x => x.type === 'scope');
  uiState.selectedScopes = new Set(c?.values ?? []);
}

// ── Count active filters ──────────────────────────────────────────────────────

export function countActiveFilters() {
  return uiState.filterConditions.length;
}

// ── Clear all filter conditions ───────────────────────────────────────────────

export function clearAllFilters() {
  uiState.filterConditions = [];
  syncSelectedScopes();
}

// ── Scope display ─────────────────────────────────────────────────────────────
//
// Renders coloured dot + scope name + count rows into `container`.
// Rows are clickable: clicking a scope toggles a scope filter condition.
// Exposes container._rebuildScopeDisplay() for external refresh.

export function buildScopeDisplay(container, { onApply } = {}) {
  if (!container || !graphState.graphData) return;
  const nodes = graphState.graphData.nodes;
  const scopeCounts = {};
  nodes.forEach(n => { scopeCounts[n.scope] = (scopeCounts[n.scope] || 0) + 1; });

  const scopes = Object.keys(scopeCounts).sort((a, b) => {
    if (a === 'global') return -1;
    if (b === 'global') return  1;
    return a.localeCompare(b);
  });

  function _render() {
    const scopeCond   = uiState.filterConditions.find(c => c.type === 'scope');
    const activeScopes = new Set(scopeCond?.values ?? []);

    container.replaceChildren(...scopes.map(s => {
      const color    = graphState.scopeColorMap[s] ?? 'var(--edge-ref)';
      const isActive = activeScopes.has(s);
      const row = h('div', {
        class: 'scope-info-row' + (isActive ? ' active' : ''),
        title: isActive ? `Remove "${s}" scope filter` : `Filter to "${s}" only`,
        onClick: () => {
          let cond = uiState.filterConditions.find(c => c.type === 'scope');
          if (!cond) {
            cond = { id: _newId(), type: 'scope', values: [s] };
            uiState.filterConditions = [...uiState.filterConditions, cond];
          } else if (cond.values.includes(s)) {
            cond.values = cond.values.filter(v => v !== s);
            if (!cond.values.length) {
              uiState.filterConditions = uiState.filterConditions.filter(c => c.type !== 'scope');
            }
          } else {
            cond.values = [...cond.values, s];
          }
          syncSelectedScopes();
          _render();
          // Keep filter panel, badge, and bar in sync
          const filterBody = document.getElementById('filter-body');
          if (filterBody?._rebuildFilterPanel) filterBody._rebuildFilterPanel();
          const badge     = document.getElementById('filter-badge');
          const openBtn   = document.getElementById('scope-filter-btn');
          const filterBar = document.getElementById('filter-bar');
          const count     = uiState.filterConditions.length;
          if (badge)     { badge.textContent = String(count); badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
          if (openBtn)   openBtn.classList.toggle('has-filters', count > 0);
          if (filterBar && count > 0) filterBar.classList.add('open');
          _dispatchFilterChange();
          if (onApply)   onApply();
        }
      });
      const dot  = h('span', { class: 'scope-dot', style: `background:${color}` });
      const name = h('span', { class: 'scope-name', title: s }, s);
      const cnt  = h('span', { class: 'scope-count' }, String(scopeCounts[s]));
      row.append(dot, name, cnt);
      return row;
    }));
  }

  _render();
  // Expose re-render so filter panel can refresh active states when conditions change
  container._rebuildScopeDisplay = _render;
}

// ── Cross-module filter-change hook ──────────────────────────────────────────
//
// Modules that need to react to filter condition mutations (e.g. schema-diff)
// register a callback here.  _dispatchFilterChange() is called inside every
// _apply() so all consumers are notified in one place.

const _filterChangeListeners = [];
export function onFilterChange(fn) { _filterChangeListeners.push(fn); }
function _dispatchFilterChange() { _filterChangeListeners.forEach(fn => fn()); }

// ── Condition sequence counter ────────────────────────────────────────────────

let _seq = 0;
function _newId() { return 'fc_' + (++_seq); }

// ── Human-readable labels for condition types and edge types ──────────────────

const CONDITION_LABELS = {
  scope:      'Application Scope',
  tableType:  'Table Type',
  name:       'Table Name',
  hasField:   'Field Name',
  hasEdge:    'Has Edge',
  fieldCount: 'Field Count',
  isCustom:   'Is Custom',
};

const EDGE_TYPE_LABELS = {
  'ref-out':  'Reference (out)',
  'ref-in':   'Reference (in)',
  'ext-out':  'Extends (parent)',
  'ext-in':   'Extends (children)',
  'm2m':      'M2M',
  'rel':      'Relationship',
  'view':     'DB View',
  'cmdb_rel': 'CMDB CI Topology',
};

// 3-way operator cycle for Table Name and Field Name conditions
const OP_CYCLE = { startsWith: 'contains', contains: 'is', is: 'startsWith' };
const OP_LABEL = { startsWith: 'starts with', contains: 'contains', is: 'is' };

// ── Reusable autocomplete widget ─────────────────────────────────────────────
//
// _makeAutocomplete({ inputProps, getSuggestions, onInput, onPick })
//   Creates an <input> wrapped in a relative-positioned div with an absolute
//   dropdown.  Returns { wrap, input }.
//
//   getSuggestions(term) → Array<{ value, label, sub? }|string>
//   onInput(rawValue)    — called on every keystroke (caller handles debounce)
//   onPick(value)        — called when the user selects a suggestion

// Autocomplete dropdowns are portalled to <body> (position:fixed, coords from
// getBoundingClientRect) so they can never be clipped by parent overflow or
// stacking-context z-index issues in the grid/flex layout.
// _render() cleans up any portal dropdowns from the previous render before
// replacing children, so there is no leak.

function _makeAutocomplete({ inputProps = {}, getSuggestions, onInput, onPick } = {}) {
  const input = h('input', inputProps);
  const wrap  = h('div',   { class: 'fc-ac-wrap' });

  // Portal: lives on <body>, cleaned up in _render()
  const dropdown = h('div', { class: 'fc-ac-drop', style: 'display:none' });
  document.body.appendChild(dropdown);

  let _activeIdx = -1;

  function _itemValue(item) { return typeof item === 'string' ? item : item.value; }
  function _itemLabel(item) { return typeof item === 'string' ? item : item.label; }
  function _itemSub(item)   { return typeof item === 'object' ? (item.sub || '') : ''; }

  function _position() {
    const r = input.getBoundingClientRect();
    dropdown.style.top   = (r.bottom + 2) + 'px';
    dropdown.style.left  = r.left + 'px';
    dropdown.style.width = r.width + 'px';
  }

  function _update() {
    const term  = input.value.toLowerCase().trim();
    const items = getSuggestions(term);
    _activeIdx  = -1;
    if (!items.length) { dropdown.style.display = 'none'; return; }
    dropdown.replaceChildren(...items.map(item => {
      const el = h('div', { class: 'fc-ac-item' });
      el.appendChild(h('span', { class: 'fc-ac-main' }, _itemLabel(item)));
      const sub = _itemSub(item);
      if (sub) el.appendChild(h('span', { class: 'fc-ac-sub' }, sub));
      // mousedown fires before blur — preventDefault keeps input focused
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = _itemValue(item);
        dropdown.style.display = 'none';
        _activeIdx = -1;
        if (onPick)  onPick(input.value);
        if (onInput) onInput(input.value);
      });
      return el;
    }));
    _position();
    dropdown.style.display = 'block';
  }

  input.addEventListener('input',  () => { _update(); if (onInput) onInput(input.value); });
  input.addEventListener('focus',  _update);
  input.addEventListener('blur',   () => setTimeout(() => { dropdown.style.display = 'none'; _activeIdx = -1; }, 150));
  input.addEventListener('keydown', e => {
    if (dropdown.style.display === 'none') return;
    const items = dropdown.querySelectorAll('.fc-ac-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _activeIdx = Math.min(_activeIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === _activeIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _activeIdx = Math.max(_activeIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('active', i === _activeIdx));
    } else if (e.key === 'Enter' && _activeIdx >= 0) {
      e.preventDefault();
      items[_activeIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      _activeIdx = -1;
    }
  });

  wrap.append(input);
  return { wrap, input };
}

// ── Dynamic filter panel builder ─────────────────────────────────────────────
//
// buildFilterPanel(container, { onApply })
//   Renders the full dynamic filter UI into `container`.
//   Calls onApply() after every condition mutation.

export function buildFilterPanel(container, { onApply } = {}) {
  if (!container) return;

  function _apply() {
    syncSelectedScopes();
    _updateBadge();
    // Auto-open the filter bar when conditions are present
    const filterBar = document.getElementById('filter-bar');
    if (filterBar && uiState.filterConditions.length > 0) filterBar.classList.add('open');
    // Keep scope display in sync when conditions change via the filter panel
    const scopeInfoList = document.getElementById('scope-info-list');
    if (scopeInfoList?._rebuildScopeDisplay) scopeInfoList._rebuildScopeDisplay();
    _dispatchFilterChange();
    if (onApply) onApply();
  }

  function _updateBadge() {
    const badge = document.getElementById('filter-badge');
    const openBtn = document.getElementById('scope-filter-btn');
    const count = uiState.filterConditions.length;
    if (badge) {
      badge.textContent = String(count);
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    if (openBtn) openBtn.classList.toggle('has-filters', count > 0);
  }

  function _render() {
    // Remove portal autocomplete dropdowns from the previous render before
    // replacing children (they live on <body>, not inside container).
    document.querySelectorAll('.fc-ac-drop').forEach(el => el.remove());
    container.replaceChildren();
    const gd = graphState.graphData;

    // ── Condition rows — label | operator | value | × ─────────────────────────
    uiState.filterConditions.forEach((c, i) => {
      // AND / OR connector chip between rows — clickable to toggle
      if (i > 0) {
        const conn = c.connector ?? 'AND';
        const chip = h('button', {
          class: `fc-connector-chip fc-connector-${conn.toLowerCase()}`,
          title: `Click to switch to ${conn === 'AND' ? 'OR' : 'AND'}`,
          onClick: () => {
            c.connector = conn === 'AND' ? 'OR' : 'AND';
            _apply();
            _render();
          }
        }, conn);
        container.appendChild(chip);
      }

      const row       = h('div', { class: 'fc-row' });
      const labelCell = h('div', { class: 'fc-label-cell' }, CONDITION_LABELS[c.type] || c.type);
      const opCell    = h('div', { class: 'fc-op-cell' });
      const valueCell = h('div', { class: 'fc-value-cell' });
      const removeBtn = h('button', {
        class: 'fc-remove-btn', title: 'Remove condition',
        onClick: () => {
          uiState.filterConditions = uiState.filterConditions.filter(x => x.id !== c.id);
          _apply();
          _render();
        }
      }, '×');

      // ── Cascading: narrowed node set from all prior conditions ────────────────
      // When i > 0, only show values/counts for nodes that passed conditions 0..(i-1).
      // When i === 0, use all nodes (no prior constraints).
      const candidates = _nodesPassingBefore(i);

      // ── Type-specific controls ────────────────────────────────────────────────

      if (c.type === 'scope') {
        opCell.appendChild(h('span', { class: 'fc-op-text' }, 'is in'));
        // Column layout: search input on top, wrapping pills below
        valueCell.classList.add('fc-value-cell--col');
        row.classList.add('fc-row--grow');

        // Cascading: derive scope counts from candidate nodes only
        const scopeCounts = {};
        candidates.forEach(n => { scopeCounts[n.scope] = (scopeCounts[n.scope] || 0) + 1; });
        const scopes = Object.keys(scopeCounts).sort((a, b) => {
          if (a === 'global') return -1; if (b === 'global') return 1;
          return a.localeCompare(b);
        });

        const pillsEl = h('div', { class: 'fc-scope-pills' });

        // Search input — filters pills live without full re-render
        const searchInput = h('input', {
          type: 'text', class: 'fc-scope-search',
          placeholder: 'Search scopes…',
          value: c._scopeSearch || '',
          onInput: e => {
            c._scopeSearch = e.target.value;
            const term = e.target.value.toLowerCase();
            pillsEl.querySelectorAll('.fc-scope-pill').forEach(p => {
              p.style.display = (p.dataset.scope || '').toLowerCase().includes(term) ? '' : 'none';
            });
          }
        });

        const initTerm = (c._scopeSearch || '').toLowerCase();
        if (scopes.length === 0) {
          pillsEl.appendChild(h('span', { class: 'fc-hint-text' }, 'No scopes match prior conditions'));
        } else {
          scopes.forEach(s => {
            const active = c.values.includes(s);
            const color  = graphState.scopeColorMap?.[s] ?? 'var(--edge-ref)';
            const count  = scopeCounts[s] || 0;
            const pill   = h('div', {
              class: 'fc-scope-pill' + (active ? ' active' : ''),
              onClick: () => {
                if (c.values.includes(s)) c.values = c.values.filter(v => v !== s);
                else                      c.values = [...c.values, s];
                _apply();
                _render();
              }
            });
            pill.dataset.scope = s;
            if (initTerm && !s.toLowerCase().includes(initTerm)) pill.style.display = 'none';
            const dot = h('span', { class: 'scope-dot', style: `background:${color}` });
            pill.append(dot, document.createTextNode(s));
            // Show cascaded count next to scope name
            if (i > 0) {
              pill.appendChild(h('span', { class: 'fc-pill-count' }, String(count)));
            }
            pillsEl.appendChild(pill);
          });
        }
        valueCell.append(searchInput, pillsEl);

      } else if (c.type === 'tableType') {
        opCell.appendChild(h('span', { class: 'fc-op-text' }, 'is'));
        const pills = h('div', { class: 'fc-pills' });
        // Cascading: compute counts for each type from candidates
        const regularCount = candidates.filter(n => !n._isView).length;
        const viewsCount   = candidates.filter(n => !!n._isView).length;
        const customCount  = candidates.filter(n => Settings.isCustomName(n.id)).length;
        const TYPES = [
          { value: 'regular', label: 'Regular',  count: regularCount },
          { value: 'views',   label: 'DB Views', count: viewsCount   },
          { value: 'custom',  label: 'Custom',   count: customCount  },
        ];
        TYPES.forEach(t => {
          const label = i > 0 ? `${t.label} (${t.count})` : t.label;
          const pill = h('button', {
            class: 'fc-pill' + (c.value === t.value ? ' active' : ''),
            disabled: i > 0 && t.count === 0,
            onClick: () => { c.value = t.value; _apply(); _render(); }
          }, label);
          pills.appendChild(pill);
        });
        valueCell.appendChild(pills);

      } else if (c.type === 'name') {
        // Operator toggle — cycles: starts with → contains → is → starts with
        const opBtn = h('button', {
          class: 'fc-op-toggle', title: 'Click to cycle operator',
          onClick: () => {
            c.operator = OP_CYCLE[c.operator ?? 'startsWith'];
            _apply(); _render();
          }
        }, OP_LABEL[c.operator ?? 'startsWith']);
        opCell.appendChild(opBtn);

        // Autocomplete — table names/labels from cascaded candidates
        const nameGetSuggestions = term => {
          const op = c.operator ?? 'startsWith';
          const pool = term
            ? candidates.filter(n => {
                const id = n.id.toLowerCase();
                const lb = (n.label || '').toLowerCase();
                return op === 'contains'
                  ? id.includes(term) || lb.includes(term)
                  : id.startsWith(term) || lb.startsWith(term);
              })
            : candidates.slice(0, 12);
          return pool.slice(0, 12).map(n => ({
            value: n.id,
            label: n.id,
            sub:   n.label && n.label !== n.id ? n.label : '',
          }));
        };
        let _nameTimer = null;
        const { wrap: nameWrap } = _makeAutocomplete({
          inputProps: {
            type: 'text', class: 'fc-text-input',
            placeholder: 'table name or label…',
            value: c.value || '',
          },
          getSuggestions: nameGetSuggestions,
          onInput: val => {
            clearTimeout(_nameTimer);
            _nameTimer = setTimeout(() => { c.value = val; _apply(); }, 250);
          },
          onPick: val => { c.value = val; _apply(); },
        });
        valueCell.appendChild(nameWrap);

      } else if (c.type === 'hasField') {
        // Operator toggle — cycles: contains → is → starts with → contains
        const hfOpBtn = h('button', {
          class: 'fc-op-toggle', title: 'Click to cycle operator',
          onClick: () => {
            c.operator = OP_CYCLE[c.operator ?? 'contains'];
            _apply(); _render();
          }
        }, OP_LABEL[c.operator ?? 'contains']);
        opCell.appendChild(hfOpBtn);

        // Count hint
        const hfCountHint = h('span', { class: 'fc-count-hint' },
          c.value?.trim()
            ? candidates.filter(n => _evalOne(c, n)).length + ' tables'
            : candidates.length + ' total'
        );

        // Autocomplete — unique field names across candidate nodes
        const fieldGetSuggestions = term => {
          if (!term) return [];
          const op   = c.operator ?? 'contains';
          const seen = new Set();
          const out  = [];
          for (const n of candidates) {
            for (const f of (n.fields || [])) {
              const fn = (f.name  || '').toLowerCase();
              const fl = (f.label || '').toLowerCase();
              const ok = op === 'contains'
                ? fn.includes(term) || fl.includes(term)
                : fn.startsWith(term) || fl.startsWith(term);
              if (ok && !seen.has(f.name)) {
                seen.add(f.name);
                out.push({
                  value: f.name,
                  label: f.name,
                  sub:   f.label && f.label !== f.name ? f.label : '',
                });
                if (out.length >= 12) return out;
              }
            }
          }
          return out;
        };

        let _hfTimer = null;
        function _updateHfHint(val) {
          const term = val.trim().toLowerCase();
          const op   = c.operator ?? 'contains';
          hfCountHint.textContent = term
            ? candidates.filter(n =>
                (n.fields || []).some(f => {
                  const fn = (f.name  || '').toLowerCase();
                  const fl = (f.label || '').toLowerCase();
                  if (op === 'is')       return fn === term || fl === term;
                  if (op === 'contains') return fn.includes(term) || fl.includes(term);
                  return fn.startsWith(term) || fl.startsWith(term);
                })
              ).length + ' tables'
            : candidates.length + ' total';
        }
        _updateHfHint(c.value || '');

        const { wrap: hfWrap } = _makeAutocomplete({
          inputProps: {
            type: 'text', class: 'fc-text-input',
            placeholder: 'field name or label…',
            value: c.value || '',
          },
          getSuggestions: fieldGetSuggestions,
          onInput: val => {
            _updateHfHint(val);
            clearTimeout(_hfTimer);
            _hfTimer = setTimeout(() => { c.value = val; _apply(); }, 250);
          },
          onPick: val => { c.value = val; _updateHfHint(val); _apply(); },
        });
        const hfRow = h('div', { class: 'fc-input-hint-row' });
        hfRow.append(hfWrap, hfCountHint);
        valueCell.appendChild(hfRow);

      } else if (c.type === 'hasEdge') {
        opCell.appendChild(h('span', { class: 'fc-op-text' }, 'of type'));
        const sel = h('select', { class: 'fc-select',
          onChange: e => { c.edgeType = e.target.value; _apply(); }
        });
        // Cascading: only offer edge types that exist in at least one candidate node
        let currentEdgeStillAvailable = false;
        Object.entries(EDGE_TYPE_LABELS).forEach(([val, lbl]) => {
          if (i > 0) {
            const edgeSet = EDGE_SETS[val]?.(gd);
            if (!edgeSet || !candidates.some(n => edgeSet.has(n.id))) return;
          }
          const opt = h('option', { value: val }, lbl);
          if (val === c.edgeType) { opt.selected = true; currentEdgeStillAvailable = true; }
          sel.appendChild(opt);
        });
        // If the previously-selected edge type was filtered out, reset to first available
        if (!currentEdgeStillAvailable && sel.options.length > 0) {
          c.edgeType = sel.options[0].value;
          sel.options[0].selected = true;
        }
        valueCell.appendChild(sel);

      } else if (c.type === 'fieldCount') {
        opCell.appendChild(h('span', { class: 'fc-op-text' }, 'between'));
        let _fcTimer = null;
        const fireChange = () => { clearTimeout(_fcTimer); _fcTimer = setTimeout(() => _apply(), 250); };
        // Cascading: derive placeholder hints from candidate field-count range
        let minHint = 'min', maxHint = 'max';
        if (i > 0 && candidates.length > 0) {
          const counts = candidates.map(n => n.fields?.length ?? 0);
          minHint = String(Math.min(...counts));
          maxHint = String(Math.max(...counts));
        }
        const minInput = h('input', {
          type: 'number', class: 'fc-num', placeholder: minHint,
          value: c.min ?? '',
          onInput: e => { c.min = e.target.value === '' ? null : Number(e.target.value); fireChange(); }
        });
        const maxInput = h('input', {
          type: 'number', class: 'fc-num', placeholder: maxHint,
          value: c.max ?? '',
          onInput: e => { c.max = e.target.value === '' ? null : Number(e.target.value); fireChange(); }
        });
        valueCell.append(minInput, h('span', { class: 'fc-range-sep' }, '—'), maxInput);

      } else if (c.type === 'isCustom') {
        opCell.appendChild(h('span', { class: 'fc-op-text' }, '—'));
        const count = candidates.filter(n => Settings.isCustomName(n.id)).length;
        const label = i > 0
          ? `Custom tables only (${count} in current set)`
          : 'Custom tables only (uses configured prefix list)';
        valueCell.appendChild(h('span', { class: 'fc-op-text' }, label));

      }

      row.append(labelCell, opCell, valueCell, removeBtn);
      container.appendChild(row);
    });

    // ── Footer: + Add condition  |  Clear all ─────────────────────────────────
    const actionsRow = h('div', { class: 'fc-bar-actions' });

    // Singleton types may only appear once; multi-instance types (name, hasField,
    // hasEdge) can be added repeatedly so the user can combine them with OR logic.
    const SINGLETON_TYPES = new Set(['scope', 'tableType', 'fieldCount', 'isCustom']);
    const usedSingletons  = new Set(
      uiState.filterConditions.filter(c => SINGLETON_TYPES.has(c.type)).map(c => c.type)
    );
    const availableTypes = Object.keys(CONDITION_LABELS).filter(t => !usedSingletons.has(t));

    if (availableTypes.length > 0) {
      const addBtn = h('button', {
        class: 'fc-add-btn',
        onClick: () => {
          pickerEl.style.display = pickerEl.style.display === 'none' ? 'block' : 'none';
        }
      }, '+ Add condition');

      const pickerEl = h('div', { class: 'fc-picker', style: 'display:none' });
      availableTypes.forEach(t => {
        const item = h('div', {
          class: 'fc-picker-item',
          onClick: () => {
            const defaults = {
              scope:      { id: _newId(), type: 'scope',      connector: 'AND', values: [] },
              tableType:  { id: _newId(), type: 'tableType',  connector: 'AND', value: 'regular' },
              name:       { id: _newId(), type: 'name',       connector: 'AND', operator: 'startsWith', value: '' },
              hasField:   { id: _newId(), type: 'hasField',   connector: 'AND', operator: 'contains', value: '' },
              hasEdge:    { id: _newId(), type: 'hasEdge',    connector: 'AND', edgeType: 'ref-out' },
              fieldCount: { id: _newId(), type: 'fieldCount', connector: 'AND', min: null, max: null },
              isCustom:   { id: _newId(), type: 'isCustom',   connector: 'AND' },
            };
            uiState.filterConditions = [...uiState.filterConditions, defaults[t]];
            _apply();
            _render();
          }
        }, CONDITION_LABELS[t]);
        pickerEl.appendChild(item);
      });

      const addWrap = h('div', { class: 'fc-add-wrap' });
      addWrap.append(addBtn, pickerEl);
      actionsRow.appendChild(addWrap);
    }

    if (uiState.filterConditions.length > 0) {
      actionsRow.appendChild(h('button', {
        class: 'fc-clear-btn',
        onClick: () => { clearAllFilters(); _apply(); _render(); }
      }, 'Clear all'));
    }

    container.appendChild(actionsRow);
    _updateBadge();
  }

  // Initial render
  _render();

  // Expose re-render for external callers (e.g. after restoreState)
  container._rebuildFilterPanel = _render;
}

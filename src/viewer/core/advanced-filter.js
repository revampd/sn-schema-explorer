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

// ── filterOk — single predicate replacing scopeOk everywhere ─────────────────
//
// Returns true when a node passes ALL active filter conditions.
// Empty filterConditions → every node passes (fast path).

export function filterOk(node) {
  if (!uiState.filterConditions?.length) return true;
  const gd = graphState.graphData;
  return uiState.filterConditions.every(c => {
    switch (c.type) {
      case 'scope':
        return !c.values?.length || c.values.includes(node.scope);

      case 'tableType':
        if (c.value === 'regular') return !node._isView && !(gd?._cmdbCiIds?.has(node.id));
        if (c.value === 'views')   return !!node._isView;
        if (c.value === 'cmdb')    return !!(gd?._cmdbCiIds?.has(node.id));
        return true;

      case 'name': {
        if (!c.value?.trim()) return true;
        const parts = c.value.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
        if (!parts.length) return true;
        const nid = node.id.toLowerCase();
        const nlb = (node.label || '').toLowerCase();
        return c.operator === 'contains'
          ? parts.some(p => nid.includes(p) || nlb.includes(p))
          : parts.some(p => nid.startsWith(p));
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
  });
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

// ── Read-only scope display ───────────────────────────────────────────────────
//
// Renders coloured dot + scope name + count rows into `container`.
// Pure DOM write — no event wiring.

export function buildScopeDisplay(container) {
  if (!container || !graphState.graphData) return;
  const nodes = graphState.graphData.nodes;
  const scopeCounts = {};
  nodes.forEach(n => { scopeCounts[n.scope] = (scopeCounts[n.scope] || 0) + 1; });

  const scopes = Object.keys(scopeCounts).sort((a, b) => {
    if (a === 'global') return -1;
    if (b === 'global') return  1;
    return a.localeCompare(b);
  });

  container.replaceChildren(...scopes.map(s => {
    const color = graphState.scopeColorMap[s] ?? 'var(--edge-ref)';
    const row = h('div', { class: 'scope-info-row' });
    const dot = h('span', { class: 'scope-dot', style: `background:${color}` });
    const name = h('span', { class: 'scope-name', title: s }, s);
    const cnt = h('span', { class: 'scope-count' }, String(scopeCounts[s]));
    row.append(dot, name, cnt);
    return row;
  }));
}

// ── Condition sequence counter ────────────────────────────────────────────────

let _seq = 0;
function _newId() { return 'fc_' + (++_seq); }

// ── Human-readable labels for condition types and edge types ──────────────────

const CONDITION_LABELS = {
  scope:      'Application Scope',
  tableType:  'Table Type',
  name:       'Name',
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
    if (onApply) onApply();
  }

  function _updateBadge() {
    const badge = document.getElementById('filter-badge');
    if (!badge) return;
    const count = uiState.filterConditions.length;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function _render() {
    container.replaceChildren();
    const gd = graphState.graphData;

    // ── Condition rows ────────────────────────────────────────────────────────
    for (const c of uiState.filterConditions) {
      const row = h('div', { class: 'fc-row' });

      // Remove button
      const removeBtn = h('button', {
        class: 'fc-remove-btn', title: 'Remove filter',
        onClick: () => {
          uiState.filterConditions = uiState.filterConditions.filter(x => x.id !== c.id);
          _apply();
          _render();
        }
      }, '×');

      // Condition content
      const content = h('div', { class: 'fc-content' });
      const typeLabel = h('div', { class: 'fc-type-label' }, CONDITION_LABELS[c.type] || c.type);
      content.appendChild(typeLabel);

      // ── Type-specific controls ──────────────────────────────────────────────

      if (c.type === 'scope') {
        // Scope pill multi-select
        const nodes = gd?.nodes || [];
        const scopeCounts = {};
        nodes.forEach(n => { scopeCounts[n.scope] = (scopeCounts[n.scope] || 0) + 1; });
        const scopes = Object.keys(scopeCounts).sort((a, b) => {
          if (a === 'global') return -1; if (b === 'global') return 1;
          return a.localeCompare(b);
        });
        const pills = h('div', { class: 'fc-scope-pills' });
        scopes.forEach(s => {
          const active = c.values.includes(s);
          const color  = graphState.scopeColorMap?.[s] ?? 'var(--edge-ref)';
          const pill   = h('div', {
            class: 'fc-scope-pill' + (active ? ' active' : ''),
            onClick: () => {
              if (c.values.includes(s)) c.values = c.values.filter(v => v !== s);
              else                      c.values = [...c.values, s];
              _apply();
              _render();
            }
          });
          const dot = h('span', { class: 'scope-dot', style: `background:${color}` });
          pill.append(dot, document.createTextNode(s));
          pills.appendChild(pill);
        });
        content.appendChild(pills);

      } else if (c.type === 'tableType') {
        const pills = h('div', { class: 'fc-pills' });
        const TYPES = [
          { value: 'regular', label: 'Regular' },
          { value: 'views',   label: 'DB Views' },
          { value: 'cmdb',    label: 'CMDB CI', disabled: !gd?._cmdbCiIds?.size },
        ];
        TYPES.forEach(t => {
          const pill = h('button', {
            class: 'fc-pill' + (c.value === t.value ? ' active' : ''),
            onClick: () => {
              c.value = t.value;
              _apply();
              _render();
            }
          }, t.label);
          if (t.disabled) pill.disabled = true;
          pills.appendChild(pill);
        });
        content.appendChild(pills);

      } else if (c.type === 'name') {
        const nameRow = h('div', { class: 'fc-name-row' });
        const opBtn = h('button', {
          class: 'fc-op-toggle',
          title: 'Toggle operator',
          onClick: () => {
            c.operator = c.operator === 'startsWith' ? 'contains' : 'startsWith';
            _apply();
            _render();
          }
        }, c.operator === 'startsWith' ? 'Starts with' : 'Contains');
        let _nameTimer = null;
        const input = h('input', {
          type: 'text', class: 'fc-text-input',
          placeholder: 'comma-separated values…',
          value: c.value || '',
          onInput: e => {
            clearTimeout(_nameTimer);
            _nameTimer = setTimeout(() => {
              c.value = e.target.value;
              _apply();
            }, 250);
          }
        });
        nameRow.append(opBtn, input);
        content.appendChild(nameRow);

      } else if (c.type === 'hasEdge') {
        const sel = h('select', { class: 'fc-select',
          onChange: e => {
            c.edgeType = e.target.value;
            _apply();
          }
        });
        Object.entries(EDGE_TYPE_LABELS).forEach(([val, lbl]) => {
          const opt = h('option', { value: val }, lbl);
          if (val === c.edgeType) opt.selected = true;
          sel.appendChild(opt);
        });
        content.appendChild(sel);

      } else if (c.type === 'fieldCount') {
        const rangeRow = h('div', { class: 'fc-range' });
        let _fcTimer = null;
        const fireChange = () => {
          clearTimeout(_fcTimer);
          _fcTimer = setTimeout(() => _apply(), 250);
        };
        const minInput = h('input', {
          type: 'number', class: 'fc-num', placeholder: 'min',
          value: c.min ?? '',
          onInput: e => { c.min = e.target.value === '' ? null : Number(e.target.value); fireChange(); }
        });
        const sep = document.createTextNode('–');
        const maxInput = h('input', {
          type: 'number', class: 'fc-num', placeholder: 'max',
          value: c.max ?? '',
          onInput: e => { c.max = e.target.value === '' ? null : Number(e.target.value); fireChange(); }
        });
        rangeRow.append(minInput, sep, maxInput);
        content.appendChild(rangeRow);

      } else if (c.type === 'isCustom') {
        content.appendChild(h('div', { class: 'fc-type-label', style: 'margin-top:2px' },
          'Custom tables only (uses configured prefix list)'));
      }

      row.append(removeBtn, content);
      container.appendChild(row);
    }

    // ── Picker / Add filter ───────────────────────────────────────────────────
    const usedTypes = new Set(uiState.filterConditions.map(c => c.type));
    const availableTypes = Object.keys(CONDITION_LABELS).filter(t => !usedTypes.has(t));

    if (availableTypes.length > 0) {
      let pickerOpen = false;

      const addBtn = h('button', {
        class: 'fc-add-btn',
        onClick: () => {
          pickerOpen = !pickerOpen;
          if (pickerEl.style.display === 'none') {
            pickerEl.style.display = 'block';
          } else {
            pickerEl.style.display = 'none';
          }
        }
      }, '+ Add filter');

      const pickerEl = h('div', { class: 'fc-picker', style: 'display:none' });
      availableTypes.forEach(t => {
        const item = h('div', { class: 'fc-picker-item',
          onClick: () => {
            const defaults = {
              scope:      { id: _newId(), type: 'scope', values: [] },
              tableType:  { id: _newId(), type: 'tableType', value: 'regular' },
              name:       { id: _newId(), type: 'name', operator: 'startsWith', value: '' },
              hasEdge:    { id: _newId(), type: 'hasEdge', edgeType: 'ref-out' },
              fieldCount: { id: _newId(), type: 'fieldCount', min: null, max: null },
              isCustom:   { id: _newId(), type: 'isCustom' },
            };
            uiState.filterConditions = [...uiState.filterConditions, defaults[t]];
            _apply();
            _render();
          }
        }, CONDITION_LABELS[t]);
        pickerEl.appendChild(item);
      });

      container.append(addBtn, pickerEl);
    }

    // ── Clear all ─────────────────────────────────────────────────────────────
    if (uiState.filterConditions.length > 0) {
      const clearBtn = h('button', {
        class: 'fc-clear-btn',
        onClick: () => {
          clearAllFilters();
          _apply();
          _render();
        }
      }, 'Clear all');
      container.appendChild(clearBtn);
    }

    _updateBadge();
  }

  // Initial render
  _render();

  // Expose re-render for external callers (e.g. after restoreState)
  container._rebuildFilterPanel = _render;
}

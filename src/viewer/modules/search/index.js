import { graphState, uiState } from '../../core/state.js';
import { filterOk } from '../../core/advanced-filter.js';
import { Dom } from '../../core/dom.js';
import { tlSetSpacerHeight, tlRenderVisible, setTableData, getTableDataAll, setHintMode } from '../../shared/table-list.js';
import { root } from '../../engine/canvas.js';
import { updateMinimap } from '../graph-view/minimap.js';

let _fieldSearchIndex = new Map();
let _nodeById = new Map();

export function setSearchData(nodeById, fieldSearchIndex) {
  _nodeById = nodeById;
  _fieldSearchIndex = fieldSearchIndex;
}

let _searchMode = 'tables';
const _searchChangeListeners = [];
export function onSearchChange(fn) { _searchChangeListeners.push(fn); }
export function getSearchMode()    { return _searchMode; }

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function fieldSearchMatches(q) {
  if (!q) return null;
  const hits = new Set();
  for (const [name, tables] of _fieldSearchIndex) {
    if (name.includes(q)) {
      for (const t of tables) hits.add(t);
    }
  }
  return hits;
}

function fieldsMatchingInTable(tableId, q, limit = 3) {
  if (!q) return { shown: [], extra: 0 };
  const node = _nodeById ? _nodeById.get(tableId) : null;
  if (!node || !Array.isArray(node.fields)) return { shown: [], extra: 0 };
  const shown = [];
  let extra = 0;
  for (const f of node.fields) {
    const lname = String(f.name || '').toLowerCase();
    if (!lname.includes(q)) continue;
    if (shown.length < limit) shown.push(f.name);
    else extra++;
  }
  return { shown, extra };
}

const _debouncedGraphDim = debounce(q => {
  if (!root) return;
  if (q.length > 1) {
    if (_searchMode === 'fields') {
      const hits = fieldSearchMatches(q) || new Set();
      root.selectAll('g.node-group').classed('dimmed', d => !hits.has(d.id));
      root.selectAll('g.domain-node').classed('dimmed', d => !hits.has(d.id));
    } else {
      root.selectAll('g.node-group').classed('dimmed', d =>
        !d.id.toLowerCase().includes(q) && !(d.label||'').toLowerCase().includes(q)
      );
      root.selectAll('g.domain-node').classed('dimmed', d =>
        !d.id.toLowerCase().includes(q) && !(d.label||'').toLowerCase().includes(q)
      );
    }
  } else {
    root.selectAll('g.node-group').classed('dimmed', false);
    root.selectAll('g.domain-node').classed('dimmed', false);
  }
  updateMinimap();
}, 120);

export function applyTableFilter(q) {
  if (!graphState.graphData) return;
  const queryRaw = q ?? Dom.searchBox.value.toLowerCase().trim();
  let hits = null;
  if (_searchMode === 'fields' && queryRaw) hits = fieldSearchMatches(queryRaw);

  const tableDataAll = getTableDataAll();
  const filtered = tableDataAll.filter(n => {
    if (!filterOk(n)) return false;
    if (!queryRaw) return true;
    if (_searchMode === 'fields') return !!(hits && hits.has(n.id));
    return n.id.includes(queryRaw) || (n.label||'').toLowerCase().includes(queryRaw);
  });

  if (_searchMode === 'fields' && queryRaw) {
    for (const n of filtered) {
      const { shown, extra } = fieldsMatchingInTable(n.id, queryRaw);
      n._fieldHints = shown.length
        ? shown.join(', ') + (extra > 0 ? ` +${extra} more` : '')
        : '';
    }
  } else {
    for (const n of tableDataAll) {
      if (n._fieldHints !== undefined) n._fieldHints = '';
    }
  }

  setTableData(filtered);
  tlSetSpacerHeight();
  Dom.tableList.scrollTop = 0;
  tlRenderVisible();
  setHintMode(_searchMode === 'fields' && !!queryRaw);
}

export function initSearchListeners() {
  Dom.searchBox.addEventListener('input', () => {
    if (!graphState.graphData) return;
    const q = Dom.searchBox.value.toLowerCase().trim();
    applyTableFilter(q);
    _debouncedGraphDim(q);
    _searchChangeListeners.forEach(fn => fn(q, _searchMode));
  });

  document.querySelectorAll('#search-mode-seg .smt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.sm;
      if (mode !== 'tables' && mode !== 'fields') return;
      _searchMode = mode;
      document.querySelectorAll('#search-mode-seg .smt-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sm === mode);
      });
      Dom.searchBox.placeholder = mode === 'fields' ? 'search fields…' : 'search tables…';
      Dom.searchBox.dispatchEvent(new Event('input'));
    });
  });
}

import { graphState, uiState, nodeColor } from './state.js';
import { Dom } from './dom.js';
import { h } from './template.js';
import { Settings } from '../modules/settings/index.js';

const TL_ROW_HEIGHT =
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 42 : 36;
const TL_ROW_HEIGHT_HINT =
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 58 : 50;
const TL_OVERSCAN = 6;
let _tableData = [];
let _tableDataAll = [];
let _tableScrollRAF = 0;
let _hintMode = false;

function _rowH() {
  return _hintMode ? TL_ROW_HEIGHT_HINT : TL_ROW_HEIGHT;
}

export function buildTableList() {
  if (!graphState.graphData) return;
  const cnt = graphState.graphData._edgeCnt || {};
  _tableDataAll = [...graphState.graphData.nodes].sort((a, b) => {
    if (uiState.sortMode === 'name-asc') return a.id.localeCompare(b.id);
    if (uiState.sortMode === 'name-desc') return b.id.localeCompare(a.id);
    if (uiState.sortMode === 'edge-desc') return (cnt[b.id] || 0) - (cnt[a.id] || 0);
    if (uiState.sortMode === 'edge-asc') return (cnt[a.id] || 0) - (cnt[b.id] || 0);
    return a.id.localeCompare(b.id);
  });
  _tableData = _tableDataAll;
  tlSetSpacerHeight();
  tlRenderVisible();
}

export function tlSetSpacerHeight() {
  const spacer = document.getElementById('table-list-spacer');
  if (!spacer) return;
  spacer.style.height = _tableData.length * _rowH() + 'px';
}

export function tlRenderVisible() {
  const list = Dom.tableList;
  const viewport = document.getElementById('table-list-viewport');
  if (!list || !viewport) return;
  const cnt = (graphState.graphData && graphState.graphData._edgeCnt) || {};
  const scrollTop = list.scrollTop;
  const clientH = list.clientHeight;

  const firstIdx = Math.max(0, Math.floor(scrollTop / _rowH()) - TL_OVERSCAN);
  const lastIdx = Math.min(
    _tableData.length,
    Math.ceil((scrollTop + clientH) / _rowH()) + TL_OVERSCAN
  );

  const frag = document.createDocumentFragment();
  for (let i = firstIdx; i < lastIdx; i++) {
    const n = _tableData[i];
    if (!n) continue;
    const hint = n._fieldHints || '';
    frag.appendChild(
      h(
        'div',
        {
          class: 'table-item' + (uiState.selectedNode === n.id ? ' selected' : ''),
          dataId: n.id,
          dataLabel: n.label.toLowerCase(),
        },
        h('div', { class: 'ti-dot', style: { background: nodeColor(n) } }),
        h(
          'div',
          { class: 'ti-names' },
          h(
            'div',
            { class: 'ti-name', title: n.label },
            n.label,
            Settings.isEnabled('customHighlight') && Settings.isCustomName(n.id)
              ? h('span', { class: 'ti-custom-badge' }, 'custom')
              : null
          ),
          h('div', { class: 'ti-id' }, n.id),
          h('div', { class: 'ti-fields', style: { display: hint ? '' : 'none' } }, hint)
        ),
        h('div', { class: 'ti-count' }, String(cnt[n.id] || 0))
      )
    );
  }
  viewport.style.transform = `translateY(${firstIdx * _rowH()}px)`;
  viewport.replaceChildren(frag);
}

export function tlOnScroll() {
  if (_tableScrollRAF) return;
  _tableScrollRAF = requestAnimationFrame(() => {
    _tableScrollRAF = 0;
    tlRenderVisible();
  });
}

export function highlightListItem(id) {
  document.querySelectorAll('#table-list-viewport .table-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  if (id != null) {
    const idx = _tableData.findIndex(n => n.id === id);
    if (idx >= 0 && Dom.tableList) {
      const target = idx * _rowH();
      const top = Dom.tableList.scrollTop;
      const bottom = top + Dom.tableList.clientHeight;
      if (target < top || target > bottom - _rowH()) {
        Dom.tableList.scrollTop = Math.max(0, target - Dom.tableList.clientHeight / 2);
      }
    }
  }
  document.querySelectorAll('#diff-list .diff-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
    if (el.dataset.id === id) el.scrollIntoView({ block: 'nearest' });
  });
}

export function getTableDataAll() {
  return _tableDataAll;
}
export function setTableData(arr) {
  _tableData = arr;
}

export function setHintMode(active) {
  if (_hintMode === !!active) return;
  _hintMode = !!active;
  tlSetSpacerHeight();
  Dom.tableList.scrollTop = 0;
  tlRenderVisible();
}

export { TL_ROW_HEIGHT };

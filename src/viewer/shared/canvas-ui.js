import { graphState, uiState } from '../core/state.js';
import { Dom } from '../core/dom.js';
import { svg, zoom, closePanel } from '../engine/canvas.js';
import { tlSetSpacerHeight, tlRenderVisible, buildTableList, tlOnScroll } from './table-list.js';
import { clearSelection, focusTable } from './inspector.js';
import { isMobile } from '../modules/settings/index.js';
import { fitGraph } from '../modules/export/index.js';

export function initCanvasUI() {
  // ── Panel collapse / expand ───────────────────────────────────────────────

  Dom.btnSidebarCollapse.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    if (!document.body.classList.contains('sidebar-collapsed')) {
      requestAnimationFrame(() => {
        tlSetSpacerHeight();
        tlRenderVisible();
      });
    }
  });
  Dom.btnInspectorCollapse.addEventListener('click', () => {
    document.body.classList.toggle('inspector-collapsed');
  });
  document.querySelector('aside .panel-title').addEventListener('click', function(e) {
    if (document.body.classList.contains('sidebar-collapsed') && !e.target.closest('button')) {
      document.body.classList.remove('sidebar-collapsed');
      requestAnimationFrame(() => {
        tlSetSpacerHeight();
        tlRenderVisible();
      });
    }
  });
  document.querySelector('#inspector .panel-title').addEventListener('click', function(e) {
    if (document.body.classList.contains('inspector-collapsed') && !e.target.closest('button')) {
      document.body.classList.remove('inspector-collapsed');
    }
  });

  // ── Resize handles (left sidebar + right inspector, persisted to localStorage) ──

  (function wireResizeHandles() {
    const SIDEBAR_MIN = 180, SIDEBAR_MAX_PCT  = 0.45;
    const INSPECT_MIN = 220, INSPECT_MAX_PCT  = 0.45;
    const STORAGE_KEY = 'snse:panelWidths:v1';

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const winW = window.innerWidth || 1600;
      if (typeof saved.sidebar === 'number') {
        const w = clamp(saved.sidebar, SIDEBAR_MIN, winW * SIDEBAR_MAX_PCT);
        document.documentElement.style.setProperty('--sidebar-w', w + 'px');
      }
      if (typeof saved.inspector === 'number') {
        const w = clamp(saved.inspector, INSPECT_MIN, winW * INSPECT_MAX_PCT);
        document.documentElement.style.setProperty('--inspector-w', w + 'px');
      }
    } catch (e) {}

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function saveWidths() {
      const sidebarPx   = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'));
      const inspectorPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inspector-w'));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          sidebar:   Math.round(sidebarPx),
          inspector: Math.round(inspectorPx)
        }));
      } catch (e) { console.warn('canvas-ui: localStorage write failed', e); }
    }

    function startDrag(handle, side) {
      handle.addEventListener('pointerdown', e => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('dragging');
        document.body.classList.add('resizing');

        const startX = e.clientX;
        const startW = parseFloat(getComputedStyle(document.documentElement)
          .getPropertyValue(side === 'sidebar' ? '--sidebar-w' : '--inspector-w'));

        const onMove = ev => {
          const winW = window.innerWidth || 1600;
          const dx   = ev.clientX - startX;
          let next;
          if (side === 'sidebar') {
            next = clamp(startW + dx, SIDEBAR_MIN, winW * SIDEBAR_MAX_PCT);
            document.documentElement.style.setProperty('--sidebar-w', next + 'px');
          } else {
            next = clamp(startW - dx, INSPECT_MIN, winW * INSPECT_MAX_PCT);
            document.documentElement.style.setProperty('--inspector-w', next + 'px');
          }
        };
        const onUp = () => {
          handle.releasePointerCapture(e.pointerId);
          handle.classList.remove('dragging');
          document.body.classList.remove('resizing');
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup',   onUp);
          handle.removeEventListener('pointercancel', onUp);
          saveWidths();
          requestAnimationFrame(() => {
            tlSetSpacerHeight();
            tlRenderVisible();
          });
          if (graphState.graphData) fitGraph();
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup',   onUp);
        handle.addEventListener('pointercancel', onUp);
      });

      handle.addEventListener('dblclick', () => {
        document.documentElement.style.removeProperty(
          side === 'sidebar' ? '--sidebar-w' : '--inspector-w'
        );
        try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
        requestAnimationFrame(saveWidths);
        if (graphState.graphData) fitGraph();
      });
    }

    const sbHandle  = document.getElementById('sidebar-resize');
    const insHandle = document.getElementById('inspector-resize');
    if (sbHandle)  startDrag(sbHandle,  'sidebar');
    if (insHandle) startDrag(insHandle, 'inspector');
  })();

  // ── Zoom + fit buttons ────────────────────────────────────────────────────

  Dom.btnReset.addEventListener('click', fitGraph);
  Dom.btnFitM.addEventListener('click', fitGraph);
  Dom.zIn.addEventListener('click',  () => svg.transition().call(zoom.scaleBy, 1.4));
  Dom.zOut.addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.7));
  Dom.zFit.addEventListener('click', fitGraph);

  // ── Window resize (debounced) ─────────────────────────────────────────────

  let rTimer;
  window.addEventListener('resize', () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => { if (graphState.graphData) fitGraph(); }, 200);
    if (graphState.graphData) tlRenderVisible();
  });

  // ── Sidebar table list ────────────────────────────────────────────────────

  Dom.tableList.addEventListener('click', e => {
    const item = e.target.closest('.table-item');
    if (!item || !Dom.tableList.contains(item)) return;
    const id = item.dataset.id;
    if (!id) return;
    if (id === uiState.selectedNode) clearSelection();
    else focusTable(id, false);
    if (isMobile()) closePanel('sidebar');
  });

  Dom.tableList.addEventListener('scroll', tlOnScroll, { passive: true });

  Dom.inspectorContent.addEventListener('click', e => {
    // Edge-list navigation (table links, source badges)
    const item = e.target.closest('.edge-list-item[data-table]');
    if (item && Dom.inspectorContent.contains(item)) {
      focusTable(item.dataset.table);
      if (isMobile()) closePanel('inspector');
      return;
    }
    // Field row: copy technical name to clipboard
    const fieldRow = e.target.closest('.insp-field-row[data-field]');
    if (fieldRow && Dom.inspectorContent.contains(fieldRow)) {
      if (e.target.closest('.insp-field-pflink, .edge-list-item')) return;
      const fieldName = fieldRow.dataset.field;
      navigator.clipboard.writeText(fieldName).catch(() => {});
      showCopyToast(fieldName);
    }
  });

  // ── Sort buttons ──────────────────────────────────────────────────────────

  (function wireSortButtons() {
    const btnName = Dom.sortBtnName;
    const btnEdge = Dom.sortBtnEdge;
    if (!btnName || !btnEdge) return;

    function applySort() {
      buildTableList();
      Dom.searchBox.dispatchEvent(new Event('input'));
    }

    function setActive(activeBtn, otherBtn) {
      activeBtn.classList.add('active');
      otherBtn.classList.remove('active');
      otherBtn.textContent = otherBtn.dataset.label;
    }

    btnName.dataset.label = 'Name';
    btnEdge.dataset.label = 'Edges';
    btnName.textContent = 'Name ↑';

    btnName.addEventListener('click', () => {
      if (uiState.sortMode === 'name-asc') {
        uiState.sortMode = 'name-desc';
        btnName.textContent = 'Name ↓';
      } else {
        uiState.sortMode = 'name-asc';
        btnName.textContent = 'Name ↑';
      }
      setActive(btnName, btnEdge);
      applySort();
    });

    btnEdge.addEventListener('click', () => {
      if (uiState.sortMode === 'edge-desc') {
        uiState.sortMode = 'edge-asc';
        btnEdge.textContent = 'Edges ↑';
      } else {
        uiState.sortMode = 'edge-desc';
        btnEdge.textContent = 'Edges ↓';
      }
      setActive(btnEdge, btnName);
      applySort();
    });
  })();
}

// ── Copy-field toast ──────────────────────────────────────────────────────────
let _copyToastTimer = null;
function showCopyToast(fieldName) {
  let toast = document.getElementById('insp-copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'insp-copy-toast';
    toast.className = 'insp-copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = '✓ ' + fieldName;
  toast.classList.add('insp-copy-toast--visible');
  if (_copyToastTimer) clearTimeout(_copyToastTimer);
  _copyToastTimer = setTimeout(() => {
    toast.classList.remove('insp-copy-toast--visible');
  }, 1400);
}

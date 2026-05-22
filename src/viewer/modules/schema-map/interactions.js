import { graphState, uiState } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { render } from '../../engine/render.js';
import { root } from '../../engine/canvas.js';
import { clearSelection, focusTable } from '../../shared/inspector.js';
import { SETTLE_ALPHA } from '../../core/constants.js';

let _ctxNode = null;

export function showCtx(e,d) {
  _ctxNode=d;
  const m=Dom.ctxMenu;
  const isSelected = uiState.selectedNode && d.id === uiState.selectedNode;
  Dom.ctxDeselect.style.display = isSelected ? 'block' : 'none';
  Dom.ctxFocus.style.display   = isSelected ? 'none'  : 'block';
  m.style.display='block';
  const vw=window.innerWidth, vh=window.innerHeight, mw=m.offsetWidth, mh=m.offsetHeight;
  m.style.left=Math.min(e.clientX,vw-mw-8)+'px';
  m.style.top =Math.min(e.clientY,vh-mh-8)+'px';
}

export function initInteractionsListeners() {
  // ── Force simulation controls ─────────────────────────────────────────────

  Dom.btnRefresh.addEventListener('click', () => {
    if (!graphState.graphData) return;
    const savedPositions = {};
    if (graphState.simulation) {
      root.selectAll('g.node-group').each(function(d) {
        if (d && d.id) savedPositions[d.id] = { x: d.x, y: d.y };
      });
      graphState.simulation.stop();
    }
    render();
    if (Object.keys(savedPositions).length) {
      requestAnimationFrame(() => {
        if (!graphState.simulation) return;
        graphState.simulation.nodes().forEach(n => {
          const saved = savedPositions[n.id];
          if (saved) { n.x = saved.x; n.y = saved.y; }
        });
        graphState.simulation.alpha(0.1).restart();
      });
    }
  });

  Dom.btnStopSim.addEventListener('click', () => {
    if (!graphState.simulation) return;
    if (graphState.simulation.alpha() > SETTLE_ALPHA) {
      graphState.simulation.alpha(0).stop();
      graphState.simulation.dispatch('end');
      Dom.btnStopSim.textContent = '⏸ Frozen';
    }
  });

  Dom.btnLod.addEventListener('click', function() {
    uiState.compactMode = !uiState.compactMode;
    this.textContent = uiState.compactMode ? '◑ Full view' : '◑ Compact view';
    this.classList.toggle('active', uiState.compactMode);
    root.selectAll('.node-label').style('display', uiState.compactMode ? 'none' : null);
    root.selectAll('.node-scope').style('display', uiState.compactMode ? 'none' : null);
  });

  // ── Context menu ──────────────────────────────────────────────────────────

  document.addEventListener('click', ()=>{ Dom.ctxMenu.style.display='none'; });
  Dom.ctxCopy.addEventListener('click', ()=>{ if(_ctxNode) navigator.clipboard.writeText(_ctxNode.id).catch(()=>{}); });
  Dom.ctxFocus.addEventListener('click', ()=>{ if(_ctxNode) focusTable(_ctxNode.id); });
  Dom.ctxDeselect.addEventListener('click', ()=>{ clearSelection(); });
  Dom.ctxSnlink.addEventListener('click', ()=>{
    if (!_ctxNode) return;
    const ans = prompt('ServiceNow instance URL (e.g. https://dev12345.service-now.com or https://sn.example.com):', graphState.snInstance);
    if (!ans) return;
    let origin = ans.trim();
    if (!/^https?:\/\//i.test(origin)) {
      if (!origin.includes('.') && !origin.includes('/')) origin = 'https://' + origin + '.service-now.com';
      else origin = 'https://' + origin.replace(/\/+$/, '');
    }
    try { origin = new URL(origin).origin; } catch (e) { alert('Could not parse: ' + (e.message || e)); return; }
    graphState.snInstance = origin;
    window.open(origin + '/sys_db_object_list.do?sysparm_query=name=' + encodeURIComponent(_ctxNode.id), '_blank');
  });
}

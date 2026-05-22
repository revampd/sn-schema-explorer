import { graphState, uiState, nodeColor } from '../core/state.js';
import { Dom } from '../core/dom.js';
import { svg, root, zoom } from '../engine/canvas.js';

export function clearIndicators() {
  const el = Dom.domIndicators;
  if (el) el.innerHTML = '';
}

export function updateIndicators() {
  const container = Dom.domIndicators;
  if (!container) return;
  container.innerHTML = '';
  if (!uiState.selectedNode || !graphState.graphData) return;

  const cv = Dom.canvas;
  const cvW = cv.clientWidth, cvH = cv.clientHeight;
  const t = d3.zoomTransform(svg.node());
  const MARGIN = 8, PILL_W = 164, PILL_H = 24, PILL_GAP = 4;
  const MM_W = 140 + 16 + MARGIN;
  const MM_H = 88  + 16 + MARGIN;
  const EL_W = 190 + 16 + MARGIN;
  const EL_H = 210 + 16 + MARGIN;

  let posMap;
  posMap = {};
  root.selectAll('g.node-group').each(function(d) {
    if (d && d.id !== undefined) posMap[d.id] = { x: d.x, y: d.y };
  });

  const selPos = posMap[uiState.selectedNode];
  if (!selPos) return;
  const selSx = selPos.x * t.k + t.x;
  const selSy = selPos.y * t.k + t.y;

  const candidates = [];

  uiState.connectedNodes.forEach(nodeId => {
    if (nodeId === uiState.selectedNode) return;
    const svgPos = posMap[nodeId];
    if (!svgPos) return;

    const sx = svgPos.x * t.k + t.x;
    const sy = svgPos.y * t.k + t.y;

    const hw = 81 * t.k, hh = 18 * t.k;
    if (sx + hw > 0 && sx - hw < cvW && sy + hh > 0 && sy - hh < cvH) return;

    const node = graphState.graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const dx = sx - selSx, dy = sy - selSy;
    if (dx === 0 && dy === 0) return;

    const inf = Infinity;
    const tR = dx > 0 ? (cvW - MARGIN - selSx) / dx    : inf;
    const tL = dx < 0 ? (EL_W - selSx) / dx             : inf;
    const tB = dy > 0 ? (cvH - MARGIN - selSy) / dy     : inf;
    const tT = dy < 0 ? (MARGIN - selSy) / dy            : inf;
    const tMin = Math.min(tR>0?tR:inf, tL>0?tL:inf, tB>0?tB:inf, tT>0?tT:inf);
    if (!isFinite(tMin)) return;

    let edge;
    if      (tMin === tR && tR < inf) edge = 'right';
    else if (tMin === tL && tL < inf) edge = 'left';
    else if (tMin === tB && tB < inf) edge = 'bottom';
    else                               edge = 'top';

    const ex = selSx + dx * tMin;
    const ey = selSy + dy * tMin;

    const adx = Math.abs(dx), ady = Math.abs(dy);
    const arrow = adx > ady ? (dx > 0 ? '→' : '←') : (dy > 0 ? '↓' : '↑');

    const angle = Math.atan2(dy, dx);

    candidates.push({ nodeId, node, edge, ex, ey, arrow, angle,
                      color: nodeColor(node),
                      label: node.label.length > 17 ? node.label.slice(0,16)+'…' : node.label });
  });

  if (!candidates.length) return;

  const byEdge = { top:[], bottom:[], left:[], right:[] };
  candidates.forEach(c => byEdge[c.edge].push(c));

  function spreadPills(pills, isHorizontal) {
    if (pills.length < 2) return;
    pills.sort((a, b) => isHorizontal ? a.ex - b.ex : a.ey - b.ey);

    const SIZE  = isHorizontal ? PILL_W : PILL_H;
    const STEP  = SIZE + PILL_GAP;

    for (let iter = 0; iter < 20; iter++) {
      let moved = false;
      for (let i = 1; i < pills.length; i++) {
        const prev = pills[i-1], curr = pills[i];
        const axis = isHorizontal ? 'ex' : 'ey';
        const gap  = curr[axis] - prev[axis];
        if (gap < STEP) {
          const push = (STEP - gap) / 2;
          prev[axis] -= push;
          curr[axis] += push;
          moved = true;
        }
      }
      if (!moved) break;
    }

    const MAX = isHorizontal
      ? cvW - PILL_W - MM_W
      : cvH - PILL_H - MM_H;
    const MIN = isHorizontal
      ? EL_W
      : MARGIN;
    pills.forEach(p => {
      if (isHorizontal) p.ex = Math.max(MIN, Math.min(MAX, p.ex));
      else              p.ey = Math.max(MARGIN, Math.min(MAX, p.ey));
    });
  }

  spreadPills(byEdge.top,    true);
  spreadPills(byEdge.bottom, true);
  spreadPills(byEdge.left,   false);
  spreadPills(byEdge.right,  false);

  candidates.forEach(c => {
    const px = Math.max(EL_W, Math.min(cvW - PILL_W - MM_W, c.ex - PILL_W/2));
    const py = Math.max(MARGIN, Math.min(cvH - PILL_H - MM_H, c.ey - PILL_H/2));

    const pill = document.createElement('div');
    pill.className = 'dom-ind';
    pill.title     = c.node.id;
    pill.style.cssText = `left:${px}px;top:${py}px;width:${PILL_W}px;border-color:${c.color}55`;
    pill.innerHTML =
      `<span class="dom-ind-dot" style="background:${c.color}"></span>` +
      `<span class="dom-ind-arrow">${c.arrow}</span>` +
      `<span class="dom-ind-name">${c.label}</span>`;

    pill.addEventListener('click', ev => {
      ev.stopPropagation();
      const tp = posMap[c.nodeId]; if (!tp) return;
      const scale = Math.max(t.k, 0.3);
      svg.transition().duration(480)
        .call(zoom.transform, d3.zoomIdentity
          .translate(cvW/2 - tp.x*scale, cvH/2 - tp.y*scale)
          .scale(scale))
        .on('end', updateIndicators);
    });

    container.appendChild(pill);
  });
}

export function initIndicatorsListeners() {
  zoom.on('zoom.indicators', () => { updateIndicators(); });
}

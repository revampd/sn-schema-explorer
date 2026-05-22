import { uiState, nodeColor } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { svg, root, zoom, setMinimapUpdater } from '../../engine/canvas.js';

let _mmGeom = null;

export function updateMinimap() {
  const el = Dom.minimap;
  if (!el || getComputedStyle(el).display === 'none') return;
  if (uiState.viewMode === 'path') return;

  const points = [];
  const selector = 'g.node-group';
  root.selectAll(selector).each(function(d) {
    if (!d || !d.id) return;
    const t = d3.select(this).attr('transform');
    if (!t) return;
    const m = t.match(/translate\(([^,]+),([^)]+)\)/);
    if (!m) return;
    points.push({ id: d.id, scope: d.scope, core: d.core, x: +m[1], y: +m[2] });
  });
  if (!points.length) { _mmGeom = null; return; }

  const ctx = el.getContext('2d');
  const W = el.width = 140, H = el.height = 88;
  ctx.clearRect(0, 0, W, H);

  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const mnX = Math.min(...xs), mxX = Math.max(...xs);
  const mnY = Math.min(...ys), mxY = Math.max(...ys);
  const r = Math.min(W / (mxX - mnX + 1), H / (mxY - mnY + 1)) * 0.82;

  _mmGeom = { mnX, mnY, mxX, mxY, r, W, H };

  points.forEach(p => {
    const x = (p.x - mnX) * r + (W - (mxX - mnX) * r) / 2;
    const y = (p.y - mnY) * r + (H - (mxY - mnY) * r) / 2;

    const scopeVisible = uiState.selectedScopes.size === 0 || uiState.selectedScopes.has(p.scope);
    const isSelected   = !!uiState.selectedNode && p.id === uiState.selectedNode;
    const isConnected  = !!uiState.selectedNode && uiState.connectedNodes.has(p.id);

    let color, radius;

    if (!scopeVisible) {
      color = '#1e2d3d'; radius = 1.5;
    } else if (uiState.selectedNode) {
      if (isSelected) {
        color = nodeColor(p); radius = p.core ? 4.5 : 3.5;
      } else if (isConnected) {
        color = nodeColor(p); radius = p.core ? 3 : 2;
      } else {
        color = '#253345'; radius = 1.5;
      }
    } else {
      color = nodeColor(p); radius = p.core ? 3 : 2;
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });

  try {
    const t = d3.zoomTransform(svg.node());
    const cv = Dom.canvas;
    const cvW = cv.clientWidth, cvH = cv.clientHeight;
    const vx0 = (-t.x) / t.k, vy0 = (-t.y) / t.k;
    const vx1 = (cvW - t.x) / t.k, vy1 = (cvH - t.y) / t.k;
    const rangeX = mxX - mnX || 1, rangeY = mxY - mnY || 1;
    const rx0 = (vx0 - mnX) * r + (W - rangeX * r) / 2;
    const ry0 = (vy0 - mnY) * r + (H - rangeY * r) / 2;
    const rw  = (vx1 - vx0) * r;
    const rh  = (vy1 - vy0) * r;
    ctx.strokeStyle = 'rgba(99,223,78,.55)';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(rx0, ry0, rw, rh);
    ctx.globalAlpha = 1;
  } catch(_) {}
}

export function initMinimapListeners() {
  const el = Dom.minimap;

  function mmToSvg(mx, my) {
    if (!_mmGeom) return null;
    const { mnX, mnY, mxX, mxY, r, W, H } = _mmGeom;
    const svgX = (mx - (W - (mxX - mnX) * r) / 2) / r + mnX;
    const svgY = (my - (H - (mxY - mnY) * r) / 2) / r + mnY;
    return { x: svgX, y: svgY };
  }

  function panToSvgPoint(svgX, svgY) {
    const cv = Dom.canvas;
    const t  = d3.zoomTransform(svg.node());
    svg.transition().duration(250).call(
      zoom.transform,
      d3.zoomIdentity
        .translate(cv.clientWidth / 2 - svgX * t.k, cv.clientHeight / 2 - svgY * t.k)
        .scale(t.k)
    );
  }

  let dragging = false;

  el.addEventListener('mousedown', e => {
    dragging = true;
    const rect = el.getBoundingClientRect();
    const pos  = mmToSvg(e.clientX - rect.left, e.clientY - rect.top);
    if (pos) panToSvgPoint(pos.x, pos.y);
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = el.getBoundingClientRect();
    const pos  = mmToSvg(e.clientX - rect.left, e.clientY - rect.top);
    if (pos) panToSvgPoint(pos.x, pos.y);
  });

  window.addEventListener('mouseup', () => { dragging = false; });

  el.addEventListener('touchstart', e => {
    dragging = true;
    const rect = el.getBoundingClientRect();
    const touch = e.touches[0];
    const pos = mmToSvg(touch.clientX - rect.left, touch.clientY - rect.top);
    if (pos) panToSvgPoint(pos.x, pos.y);
    e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchmove', e => {
    if (!dragging) return;
    const rect = el.getBoundingClientRect();
    const touch = e.touches[0];
    const pos = mmToSvg(touch.clientX - rect.left, touch.clientY - rect.top);
    if (pos) panToSvgPoint(pos.x, pos.y);
    e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchend', () => { dragging = false; });
}

// Self-register so canvas.js can invoke updateMinimap after zoom/pan events
// without a circular import (canvas ← minimap ← canvas is broken by the hook).
setMinimapUpdater(updateMinimap);

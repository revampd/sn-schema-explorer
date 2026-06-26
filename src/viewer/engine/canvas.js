import { Dom } from '../core/dom.js';

export const LOD_THRESHOLD = 0.25;
export const svg = d3.select('#graph');
export const root = d3.select('#graph-root');

export const zoom = d3
  .zoom()
  .scaleExtent([0.04, 5])
  .on('zoom', e => {
    root.attr('transform', e.transform);
    svg.classed('lod-dots', e.transform.k < LOD_THRESHOLD);
    updateMinimap();
  });
svg.call(zoom);

function updateMinimap() {
  // Deferred call — updateMinimap is defined in ui/minimap.js and called
  // from the zoom handler. We use a late-bound reference to avoid circular
  // module dependencies.
  if (typeof _minimapUpdater === 'function') _minimapUpdater();
}

let _minimapUpdater = null;
export function setMinimapUpdater(fn) {
  _minimapUpdater = fn;
}

export function openPanel(id) {
  document.getElementById(id).classList.add('open');
  showScrim();
}
export function closePanel(id) {
  document.getElementById(id).classList.remove('open');
  hideScrim();
}

export function showScrim() {
  Dom.scrim.classList.add('visible');
}
export function hideScrim() {
  const anyOpen =
    Dom.sidebar.classList.contains('open') || Dom.inspector.classList.contains('open');
  if (!anyOpen) Dom.scrim.classList.remove('visible');
}

Dom.btnSidebarToggle.addEventListener('click', () => {
  Dom.sidebar.classList.contains('open') ? closePanel('sidebar') : openPanel('sidebar');
});
Dom.btnSidebarClose.addEventListener('click', () => closePanel('sidebar'));
Dom.btnInspectorToggle.addEventListener('click', () => {
  Dom.inspector.classList.contains('open') ? closePanel('inspector') : openPanel('inspector');
});
Dom.btnInspectorClose.addEventListener('click', () => closePanel('inspector'));
Dom.scrim.addEventListener('click', () => {
  closePanel('sidebar');
  closePanel('inspector');
  Dom.scrim.classList.remove('visible');
});

(function () {
  const sheet = Dom.inspector;
  let startY = 0,
    active = false;
  sheet.addEventListener(
    'touchstart',
    e => {
      if (!e.target.closest('.sheet-handle')) return;
      startY = e.touches[0].clientY;
      active = true;
    },
    { passive: true }
  );
  sheet.addEventListener(
    'touchmove',
    e => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    },
    { passive: true }
  );
  sheet.addEventListener('touchend', e => {
    if (!active) return;
    active = false;
    const dy = e.changedTouches[0].clientY - startY;
    sheet.style.transform = '';
    if (dy > 80) closePanel('inspector');
  });
})();

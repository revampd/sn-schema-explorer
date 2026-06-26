import { graphState, uiState, nodeColor } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { render } from '../../engine/render.js';

// ── Edge-legend type map ──────────────────────────────────────────────────────
//
// Exported so schema-map/controls.js can reuse it in the legend click handler
// without duplicating the mapping.

export const LEGEND_TYPE_MAP = {
  'ref-to': {
    get: () => uiState.showRefTo,
    set: v => {
      uiState.showRefTo = v;
    },
  },
  'ref-from': {
    get: () => uiState.showRefFrom,
    set: v => {
      uiState.showRefFrom = v;
    },
  },
  ext: {
    get: () => uiState.showExt,
    set: v => {
      uiState.showExt = v;
    },
  },
  m2m: {
    get: () => uiState.showM2M,
    set: v => {
      uiState.showM2M = v;
    },
  },
  rel: {
    get: () => uiState.showRel,
    set: v => {
      uiState.showRel = v;
    },
  },
  view: {
    get: () => uiState.showView,
    set: v => {
      uiState.showView = v;
    },
  },
  cmdbrel: {
    get: () => uiState.showCmdbRel,
    set: v => {
      uiState.showCmdbRel = v;
    },
  },
};

// ── Graph-view overlay controls ───────────────────────────────────────────────
//
// These run after every force/diff render (injected via setRenderImports in render.js
// because this file imports render.js — preventing render.js from importing back).

export function syncLegendRows() {
  document.querySelectorAll('#edge-legend .fl-row[data-etype]').forEach(row => {
    const def = LEGEND_TYPE_MAP[row.dataset.etype];
    if (!def) return;
    row.classList.toggle('fl-off', !def.get());
  });
}

export function updateActiveFilter() {
  const panel = Dom.activeFilter;
  const body = Dom.activeFilterBody;
  if (!graphState.graphData || !uiState.selectedNode) {
    panel.style.display = 'none';
    return;
  }

  const nodeMap = {};
  graphState.graphData.nodes.forEach(n => {
    nodeMap[n.id] = n;
  });

  const selNode = nodeMap[uiState.selectedNode];
  if (!selNode) {
    panel.style.display = 'none';
    return;
  }

  const nbrs = [...uiState.connectedNodes]
    .filter(id => id !== uiState.selectedNode && nodeMap[id])
    .map(id => nodeMap[id])
    .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));

  function makeRow(d, isSelected) {
    const hidden = !isSelected && uiState.hiddenNodes.has(d.id);
    const row = document.createElement('div');
    row.className = 'af-row' + (hidden ? ' af-hidden' : '');
    row.title = d.id;
    row.innerHTML =
      `<div class="af-dot" style="background:${nodeColor(d)}"></div>` +
      `<span class="af-label">${d.label || d.id}</span>`;
    if (!isSelected) {
      row.addEventListener('click', () => {
        if (uiState.hiddenNodes.has(d.id)) uiState.hiddenNodes.delete(d.id);
        else uiState.hiddenNodes.add(d.id);
        row.classList.toggle('af-hidden', uiState.hiddenNodes.has(d.id));
        render();
      });
    }
    return row;
  }

  body.innerHTML = '';

  const selLbl = document.createElement('div');
  selLbl.className = 'af-section-label';
  selLbl.textContent = 'Selected';
  body.appendChild(selLbl);
  body.appendChild(makeRow(selNode, true));

  if (nbrs.length) {
    const sep = document.createElement('div');
    sep.className = 'af-sep';
    body.appendChild(sep);
    const nbrLbl = document.createElement('div');
    nbrLbl.className = 'af-section-label';
    nbrLbl.textContent = 'Neighbours (' + nbrs.length + ')';
    body.appendChild(nbrLbl);
    nbrs.forEach(d => body.appendChild(makeRow(d, false)));
  }

  panel.style.display = 'flex';
}

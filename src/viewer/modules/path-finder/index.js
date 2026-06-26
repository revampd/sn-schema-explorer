import { graphState, uiState } from '../../core/state.js';
import { Settings } from '../settings/index.js';
import { Dom } from '../../core/dom.js';
import { h } from '../../core/template.js';
import { Config } from '../../core/constants.js';
import { Pathfinding } from './pathfinding.js';
import { svg, root, zoom } from '../../engine/canvas.js';
import { render, updateInstancePill, setModeRenderer } from '../../engine/render.js';
import {
  fillInspector,
  focusTable,
  clearSelection,
  initInspectorDeps,
} from '../../shared/inspector.js';
import { clearIndicators } from '../../shared/indicators.js';
import { buildTableList } from '../../shared/table-list.js';
import { syncSidebarForMode } from '../../shared/sidebar-sync.js';
import { setViewMode, onViewModeChange, registerModeValidator } from '../../engine/view-mode.js';
import { getPfConfig, pfConfigSyncVisibility, pfConfigWireInputs } from './config.js';
import { initExclusions } from './exclusions.js';

// ── Settings registrations ───────────────────────────────────────────────────

Settings.registerFeature({
  key: 'pathFinding',
  label: 'Path Finder',
  description:
    'Adds a third view mode that finds shortest dot-walk paths between tables or from a table to a field. Inheritance-aware: paths through extends edges cost nothing because ancestor fields are directly accessible. Shows up to 5 alternative paths for fallback when fields may be unpopulated.',
  default: false,
  category: 'features',
});

Settings.registerFeature({
  key: 'advancedPathFinder',
  label: 'Advanced Path Finder configuration',
  description:
    'Adds a Configuration panel at the top of the Path Finder sidebar (visible when Path Finder is also enabled) for tuning the search: minimum path length, maximum path length, and how many alternative paths to return. Default values match the standard behaviour (1 step minimum, 10 maximum, 5 alternatives). Off by default — most users won’t need to change these.',
  default: false,
  category: 'experimental',
});

// ── Path-view state ──────────────────────────────────────────────────────────

let _pfMode = 'table';
let _pfHighlightedNodes = new Set();
let _pfHighlightedEdges = new Set();
let _pfPaths = [];
let _pfActivePathIdx = 0;
let _pfFieldName = null;
let _pfSourceId = null;

// Auto-refresh the current search result whenever exclusions change (if inputs are filled)
function pfAutoRefreshSearch() {
  const btn = document.getElementById('pf-find');
  if (btn && !btn.disabled) pfRunSearch();
}

// Re-run the current search after a config change, but only when results already show.
function pfReRunIfActive() {
  if (_pfPaths && _pfPaths.length) {
    const findBtn = document.getElementById('pf-find');
    if (findBtn && !findBtn.disabled) findBtn.click();
  }
}

// ── PATH VIEW RENDERER — DAG layout ─────────────────────────────────────────

function renderPathView() {
  root.selectAll('*').remove();
  if (!graphState.graphData) return;
  Dom.statRendered.textContent = 0;

  if (!_pfPaths.length) {
    const W = Dom.canvas.clientWidth;
    const H = Dom.canvas.clientHeight;
    const hint = root
      .append('g')
      .attr('class', 'pf-empty-hint')
      .attr('transform', `translate(${W / 2}, ${H / 2})`);
    hint
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--muted)')
      .attr('font-size', '14px')
      .attr('font-family', 'Syne, sans-serif')
      .attr('letter-spacing', '.1em')
      .attr('text-transform', 'uppercase')
      .text('⤳ PATH FINDER');
    hint
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--muted)')
      .attr('font-size', '11px')
      .attr('y', 24)
      .text('Enter a source and target on the left, then click "Find shortest path".');
    return;
  }

  const nodeMeta = new Map();
  const edgeMeta = new Map();

  _pfPaths.forEach((pr, pathIdx) => {
    pr.path.forEach((nid, i) => {
      let m = nodeMeta.get(nid);
      if (!m) {
        const node = graphState.graphData.nodes.find(n => n.id === nid);
        m = { id: nid, layer: i, paths: new Set(), label: node?.label || nid };
        nodeMeta.set(nid, m);
      } else if (i < m.layer) {
        m.layer = i;
      }
      m.paths.add(pathIdx);
    });
    pr.steps.forEach(s => {
      const key = `${s.from}|${s.to}|${s.edgeType}|${s.fieldName || ''}`;
      let em = edgeMeta.get(key);
      if (!em) {
        em = { ...s, paths: new Set() };
        edgeMeta.set(key, em);
      }
      em.paths.add(pathIdx);
    });
  });

  const byLayer = new Map();
  for (const m of nodeMeta.values()) {
    if (!byLayer.has(m.layer)) byLayer.set(m.layer, []);
    byLayer.get(m.layer).push(m);
  }
  const maxLayer = Math.max(...byLayer.keys());

  for (const [, arr] of byLayer) {
    arr.sort((a, b) => {
      const aHasPrimary = a.paths.has(0) ? 0 : 1;
      const bHasPrimary = b.paths.has(0) ? 0 : 1;
      if (aHasPrimary !== bHasPrimary) return aHasPrimary - bHasPrimary;
      return a.id.localeCompare(b.id);
    });
  }

  const W = Dom.canvas.clientWidth;
  const H = Dom.canvas.clientHeight;
  const padX = 80,
    padY = 60;
  const colWidth = maxLayer === 0 ? 0 : Math.min(280, (W - padX * 2) / Math.max(1, maxLayer));
  const NW = 160,
    NH = 56;

  for (const [layer, arr] of byLayer) {
    const x = padX + layer * colWidth;
    const n = arr.length;
    const usableH = H - padY * 2;
    const gap = n > 1 ? Math.min(NH * 1.6, usableH / (n - 1)) : 0;
    const totalH = (n - 1) * gap;
    const yStart = H / 2 - totalH / 2;
    arr.forEach((m, i) => {
      m.x = x;
      m.y = yStart + i * gap;
    });
  }

  const activeIdx = _pfActivePathIdx;
  const activePathNodes = new Set(_pfPaths[activeIdx].path);
  const activePathEdgeKeys = new Set(
    _pfPaths[activeIdx].steps.map(s => `${s.from}|${s.to}|${s.edgeType}|${s.fieldName || ''}`)
  );

  const edgesG = root.append('g').attr('class', 'edges');
  const pendingLabels = [];
  for (const em of edgeMeta.values()) {
    const a = nodeMeta.get(em.from),
      b = nodeMeta.get(em.to);
    if (!a || !b) continue;
    const isActive = activePathEdgeKeys.has(
      `${em.from}|${em.to}|${em.edgeType}|${em.fieldName || ''}`
    );
    const isPrimary = em.paths.has(0);
    const activeIsPrimary = activeIdx === 0;
    const x1 = a.x + NW / 2,
      y1 = a.y;
    const x2 = b.x - NW / 2,
      y2 = b.y;
    const mx = (x1 + x2) / 2;
    const path = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    const activeStroke = activeIsPrimary ? 'var(--sn-wasabi)' : 'var(--accent2)';
    const stroke = isActive
      ? activeStroke
      : em.edgeType === 'extends'
        ? 'var(--edge-ext)'
        : 'var(--edge-ref-to)';
    const p = edgesG
      .append('path')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', isActive ? 3 : isPrimary ? 1.5 : 1)
      .attr('stroke-dasharray', em.edgeType === 'extends' ? '4 2' : null)
      .attr('opacity', isActive ? 1 : isPrimary ? 0.5 : 0.22)
      .attr('marker-end', em.edgeType === 'extends' ? 'url(#arrow-ext)' : 'url(#arrow-ref-to)');
    if (isActive) {
      p.style(
        'filter',
        `drop-shadow(0 0 4px ${activeIsPrimary ? 'var(--sn-wasabi)' : 'var(--accent2)'})`
      );
    }
    if (em.fieldName) {
      pendingLabels.push({
        x: mx,
        y: (y1 + y2) / 2 - 4,
        isActive,
        isPrimary,
        activeStroke,
        fieldName: em.fieldName,
      });
    }
  }

  const nodesG = root.append('g').attr('class', 'nodes');
  for (const m of nodeMeta.values()) {
    const isActive = activePathNodes.has(m.id);
    const isPrimary = m.paths.has(0);
    const isSource = m.id === _pfSourceId;
    const isTarget = m.layer === maxLayer;
    const isSelected = m.id === uiState.selectedNode;
    const g = nodesG
      .append('g')
      .datum(m)
      .attr(
        'class',
        'pf-node' +
          (isSource ? ' pf-source' : '') +
          (isTarget ? ' pf-target' : '') +
          (isSelected ? ' pf-selected' : '')
      )
      .attr('transform', `translate(${m.x}, ${m.y})`)
      .style('cursor', 'pointer');
    g.append('rect')
      .attr('x', -NW / 2)
      .attr('y', -NH / 2)
      .attr('width', NW)
      .attr('height', NH)
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('fill', isSelected ? 'var(--sn-wasabi-dim)' : 'var(--panel)')
      .attr(
        'stroke',
        isSelected
          ? 'var(--sn-wasabi)'
          : isActive
            ? activeIdx === 0
              ? 'var(--sn-wasabi)'
              : 'var(--accent2)'
            : isPrimary
              ? 'var(--sn-wasabi)'
              : 'var(--border)'
      )
      .attr('stroke-width', isSelected ? 3 : isActive ? 2.5 : isPrimary ? 1.5 : 1)
      .attr('opacity', isActive || isSelected ? 1 : isPrimary ? 0.85 : 0.4);
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', -4)
      .attr('font-family', 'Inter, sans-serif')
      .attr('font-size', '12px')
      .attr('font-weight', '600')
      .attr('fill', 'var(--text)')
      .attr('opacity', isActive ? 1 : isPrimary ? 0.85 : 0.5)
      .text(m.label || m.id);
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 12)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '9px')
      .attr('fill', 'var(--muted)')
      .attr('opacity', isActive ? 1 : isPrimary ? 0.7 : 0.4)
      .text(m.id);
    if (isSource || isTarget) {
      g.append('rect')
        .attr('x', -22)
        .attr('y', -NH / 2 - 9)
        .attr('width', 44)
        .attr('height', 14)
        .attr('rx', 7)
        .attr('ry', 7)
        .attr('fill', isSource ? 'var(--accent2)' : 'var(--sn-wasabi)');
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('y', -NH / 2 + 1)
        .attr('font-family', 'Syne, sans-serif')
        .attr('font-size', '8px')
        .attr('font-weight', '700')
        .attr('letter-spacing', '.1em')
        .attr('text-transform', 'uppercase')
        .attr('fill', 'var(--sn-deep)')
        .text(isSource ? 'FROM' : 'TO');
    }
    if (isTarget && _pfFieldName) {
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('y', NH / 2 + 14)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-size', '10px')
        .attr('fill', 'var(--sn-wasabi)')
        .attr('font-weight', '700')
        .text('.' + _pfFieldName);
    }
    g.on('click', event => {
      event.stopPropagation();
      focusTable(m.id);
    });
  }

  // Render edge labels after nodes so they always appear on top of both edges and nodes.
  const labelsG = root.append('g').attr('class', 'edge-labels');
  for (const l of pendingLabels) {
    labelsG
      .append('text')
      .attr('x', l.x)
      .attr('y', l.y)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px')
      .attr('font-weight', l.isActive ? '600' : '400')
      .attr('fill', l.isActive ? l.activeStroke : l.isPrimary ? 'var(--text)' : 'var(--muted)')
      .attr('opacity', l.isActive ? 1 : l.isPrimary ? 0.8 : 0.4)
      .text('.' + l.fieldName);
  }

  svg.on('click', null);
  Dom.statRendered.textContent = nodeMeta.size;

  setTimeout(() => {
    const b = root.node().getBBox();
    if (!b.width) return;
    const s = Math.min(1.0, 0.92 / Math.max(b.width / W, b.height / H));
    svg
      .transition()
      .duration(500)
      .call(
        zoom.transform,
        d3.zoomIdentity
          .translate(W / 2 - s * (b.x + b.width / 2), H / 2 - s * (b.y + b.height / 2))
          .scale(s)
      );
  }, 50);
}

// Register path view renderer
setModeRenderer('path', renderPathView);

// Wire up view-mode segmented control buttons
document.querySelectorAll('#view-mode-seg .vms-btn').forEach(btn => {
  btn.addEventListener('click', () => setViewMode(btn.dataset.vm));
});

// ── Mode change registration ──────────────────────────────────────────────────

registerModeValidator(mode => mode !== 'path' || Settings.isEnabled('pathFinding'));

onViewModeChange((mode, prevMode) => {
  Dom.simControls.classList.remove('visible');
  Dom.layoutProgress.style.display = 'none';
  clearIndicators();
  pfSyncSidebar();
  pfSyncCanvasOverlays();
  const emptyHint = Dom.inspectorEmpty;
  if (emptyHint) {
    if (mode === 'diff') {
      emptyHint.textContent =
        'Tap a changed table node or sidebar row to compare its fields and relationships.';
    } else if (mode === 'path') {
      emptyHint.textContent =
        'Find a path between tables, then tap a node in the result to inspect it.';
    } else {
      emptyHint.textContent = 'Tap a table node to inspect its fields, references & dependencies.';
    }
  }
  if (uiState.selectedNode && graphState.graphData) {
    const d = graphState.graphData.nodes.find(n => n.id === uiState.selectedNode);
    if (d) fillInspector(d);
    else {
      Dom.inspectorEmpty.style.display = '';
      Dom.inspectorContent.style.display = 'none';
    }
  } else {
    Dom.inspectorEmpty.style.display = '';
    Dom.inspectorContent.style.display = 'none';
  }
});

// ── Sidebar sync ─────────────────────────────────────────────────────────────

export function pfSyncSidebar() {
  if (!document.getElementById('pf-sidebar')) return;
  syncSidebarForMode();
  if (uiState.viewMode === 'path') pfValidate();
}

// ── Canvas overlay sync ───────────────────────────────────────────────────────

export function pfSyncCanvasOverlays() {
  const af = document.getElementById('active-filter');
  const el = document.getElementById('edge-legend');
  const mm = document.getElementById('minimap');
  if (uiState.viewMode === 'path') {
    if (af) af.style.display = 'none';
    if (el) el.style.display = 'none';
    if (mm) mm.style.display = 'none';
  } else if (uiState.viewMode === 'diff') {
    if (el) el.style.display = 'block';
    if (mm) mm.style.display = '';
    if (af) af.style.display = 'none';
  } else {
    if (el) el.style.display = 'block';
    if (mm) mm.style.display = '';
  }
}

// ── Path Finder core UI ───────────────────────────────────────────────────────

export function pfSetMode(mode) {
  _pfMode = mode;
  document.querySelectorAll('.pf-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const lbl = document.getElementById('pf-target-label');
  const inp = document.getElementById('pf-target');
  if (mode === 'field') {
    if (lbl) lbl.textContent = 'To field';
    if (inp) inp.placeholder = 'e.g. manufacturer';
  } else {
    if (lbl) lbl.textContent = 'To table';
    if (inp) inp.placeholder = 'e.g. core_company';
  }
  pfValidate();
  if (_onPfSetMode) _onPfSetMode(mode);
}

let _onPfSetMode = null;
export function onPfSetMode(fn) {
  _onPfSetMode = fn;
}

export function pfValidate() {
  const srcEl = document.getElementById('pf-source');
  const tgtEl = document.getElementById('pf-target');
  const src = srcEl ? srcEl.value.trim() : '';
  const tgt = tgtEl ? tgtEl.value.trim() : '';
  const btn = document.getElementById('pf-find');
  if (btn) btn.disabled = !(src && tgt && graphState.graphData);
}

function pfClearHighlight() {
  document.querySelectorAll('.pf-highlight').forEach(el => el.classList.remove('pf-highlight'));
  document
    .querySelectorAll('.edge-pf-highlight')
    .forEach(el => el.classList.remove('edge-pf-highlight'));
  _pfHighlightedNodes.clear();
  _pfHighlightedEdges.clear();
}

function pfHighlightPath(pathResult) {
  pfClearHighlight();
  if (!pathResult || !pathResult.path) return;
  for (const id of pathResult.path) {
    _pfHighlightedNodes.add(id);
    document.querySelectorAll('.node-group').forEach(g => {
      if (g.__data__?.id === id) g.classList.add('pf-highlight');
    });
  }
  for (const step of pathResult.steps || []) {
    document.querySelectorAll('g.edges path').forEach(p => {
      const d = p.__data__;
      if (!d) return;
      const s = d.source?.id ?? d.source;
      const t = d.target?.id ?? d.target;
      const matches =
        (s === step.from && t === step.to && d.type === step.edgeType) ||
        (s === step.to && t === step.from && d.type === step.edgeType);
      if (matches) p.classList.add('edge-pf-highlight');
    });
  }
}

export function pfRunSearch() {
  const srcEl = document.getElementById('pf-source');
  const tgtEl = document.getElementById('pf-target');
  const resBox = document.getElementById('pf-result');
  const src = srcEl ? srcEl.value.trim() : '';
  const tgtRaw = tgtEl ? tgtEl.value.trim() : '';
  resBox.replaceChildren();
  _pfPaths = [];
  _pfActivePathIdx = 0;
  _pfFieldName = null;
  _pfSourceId = null;
  if (uiState.viewMode === 'path') render();
  else pfClearHighlight();

  if (!graphState.graphData || !src || !tgtRaw) return;

  const srcNode = graphState.graphData.nodes.find(n => n.id === src);
  if (!srcNode) {
    resBox.appendChild(h('div', { class: 'pf-no-result' }, `Unknown table: ${src}`));
    return;
  }

  const advanced = Settings.isEnabled('advancedPathFinder');
  const pfConfig = getPfConfig();
  const minSteps = advanced ? pfConfig.minSteps : 1;
  const maxSteps = advanced ? pfConfig.maxSteps : Infinity;
  const wantCount = advanced ? pfConfig.maxResults : 5;
  const K = Math.min(20, wantCount + (minSteps > 1 ? 5 : 0));
  const filterAndTrim = rs =>
    rs.filter(r => r.steps.length >= minSteps && r.steps.length <= maxSteps).slice(0, wantCount);
  let results = [];

  if (_pfMode === 'table') {
    const tgtNode = graphState.graphData.nodes.find(n => n.id === tgtRaw);
    if (!tgtNode) {
      resBox.appendChild(h('div', { class: 'pf-no-result' }, `Unknown table: ${tgtRaw}`));
      return;
    }
    results = filterAndTrim(Pathfinding.tableToTableK(src, tgtRaw, K));
    if (!results.length) {
      resBox.appendChild(
        h(
          'div',
          { class: 'pf-no-result' },
          advanced
            ? `No path found between ${src} and ${tgtRaw} matching the current filter (min ${minSteps}, max ${maxSteps} steps). Try relaxing the configuration.`
            : `No path found between ${src} and ${tgtRaw} (they may not be connected in the schema).`
        )
      );
      return;
    }
    pfRenderResults(resBox, results, src, null);
    return;
  }

  // Field mode
  let fieldName = tgtRaw;
  let pinnedOwnerTable = null;
  if (tgtRaw.includes('.')) {
    const segs = tgtRaw.split('.');
    fieldName = segs[segs.length - 1];
    let cur = segs[0];
    if (!graphState.graphData.nodes.find(n => n.id === cur)) {
      resBox.appendChild(h('div', { class: 'pf-no-result' }, `Unknown table: ${cur}`));
      return;
    }
    for (let i = 1; i < segs.length - 1; i++) {
      const fname = segs[i];
      const ref = graphState.graphData.edges.find(e => {
        const s = e.source?.id ?? e.source;
        return s === cur && e.type === 'reference' && e.field === fname;
      });
      if (!ref) {
        resBox.appendChild(
          h(
            'div',
            { class: 'pf-no-result' },
            `Cannot resolve "${tgtRaw}" — ${cur} has no reference field "${fname}".`
          )
        );
        return;
      }
      cur = ref.target?.id ?? ref.target;
    }
    pinnedOwnerTable = cur;
    if (!Pathfinding.fieldDefinedAt(pinnedOwnerTable, fieldName)) {
      resBox.appendChild(
        h(
          'div',
          { class: 'pf-no-result' },
          `Field "${fieldName}" not found on table ${pinnedOwnerTable}.`
        )
      );
      return;
    }
  } else {
    const owners = Pathfinding.fieldOwners(fieldName);
    if (!owners.length) {
      resBox.appendChild(
        h('div', { class: 'pf-no-result' }, `Field "${fieldName}" not found on any table.`)
      );
      return;
    }
  }

  if (pinnedOwnerTable) {
    if (src === pinnedOwnerTable) {
      results = [
        {
          steps: [],
          path: [src],
          totalCost: 0,
          dotWalk: `${src}.${fieldName}`,
          fieldOwner: Pathfinding.fieldDefinedAt(src, fieldName),
          inheritedFromAncestor: Pathfinding.fieldDefinedAt(src, fieldName) !== src,
        },
      ];
    } else {
      const rawResults = filterAndTrim(Pathfinding.tableToTableK(src, pinnedOwnerTable, K));
      if (!rawResults.length) {
        resBox.appendChild(
          h(
            'div',
            { class: 'pf-no-result' },
            advanced
              ? `No path from ${src} to ${pinnedOwnerTable} matching the current filter (min ${minSteps}, max ${maxSteps} steps). Try relaxing the configuration.`
              : `No path from ${src} to ${pinnedOwnerTable}.`
          )
        );
        return;
      }
      const defAt = Pathfinding.fieldDefinedAt(pinnedOwnerTable, fieldName);
      results = rawResults.map(r => ({
        ...r,
        dotWalk: r.dotWalk + '.' + fieldName,
        fieldOwner: defAt,
        inheritedFromAncestor: defAt !== pinnedOwnerTable,
      }));
    }
  } else {
    results = filterAndTrim(Pathfinding.tableToFieldK(src, fieldName, K));
    if (!results.length) {
      resBox.appendChild(
        h(
          'div',
          { class: 'pf-no-result' },
          advanced
            ? `No path found from ${src} to a table with field "${fieldName}" matching the current filter (min ${minSteps}, max ${maxSteps} steps).`
            : `No path found from ${src} to a table with field "${fieldName}".`
        )
      );
      return;
    }
  }

  pfRenderResults(resBox, results, src, fieldName);
}

function pfRenderResults(container, results, sourceId, fieldName) {
  if (!results.length) return;
  const [primary, ...alternatives] = results;

  _pfPaths = results;
  _pfSourceId = sourceId;
  _pfFieldName = fieldName || null;
  _pfActivePathIdx = 0;

  if (uiState.viewMode === 'path') render();
  else pfHighlightPath(primary);

  pfRenderResult(container, primary, sourceId, fieldName);

  if (!alternatives.length) return;

  const altsBox = h('div', { class: 'pf-alts' });
  altsBox.appendChild(
    h('div', { class: 'pf-alts-header' }, `Alternative paths (${alternatives.length})`)
  );

  alternatives.forEach((alt, idx) => {
    const item = h('div', { class: 'pf-alt-item', dataIdx: idx });
    const bodyBox = h('div', { class: 'pf-alt-body' });
    const summary = h(
      'div',
      {
        class: 'pf-alt-summary',
        title: 'Click to expand and preview path on canvas',
        onClick: () => {
          const wasExpanded = item.classList.contains('expanded');
          altsBox.querySelectorAll('.pf-alt-item.expanded').forEach(el => {
            if (el !== item) el.classList.remove('expanded');
          });
          item.classList.toggle('expanded');
          if (!wasExpanded) {
            if (!bodyBox.dataset.rendered) {
              pfRenderResult(bodyBox, alt, sourceId, fieldName, true);
              bodyBox.dataset.rendered = '1';
            }
            _pfActivePathIdx = idx + 1;
            if (uiState.viewMode === 'path') render();
            else pfHighlightPath(alt);
          } else {
            _pfActivePathIdx = 0;
            if (uiState.viewMode === 'path') render();
            else pfHighlightPath(primary);
          }
        },
      },
      h('span', { class: 'pf-alt-toggle' }, '▸'),
      h('span', { class: 'pf-alt-cost' }, `${alt.totalCost} step${alt.totalCost === 1 ? '' : 's'}`),
      h('span', { class: 'pf-alt-preview', title: alt.dotWalk }, alt.dotWalk)
    );
    item.appendChild(summary);
    item.appendChild(bodyBox);
    altsBox.appendChild(item);
  });

  container.appendChild(altsBox);
}

function pfRenderResult(container, result, sourceId, fieldName, compact = false) {
  const { steps, totalCost, dotWalk, fieldOwner, inheritedFromAncestor } = result;

  const summary = h('div', { class: 'pf-result-summary' });
  if (steps.length === 0) {
    if (fieldName) {
      const owner = fieldOwner || sourceId;
      const note = owner !== sourceId ? ` (inherited from ${owner})` : ' (own field)';
      summary.appendChild(
        h(
          'span',
          null,
          h('strong', null, 'Direct access'),
          `: ${sourceId}.${fieldName}`,
          h('span', { style: { color: 'var(--muted)' } }, note)
        )
      );
    } else {
      summary.appendChild(h('strong', null, 'Same table.'));
    }
  } else {
    const refCount = steps.filter(s => s.edgeType === 'reference').length;
    const extCount = steps.filter(s => s.edgeType === 'extends').length;
    const otherCount = steps.length - refCount - extCount;
    const parts = [];
    if (refCount) parts.push(`${refCount} reference${refCount === 1 ? '' : 's'}`);
    if (extCount) parts.push(`${extCount} inheritance hop${extCount === 1 ? '' : 's'}`);
    if (otherCount) parts.push(`${otherCount} other`);
    summary.appendChild(
      h(
        'span',
        null,
        'Path found in ',
        h('strong', null, String(totalCost)),
        ' dot-walk step',
        totalCost === 1 ? '' : 's',
        ' (',
        parts.join(', '),
        ')'
      )
    );
    if (fieldName && inheritedFromAncestor) {
      summary.appendChild(
        h(
          'div',
          { style: { marginTop: '4px' } },
          h(
            'span',
            { style: { color: 'var(--muted)' } },
            `Field "${fieldName}" is inherited from `,
            h('strong', { style: { color: 'var(--text)' } }, fieldOwner)
          )
        )
      );
    }
  }
  container.appendChild(summary);

  if (steps.length > 0 || fieldName) {
    const encodedQuery = dotWalk + '=<value>';

    function makeCopyBtn(getText, resetText) {
      return h(
        'button',
        {
          class: 'pf-dotwalk-copy',
          title: 'Copy to clipboard',
          onClick: async e => {
            const btn = e.currentTarget;
            try {
              await navigator.clipboard.writeText(getText());
              btn.textContent = '✓';
              setTimeout(() => {
                btn.textContent = resetText;
              }, 1200);
            } catch {
              const code = btn.parentElement.querySelector('.pf-dotwalk');
              if (code) {
                const range = document.createRange();
                range.selectNodeContents(code);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
              }
            }
          },
        },
        resetText
      );
    }

    const dotwalkBox = h(
      'div',
      { class: 'pf-dotwalk-wrap' },
      h('div', { class: 'pf-dotwalk-label' }, 'Dot-walk'),
      h(
        'div',
        { class: 'pf-dotwalk-row' },
        h(
          'code',
          {
            class: 'pf-dotwalk',
            title: 'Click to select all',
            onClick: function () {
              const range = document.createRange();
              range.selectNodeContents(this);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            },
          },
          dotWalk
        ),
        makeCopyBtn(() => dotWalk, '⧉')
      ),
      h('div', { class: 'pf-dotwalk-label pf-dotwalk-label-eq' }, 'Encoded query'),
      h(
        'div',
        { class: 'pf-dotwalk-row' },
        h(
          'code',
          {
            class: 'pf-dotwalk pf-dotwalk-eq',
            title: 'Click to select all',
            onClick: function () {
              const range = document.createRange();
              range.selectNodeContents(this);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            },
          },
          encodedQuery
        ),
        makeCopyBtn(() => encodedQuery, '⧉')
      )
    );
    container.appendChild(dotwalkBox);
  }

  if (steps.length > 0) {
    const stepsBox = h('div', { class: 'pf-steps' });
    for (const s of steps) {
      const isInh = s.edgeType === 'extends';
      const tag = isInh ? 'inherits from' : 'ref →';
      stepsBox.appendChild(
        h(
          'div',
          {
            class: 'pf-step' + (isInh ? ' inheritance' : ''),
            dataTable: s.to,
            title: `Click to focus ${s.to}`,
            onClick: () => focusTable(s.to),
          },
          h(
            'span',
            { class: 'pf-step-from' },
            s.from,
            Settings.isEnabled('customHighlight') && Settings.isCustomName(s.from)
              ? h('span', { class: 'ti-custom-badge' }, 'custom')
              : null
          ),
          h('span', { class: 'pf-step-arrow' }, '→'),
          h(
            'span',
            { class: 'pf-step-to' },
            s.to,
            Settings.isEnabled('customHighlight') && Settings.isCustomName(s.to)
              ? h('span', { class: 'ti-custom-badge' }, 'custom')
              : null
          ),
          s.fieldName ? h('span', { class: 'pf-step-field' }, `.${s.fieldName}`) : null,
          h('span', { class: 'pf-step-tag' }, tag)
        )
      );
    }
    container.appendChild(stepsBox);
  }

  if (fieldName) {
    const lastTable = result.path[result.path.length - 1];
    container.appendChild(
      h(
        'div',
        { class: 'pf-step', style: { borderLeftColor: 'var(--sn-wasabi)' } },
        h(
          'span',
          { class: 'pf-step-from' },
          lastTable,
          Settings.isEnabled('customHighlight') && Settings.isCustomName(lastTable)
            ? h('span', { class: 'ti-custom-badge' }, 'custom')
            : null
        ),
        h('span', { class: 'pf-step-arrow' }, '→'),
        h('span', { class: 'pf-step-field' }, `.${fieldName}`),
        h('span', { class: 'pf-step-tag' }, 'field')
      )
    );
  }
}

// ── Visibility sync ───────────────────────────────────────────────────────────

function pfSyncVisibility() {
  const enabled = Settings.isEnabled('pathFinding');
  const segBtn = document.getElementById('vms-path');
  if (segBtn) segBtn.style.display = enabled ? '' : 'none';
  if (!enabled && uiState.viewMode === 'path') {
    setViewMode('force');
  }
}

// ── Inspector field ⤳ link factory ──────────────────────────────────────────

function makeInspectorPathLink(fieldName, tableId) {
  if (!Settings.isEnabled('pathFinding')) return null;
  const btn = document.createElement('button');
  btn.className = 'insp-field-pflink';
  btn.title = `Find shortest path to .${fieldName}`;
  btn.textContent = '⤳';
  btn.dataset.field = fieldName;
  btn.dataset.fromTable = tableId;
  btn.addEventListener('click', ev => {
    ev.stopPropagation();
    // Switch to path view first (pfSyncSidebar pre-fills pf-source from
    // uiState.selectedNode).  Then, in the next animation frame once the
    // path view has painted, set the field-mode target and run the search.
    pfSetMode('field');
    setViewMode('path');
    requestAnimationFrame(() => {
      const src = document.getElementById('pf-source');
      const tgt = document.getElementById('pf-target');
      if (!src || !tgt) return;
      src.value = tableId;
      tgt.value = `${tableId}.${fieldName}`;
      pfValidate();
      pfRunSearch();
    });
  });
  return btn;
}

// ── Init ──────────────────────────────────────────────────────────────────────

pfConfigWireInputs({ onApply: pfReRunIfActive });
pfConfigSyncVisibility();
pfSyncVisibility();
Settings.onChange('pathFinding', pfSyncVisibility);
Settings.onChange('advancedPathFinder', pfConfigSyncVisibility);

// Hop exclusions — load persisted set, wire chips / add-input / "Clear all" / context-menu event
initExclusions({ onChange: pfAutoRefreshSearch });

// Inject the path-link factory into the inspector.
initInspectorDeps({ makePathLink: makeInspectorPathLink });

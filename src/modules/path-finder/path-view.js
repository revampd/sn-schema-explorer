import { graphState, uiState } from '../../core/state.js';
import { Settings } from '../settings/index.js';
import { Dom } from '../../core/dom.js';
import { h } from '../../core/template.js';
import { svg, root, zoom } from '../../core/canvas.js';
import { render } from '../../core/render.js';
import { focusTable } from '../../core/inspector.js';
import { pfState } from './pf-state.js';

// ── Path Finder rendering ──────────────────────────────────────────────────────
//
// The DAG canvas renderer (renderPathView) plus the sidebar result list
// (pfRenderResults / pfRenderResult) and the force-view highlight helpers
// (pfHighlightPath / pfClearHighlight). Extracted verbatim from
// path-finder/index.js (#73). Reads/writes the shared pfState singleton; all
// other dependencies are stable imports. index.js drives these from pfRunSearch.

const _pfHighlightedNodes = new Set();
const _pfHighlightedEdges = new Set();

// ── PATH VIEW RENDERER — DAG layout ─────────────────────────────────────────

export function renderPathView() {
  root.selectAll('*').remove();
  if (!graphState.graphData) return;
  Dom.statRendered.textContent = 0;

  if (!pfState.paths.length) {
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

  pfState.paths.forEach((pr, pathIdx) => {
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

  const activeIdx = pfState.activePathIdx;
  const activePathNodes = new Set(pfState.paths[activeIdx].path);
  const activePathEdgeKeys = new Set(
    pfState.paths[activeIdx].steps.map(s => `${s.from}|${s.to}|${s.edgeType}|${s.fieldName || ''}`)
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
    const isSource = m.id === pfState.sourceId;
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
    if (isTarget && pfState.fieldName) {
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('y', NH / 2 + 14)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-size', '10px')
        .attr('fill', 'var(--sn-wasabi)')
        .attr('font-weight', '700')
        .text('.' + pfState.fieldName);
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

// ── Force-view highlight ───────────────────────────────────────────────────────

export function pfClearHighlight() {
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

// ── Sidebar result list ─────────────────────────────────────────────────────────

export function pfRenderResults(container, results, sourceId, fieldName) {
  if (!results.length) return;
  const [primary, ...alternatives] = results;

  pfState.paths = results;
  pfState.sourceId = sourceId;
  pfState.fieldName = fieldName || null;
  pfState.activePathIdx = 0;

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
            pfState.activePathIdx = idx + 1;
            if (uiState.viewMode === 'path') render();
            else pfHighlightPath(alt);
          } else {
            pfState.activePathIdx = 0;
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

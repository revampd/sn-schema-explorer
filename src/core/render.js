import { graphState, uiState, nodeColor } from './state.js';
import { Settings } from '../modules/settings/index.js';
import { Dom } from './dom.js';
import { Config, LARGE_GRAPH, MAX_FPS, SETTLE_ALPHA } from './constants.js';
import { tagRefDirection, arrowId, edgeClass, buildFanOffsets } from './edge-style.js';
import { makeEdgeGeom } from './geometry.js';
import { makeEdgeTitleText } from './edge-title.js';
import { computeNeighbourhood } from './compute.js';
import { svg, root, zoom, LOD_THRESHOLD } from './canvas.js';
import { updateMinimap } from '../modules/graph-view/minimap.js';
import { updateIndicators } from './indicators.js';
import { updateDensityInfo, updateMaxNodesSlider } from './density-controls.js';
import { highlightListItem } from './table-list.js';
import { fitGraph } from '../modules/export/index.js';

// The instance-info footer pill + modal live in a sibling module; re-export the
// public entry points so existing importers keep resolving them from render.js.
export { updateInstancePill, showInstanceInfo } from './instance-info.js';

// Field type → badge colour / label lives in a sibling module; re-export so
// existing importers keep resolving these from render.js. typeBadgeColor is also
// used internally below (the in-node field badges).
export { typeBadgeColor, typeLabel } from './type-badge.js';
import { typeBadgeColor } from './type-badge.js';

export function updateStats() {
  if (!graphState.graphData) return;
  Dom.statNodes.textContent = graphState.graphData.nodes.length;
  Dom.statEdges.textContent = graphState.graphData.edges.length;
  Dom.statRendered.textContent = '—';
}

let _renderImports = null;
const _renderHooks = [];
const _modeRenderers = {};

const REQUIRED_RENDER_IMPORTS = [
  'updateActiveFilter',
  'syncLegendRows',
  'selectNode',
  'clearSel',
  'fillInspector',
  'showCtx',
];

export function setRenderImports(imports) {
  if (typeof imports === 'object' && imports !== null) {
    const missing = REQUIRED_RENDER_IMPORTS.filter(k => typeof imports[k] !== 'function');
    if (missing.length) {
      console.error('[render] setRenderImports: missing required keys:', missing);
    }
  }
  _renderImports = imports;
}

export function addRenderHook(fn) {
  _renderHooks.push(fn);
}

export function setModeRenderer(mode, fn) {
  _modeRenderers[mode] = fn;
}

export function render() {
  if (!graphState.graphData) return;
  const modeRenderer = _modeRenderers[uiState.viewMode];
  if (modeRenderer) {
    modeRenderer();
    return;
  }
  renderGraph();
  updateMinimap();
  updateIndicators();
  updateDensityInfo();
  updateMaxNodesSlider();
  if (_renderImports) {
    _renderImports.updateActiveFilter();
    _renderImports.syncLegendRows();
  }
}

export function renderGraph() {
  root.selectAll('*').remove();
  if (!graphState.graphData) return;

  const { nodes, edges } = graphState.graphData;

  const { visNodeIds, visEdges, hopDist } = computeNeighbourhood();
  const visNodes = nodes.filter(n => visNodeIds.has(n.id));

  const N = visNodes.length;
  const large = N > LARGE_GRAPH;

  Dom.statRendered.textContent = N;

  let positionedCount = 0;
  let cxSum = 0,
    cySum = 0;
  for (const n of visNodes) {
    if (typeof n.x === 'number' && typeof n.y === 'number') {
      positionedCount++;
      cxSum += n.x;
      cySum += n.y;
    }
  }
  const cx = positionedCount > 0 ? cxSum / positionedCount : 0;
  const cy = positionedCount > 0 ? cySum / positionedCount : 0;
  const mostlyPositioned = positionedCount >= Math.ceil(visNodes.length * 0.5);

  // R_HOP defined here so it can seed initial node positions as well as the radial force.
  const R_HOP = 200; // px per hop ring

  const simNodes = visNodes.map(n => {
    const clone = { ...n };
    clone._hopDist = (hopDist && hopDist[n.id]) ?? 0;
    if (typeof clone.x !== 'number' || typeof clone.y !== 'number') {
      const angle = Math.random() * 2 * Math.PI;
      // Seed unpositioned nodes at their target ring radius so the simulation
      // starts close to the desired layout and the radial force has less work to do.
      const ring = clone._hopDist > 0 ? clone._hopDist * R_HOP : 80 + Math.random() * 120;
      const jitter = (Math.random() - 0.5) * 60;
      clone.x = cx + Math.cos(angle) * (ring + jitter);
      clone.y = cy + Math.sin(angle) * (ring + jitter);
    }
    return clone;
  });
  const simEdges = visEdges.map(e => ({ ...e }));

  const NW_SIM = 174;
  const NH_BASE_SIM = 36;
  const F_ROW_H_SIM = 22;
  const F_PAD_SIM = 6;

  function nodeRadius(d) {
    const hasFields =
      uiState.showFields &&
      d.fields?.length &&
      (uiState.connectedNodes.size === 0 || uiState.connectedNodes.has(d.id));
    const h = hasFields
      ? NH_BASE_SIM + F_PAD_SIM + d.fields.length * F_ROW_H_SIM + F_PAD_SIM
      : NH_BASE_SIM;
    return Math.sqrt((NW_SIM / 2) ** 2 + (h / 2) ** 2) + 6;
  }

  const edgeDensity = N > 0 ? simEdges.length / N : 0;

  const chargeMag = large
    ? Math.max(-80, -320 + N * 0.5)
    : Math.min(-800, -(320 + edgeDensity * 60)) * (uiState.showFields ? 1.6 : 1);

  const decay = large ? Math.min(0.1, 0.03 + N * 0.00015) : 0.02;

  const linkDist = large
    ? 70
    : d => {
        const lt = Config.sim.linkDistance;
        if (d.type === 'extends') return lt.extends;
        if (d.type === 'm2m') return lt.m2m;
        if (d.type === 'view') return lt.view;
        return lt.ref;
      };
  const linkStr = large ? Config.sim.linkStrength.large : Config.sim.linkStrength.small;

  if (graphState.simulation) graphState.simulation.stop();

  const lpBar = Dom.layoutProgress;
  const lpFill = Dom.layoutProgressFill;
  const simCtrl = Dom.simControls;
  lpBar.style.display = 'block';
  lpFill.style.width = '0%';
  simCtrl.classList.add('visible');

  const startAlpha = mostlyPositioned ? 0.1 : 1.0;
  const fastDecay = mostlyPositioned ? 0.25 : decay;

  graphState.simulation = d3
    .forceSimulation(simNodes)
    .alpha(startAlpha)
    .force(
      'link',
      d3
        .forceLink(simEdges)
        .id(d => d.id)
        .distance(linkDist)
        .strength(linkStr)
    )
    .force(
      'charge',
      d3
        .forceManyBody()
        .strength(chargeMag)
        .distanceMax(large ? 300 : 1400)
    )
    .force('center', d3.forceCenter(0, 0))
    .force('collision', d3.forceCollide(d => nodeRadius(d) + 4).iterations(large ? 2 : 6))
    .alphaDecay(fastDecay)
    .alphaMin(SETTLE_ALPHA)
    .velocityDecay(large ? Config.sim.velocityDecay.large : Config.sim.velocityDecay.small);

  // Radial force — only when a node is selected. Pushes nodes to concentric rings
  // by hop distance so deeper nodes stay visually outside shallower ones.
  // Nodes are also seeded at their ring radius above, so the force has less work to do.
  if (uiState.selectedNode) {
    graphState.simulation.force(
      'radial',
      d3.forceRadial(d => (d._hopDist ?? 0) * R_HOP, 0, 0).strength(0.35)
    );
  }

  if (!mostlyPositioned) {
    const preWarm = large
      ? Math.min(60, Math.floor(N / 5))
      : Math.min(120, 20 + Math.floor(edgeDensity * 15));
    for (let i = 0; i < preWarm; i++) graphState.simulation.tick();
  }

  tagRefDirection(simEdges, uiState.selectedNode);
  const edgeG = root.append('g').attr('class', 'edges');

  const { fanOffset, fanVisible } = buildFanOffsets(
    simEdges,
    Config.geomForce.fanStep,
    Config.geomForce.maxFan
  );

  // Shared tooltip text builder — used by both the visible path and the hit
  // overlay. The factory snapshots ancestor-lookup maps once per render; by this
  // point D3 forceLink has replaced source/target strings with node objects.
  const edgeTitleText = makeEdgeTitleText();

  const edgeSel = edgeG
    .selectAll('path')
    .data(simEdges)
    .join('path')
    .attr('class', d => edgeClass(d))
    .attr('id', (_, i) => `ep-${i}`)
    .style('display', 'none');
  edgeSel.append('title').text(edgeTitleText);

  // Transparent wide-stroke overlay paths — extend the pointer-events hit area for
  // edge tooltips from 1 px to EDGE_HIT_WIDTH px so edges are easy to hover over.
  // Rendered between edgeG and nodeG so nodes still receive events normally.
  const EDGE_HIT_WIDTH = 10;
  const edgeHitG = root.append('g').attr('class', 'edge-hits');
  const edgeHitSel = edgeHitG
    .selectAll('path')
    .data(simEdges)
    .join('path')
    .style('fill', 'none')
    .style('stroke', 'white')
    .style('stroke-opacity', '0')
    .style('stroke-width', `${EDGE_HIT_WIDTH}px`)
    .style('pointer-events', 'stroke')
    .style('display', 'none');
  edgeHitSel.append('title').text(edgeTitleText);

  const nodeG = root.append('g').attr('class', 'nodes');

  const labelG = root.append('g').attr('class', 'edge-labels');
  let labelSel = null;

  if (uiState.showLabels) {
    const labelVisible = new Set();
    if (uiState.selectedNode) {
      const labelledPairs = new Set();
      simEdges.forEach((e, i) => {
        const s = e.source?.id ?? e.source;
        const t = e.target?.id ?? e.target;
        if (s !== uiState.selectedNode && t !== uiState.selectedNode) return;
        const pairKey = (s < t ? `${s}|${t}` : `${t}|${s}`) + '|' + e.label;
        if (labelledPairs.has(pairKey)) return;
        labelledPairs.add(pairKey);
        labelVisible.add(i);
      });
    }

    labelSel = labelG
      .selectAll('text')
      .data(simEdges)
      .join('text')
      .attr('class', 'edge-label')
      .attr('text-anchor', 'middle')
      .attr('dy', -4)
      .style('display', (_, i) => (labelVisible.has(i) ? null : 'none'))
      .text(d => {
        // For cmdb_rel edges use a perspective-aware label: if the focused node is
        // the child (target) of the relationship show childLabel ("Powered by"), not
        // parentLabel ("Powers").  For all other edge types label is direction-fixed.
        let lbl = d.label || '';
        if (d.type === 'cmdb_rel' && uiState.selectedNode) {
          const t = d.target?.id ?? d.target;
          if (t === uiState.selectedNode) lbl = d.childLabel || d.label || '';
        }
        if (d._count > 1) return `${lbl} +${d._count - 1}`.trim();
        return lbl;
      });
  }

  const NW = Config.geomForce.nodeWidth;
  const NH_BASE = 36;
  const F_ROW_H = 22;
  const F_PAD = 6;

  function nHeight(d) {
    const fieldsVisible =
      uiState.showFields &&
      d.fields?.length &&
      (uiState.connectedNodes.size === 0 || uiState.connectedNodes.has(d.id));
    if (!fieldsVisible) return NH_BASE;
    return NH_BASE + F_PAD + d.fields.length * F_ROW_H + F_PAD;
  }

  const HW = NW / 2;
  function nodeHH(d) {
    return nHeight(d) / 2;
  }
  const _fg = makeEdgeGeom(HW, HW, Config.geomForce.minBezierDist);

  // When a node is focused, flip cmdb_rel edges where the focused node is the
  // child (target) so that all CI relationship arrows radiate outward from the
  // focused node.  The label for these edges already uses childLabel (e.g.
  // "Powered by") so the rendered text reads "[focused] [label] [other]".
  function isCmdbRelFlipped(d) {
    if (d.type !== 'cmdb_rel' || !uiState.selectedNode) return false;
    return (d.target?.id ?? d.target) === uiState.selectedNode;
  }

  function edgePath(d, offset) {
    const flipped = isCmdbRelFlipped(d);
    const src = flipped ? d.target : d.source;
    const tgt = flipped ? d.source : d.target;
    return _fg.edgePath(src.x, src.y, tgt.x, tgt.y, nodeHH(src), nodeHH(tgt), offset);
  }
  function bezierMid(d, offset) {
    const flipped = isCmdbRelFlipped(d);
    const src = flipped ? d.target : d.source;
    const tgt = flipped ? d.source : d.target;
    return _fg.bezierMid(src.x, src.y, tgt.x, tgt.y, nodeHH(src), nodeHH(tgt), offset);
  }

  function updateEdges() {
    edgeSel.each(function (d, i) {
      const el = d3.select(this);
      if (!fanVisible[i]) {
        el.style('display', 'none').attr('marker-end', null);
        return;
      }
      const p = edgePath(d, fanOffset[i]);
      if (!p) {
        el.style('display', 'none').attr('marker-end', null);
        return;
      }
      const w = d._count > 1 ? Math.min(1.2 + d._count * 0.15, 3.5) : null;
      el.style('display', null)
        .attr('d', p)
        .attr('marker-end', arrowId(d))
        .style('stroke-width', w);
    });
    edgeHitSel.each(function (d, i) {
      const el = d3.select(this);
      if (!fanVisible[i]) {
        el.style('display', 'none');
        return;
      }
      const p = edgePath(d, fanOffset[i]);
      if (!p) {
        el.style('display', 'none');
        return;
      }
      el.style('display', null).attr('d', p);
    });
    if (labelSel) {
      labelSel.each(function (d, i) {
        const p = edgePath(d, fanOffset[i]);
        if (!p) return;
        const mid = bezierMid(d, fanOffset[i]);
        d3.select(this)
          .attr('x', mid.x)
          .attr('y', mid.y - 5);
      });
    }
  }

  const nodeSel = nodeG
    .selectAll('g.node-group')
    .data(simNodes)
    .join('g')
    .attr('class', d => {
      let cls = `node-group${d.core ? ' core' : ''}`;
      if (Settings.isEnabled('customHighlight') && Settings.isCustomName(d.id))
        cls += ' node-custom';
      return cls;
    })
    .call(
      d3
        .drag()
        .on('start', (e, d) => {
          if (!e.active) graphState.simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (e, d) => {
          d.fx = e.x;
          d.fy = e.y;
        })
        .on('end', (e, d) => {
          if (!e.active) graphState.simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
          updateEdges();
        })
    )
    .on('click', (e, d) => {
      e.stopPropagation();
      _renderImports && _renderImports.selectNode(d, nodeSel, edgeSel);
    })
    .on('contextmenu', (e, d) => {
      e.preventDefault();
      _renderImports && _renderImports.showCtx(e, d);
    })
    .on('mouseover', (e, d) => {
      if (!Settings.isEnabled('dimOnHover') || uiState.selectedNode) return;
      const id = d.id;
      const neighbours = new Set([id]);
      const _hAdj = graphState.graphData._adj;
      if (_hAdj) {
        const na = _hAdj.get(id) || { out: [], in: [] };
        for (const e of na.out) {
          const t = e.target?.id ?? e.target;
          neighbours.add(t);
        }
        for (const e of na.in) {
          const s = e.source?.id ?? e.source;
          neighbours.add(s);
        }
      } else {
        for (const e of graphState.graphData.edges) {
          const s = e.source?.id ?? e.source;
          const t = e.target?.id ?? e.target;
          if (s === id) neighbours.add(t);
          else if (t === id) neighbours.add(s);
        }
      }
      root.selectAll('g.node-group').classed('hover-dim', n => !neighbours.has(n.id));
      root.selectAll('g.edges path').classed('hover-dim', le => {
        const s = le.source?.id ?? le.source;
        const t = le.target?.id ?? le.target;
        return s !== id && t !== id;
      });
    })
    .on('mouseout', () => {
      if (!Settings.isEnabled('dimOnHover')) return;
      root.selectAll('g.node-group').classed('hover-dim', false);
      root.selectAll('g.edges path').classed('hover-dim', false);
    });

  nodeSel
    .append('rect')
    .attr('class', 'node-rect')
    .attr('width', NW)
    .attr('height', d => nHeight(d))
    .attr('x', -NW / 2)
    .attr('y', d => -nHeight(d) / 2);

  nodeSel
    .append('rect')
    .attr('class', 'node-header')
    .attr('width', NW)
    .attr('height', NH_BASE)
    .attr('x', -NW / 2)
    .attr('y', d => -nHeight(d) / 2)
    .attr('rx', 6)
    .attr('ry', 6)
    .attr('fill', 'rgba(0,0,0,.22)')
    .attr('pointer-events', 'none');

  nodeSel
    .append('circle')
    .attr('r', 4)
    .attr('cx', -NW / 2 + 12)
    .attr('cy', d => -nHeight(d) / 2 + NH_BASE / 2)
    .attr('fill', d => nodeColor(d));

  nodeSel
    .append('text')
    .attr('class', 'node-label')
    .attr('x', -NW / 2 + 22)
    .attr('y', d => -nHeight(d) / 2 + NH_BASE / 2 - 5)
    .style('display', uiState.compactMode ? 'none' : null)
    .text(d => (d.label.length > 17 ? d.label.slice(0, 17) + '…' : d.label));

  nodeSel
    .append('text')
    .attr('class', 'node-scope')
    .attr('x', -NW / 2 + 22)
    .attr('y', d => -nHeight(d) / 2 + NH_BASE / 2 + 8)
    .style('display', uiState.compactMode ? 'none' : null)
    .text(d => (d.id.length > 20 ? d.id.slice(0, 19) + '…' : d.id));

  if (uiState.showFields) {
    nodeSel.each(function (d) {
      if (!d.fields?.length) return;
      if (uiState.connectedNodes.size > 0 && !uiState.connectedNodes.has(d.id)) return;
      const g = d3.select(this);
      const topY = -nHeight(d) / 2;

      g.append('line')
        .attr('class', 'node-field-sep')
        .attr('x1', -NW / 2 + 6)
        .attr('x2', NW / 2 - 6)
        .attr('y1', topY + NH_BASE)
        .attr('y2', topY + NH_BASE)
        .attr('stroke', 'var(--border)')
        .attr('stroke-width', 1)
        .attr('pointer-events', 'none');

      d.fields.forEach((f, i) => {
        const fy = topY + NH_BASE + F_PAD + i * F_ROW_H;
        const tc = typeBadgeColor(f.type);
        const typeShort = f.type.length > 8 ? f.type.slice(0, 7) + '…' : f.type;
        const nameShort = f.name.length > 16 ? f.name.slice(0, 15) + '…' : f.name;
        const labelShort = f.label.length > 18 ? f.label.slice(0, 17) + '…' : f.label;

        g.append('rect')
          .attr('x', NW / 2 - 52)
          .attr('y', fy + 3)
          .attr('width', 48)
          .attr('height', 12)
          .attr('rx', 2)
          .attr('fill', 'rgba(0,0,0,.35)')
          .attr('pointer-events', 'none');

        g.append('text')
          .attr('class', 'node-field-name')
          .attr('x', -NW / 2 + 8)
          .attr('y', fy + 10)
          .attr('fill', 'var(--text)')
          .text(nameShort);

        g.append('text')
          .attr('class', 'node-field-label-sub')
          .attr('x', -NW / 2 + 8)
          .attr('y', fy + 20)
          .attr('fill', 'var(--muted)')
          .attr('font-size', '7.5px')
          .attr(
            'font-family',
            "'JetBrains Mono', ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
          )
          .attr('pointer-events', 'none')
          .text(labelShort);

        g.append('text')
          .attr('class', 'node-field-type')
          .attr('x', NW / 2 - 4)
          .attr('y', fy + 11)
          .attr('fill', tc)
          .text(typeShort);
      });
    });
  }

  nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
  updateEdges();

  let lastPaint = 0;
  const frameMs = 1000 / MAX_FPS;

  lpFill.style.width = mostlyPositioned ? '90%' : '50%';

  graphState.simulation.on('tick', () => {
    const now = performance.now();
    if (now - lastPaint < frameMs) return;
    lastPaint = now;

    updateEdges();
    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    updateMinimap();
  });

  graphState.simulation.on('end', () => {
    lpBar.style.display = 'none';
    lpFill.style.width = '100%';
    simCtrl.classList.remove('visible');

    const _snNb = graphState.graphData._nodeById;
    simNodes.forEach(sn => {
      const gn = _snNb ? _snNb.get(sn.id) : graphState.graphData.nodes.find(n => n.id === sn.id);
      if (gn) {
        gn.x = sn.x;
        gn.y = sn.y;
      }
    });

    {
      const PAD = 8;
      const ITERS = 30;

      for (let iter = 0; iter < ITERS; iter++) {
        let moved = false;
        for (let i = 0; i < simNodes.length; i++) {
          for (let j = i + 1; j < simNodes.length; j++) {
            const a = simNodes[i],
              b = simNodes[j];
            const aW = NW / 2 + PAD / 2,
              aH = nHeight(a) / 2 + PAD / 2;
            const bW = NW / 2 + PAD / 2,
              bH = nHeight(b) / 2 + PAD / 2;
            const dx = b.x - a.x,
              dy = b.y - a.y;
            const overlapX = aW + bW - Math.abs(dx);
            const overlapY = aH + bH - Math.abs(dy);
            if (overlapX <= 0 || overlapY <= 0) continue;
            moved = true;
            if (overlapX < overlapY) {
              const push = overlapX / 2;
              if (dx >= 0) {
                a.x -= push;
                b.x += push;
              } else {
                a.x += push;
                b.x -= push;
              }
            } else {
              const push = overlapY / 2;
              if (dy >= 0) {
                a.y -= push;
                b.y += push;
              } else {
                a.y += push;
                b.y -= push;
              }
            }
          }
        }
        if (!moved) break;
      }
    }

    updateEdges();
    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);

    nodeSel
      .on('click', (e, d) => {
        e.stopPropagation();
        _renderImports && _renderImports.selectNode(d, nodeSel, edgeSel);
      })
      .on('contextmenu', (e, d) => {
        e.preventDefault();
        _renderImports && _renderImports.showCtx(e, d);
      });
    svg.on('click', () => _renderImports && _renderImports.clearSel(nodeSel, edgeSel));

    fitGraph();

    if (uiState.selectedNode) {
      const _selNb = graphState.graphData._nodeById;
      const d = _selNb
        ? _selNb.get(uiState.selectedNode)
        : graphState.graphData.nodes.find(n => n.id === uiState.selectedNode);
      if (d) {
        nodeSel.classed('selected', n => n.id === uiState.selectedNode);
        edgeSel.classed('highlighted', e => {
          const s = e.source?.id ?? e.source,
            t = e.target?.id ?? e.target;
          return s === uiState.selectedNode || t === uiState.selectedNode;
        });
        if (_renderImports) {
          _renderImports.fillInspector(d);
        }
        highlightListItem(d.id);
      }
    }
    updateMinimap();
    updateIndicators();
    if (_renderImports) {
      _renderImports.updateActiveFilter();
    }
    if (_renderHooks.length) _renderHooks.forEach(fn => fn());
  });

  svg.on('click', () => _renderImports && _renderImports.clearSel(nodeSel, edgeSel));
  if (_renderHooks.length) _renderHooks.forEach(fn => fn());
}

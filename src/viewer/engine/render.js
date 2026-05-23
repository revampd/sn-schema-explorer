import { graphState, uiState, diffState, nodeColor } from '../core/state.js';
import { Settings } from '../modules/settings/index.js';
import { Dom } from '../core/dom.js';
import { Config, LARGE_GRAPH, MAX_FPS, SETTLE_ALPHA } from '../core/constants.js';
import { tagRefDirection, arrowId, edgeClass, buildFanOffsets } from '../core/edge-style.js';
import { makeEdgeGeom } from './geometry.js';
import { computeNeighbourhood } from './compute.js';
import { svg, root, zoom, LOD_THRESHOLD } from './canvas.js';
import { updateMinimap } from '../modules/graph-view/minimap.js';
import { updateIndicators } from '../shared/indicators.js';
import { updateDensityInfo, updateMaxNodesSlider } from '../shared/density-controls.js';
import { highlightListItem } from '../shared/table-list.js';
import { fitGraph } from '../modules/export/index.js';

const TYPE_BADGE_COL_RAW = {
  string:'#cdd9e5', sys_id_guid:'#cdd9e5', sys_id:'#cdd9e5',
  ip_address:'#cdd9e5', ip_address_validated_ipv4_ipv6:'#cdd9e5',
  table_name:'#cdd9e5', url:'#cdd9e5', email:'#cdd9e5',
  password:'#cdd9e5', password_2_way_encrypted:'#cdd9e5',
  string_full_utf_8:'#cdd9e5', long_integer_string:'#cdd9e5',
  translated_text:'#cdd9e5', translated_field:'#cdd9e5',
  char:'#cdd9e5', wikitext:'#cdd9e5', mid_config:'#cdd9e5',
  two_line_text_area:'#cdd9e5', phone_number:'#cdd9e5',
  phone_number_e164:'#cdd9e5', short_table_name:'#cdd9e5',
  ph_number:'#cdd9e5', name_value_pairs:'#cdd9e5',
  integer:'#ffd166', long:'#ffd166', decimal:'#ffd166',
  floating_point_number:'#ffd166', float:'#ffd166', double:'#ffd166',
  percent_complete:'#ffd166', currency:'#ffd166',
  fx_currency:'#ffd166', price:'#ffd166', auto_increment:'#ffd166',
  order:'#ffd166', counter:'#ffd166',
  numeric:'#ffd166', integer_string:'#ffd166',
  boolean:'#06d6a0', true_false:'#06d6a0',
  reference:'#a090ff', document_id:'#a090ff',
  field_name:'#a090ff', field_list:'#a090ff',
  list:'#a090ff', glide_list:'#a090ff',
  glide_date_time:'#ff9f5a', date_time:'#ff9f5a',
  glide_date:'#ff9f5a', date:'#ff9f5a',
  glide_time:'#ff9f5a', time:'#ff9f5a',
  duration:'#ff9f5a', scheduled_date_time:'#ff9f5a',
  due_date:'#ff9f5a', days_of_week:'#ff9f5a',
  week_of_month:'#ff9f5a', month_of_year:'#ff9f5a',
  integer_date:'#ff9f5a', other_date:'#ff9f5a',
  basic_date_time:'#ff9f5a',
  choice:'#7fbfff', conditions:'#7fbfff', condition_string:'#7fbfff',
  html:'#888', translated_html:'#888', image:'#888',
  user_image:'#888', user_roles:'#888',
  journal:'#888', journal_input:'#888', journal_list:'#888',
  glyph_icon_bootstrap:'#888',
  script:'#f77', script_plain:'#f77', script_server:'#f77',
  script_client:'#f77', json:'#f77', xml:'#f77', css:'#f77',
  template_value:'#f77', email_script:'#f77', glide_var:'#f77',
  compressed:'#f77',
  domain_id:'#a8a8a8', domain_path:'#a8a8a8',
  system_class_name:'#a8a8a8', system_class_path:'#a8a8a8',
  sys_class_name:'#a8a8a8', sys_class_path:'#a8a8a8',
  ui_action_list:'#7fbfff', slush_bucket:'#7fbfff',
  breakdown_element:'#7fbfff',
  color:'#c46aff',
};

function normaliseType(t) {
  if (!t) return '';
  return String(t).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function _hashColor(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  const hue = h % 360;
  return `oklch(72% 0.13 ${hue})`;
}

export function typeBadgeColor(t) {
  const key = normaliseType(t);
  if (TYPE_BADGE_COL_RAW[key]) return TYPE_BADGE_COL_RAW[key];
  if (graphState.graphData && graphState.graphData._typeCatalog) {
    const cat = graphState.graphData._typeCatalog[key] ||
                graphState.graphData._typeCatalog[String(t)] ||
                graphState.graphData._typeCatalog[t];
    if (cat && cat.scalarType) {
      const scalarKey = normaliseType(cat.scalarType);
      if (TYPE_BADGE_COL_RAW[scalarKey]) return TYPE_BADGE_COL_RAW[scalarKey];
    }
  }
  return _hashColor(key || String(t || ''));
}

export function typeLabel(t) {
  if (!t) return '';
  if (graphState.graphData && graphState.graphData._typeCatalog) {
    const key = normaliseType(t);
    const cat = graphState.graphData._typeCatalog[key] ||
                graphState.graphData._typeCatalog[String(t)] ||
                graphState.graphData._typeCatalog[t];
    if (cat && cat.label) return cat.label;
  }
  return String(t);
}

export function updateInstancePill() {
  const pill = document.getElementById('footer-instance');
  if (!pill) return;
  const inst = graphState.graphData && graphState.graphData._instance;
  if (!inst) {
    pill.classList.remove('is-visible');
    return;
  }
  function shortLabel(x) {
    if (!x) return '?';
    if (typeof x === 'string') return x;
    let n = x.instance_name || x.instance_url || '?';
    if (n.indexOf('://') !== -1) {
      try { n = new URL(n).hostname.split('.')[0]; } catch (_) {}
    }
    return n;
  }
  function buildLabel(x) {
    if (!x || typeof x === 'string') return '';
    return x.build_name || x.build_tag || '';
  }
  const nameEl  = document.getElementById('footer-instance-name');
  const buildEl = document.getElementById('footer-instance-build');
  const cmpInst = diffState._diffData && diffState._diffData._compareInstance;
  if (cmpInst) {
    nameEl.textContent  = shortLabel(inst) + ' → ' + shortLabel(cmpInst);
    buildEl.textContent = '';
  } else {
    nameEl.textContent  = shortLabel(inst);
    const b = buildLabel(inst);
    buildEl.textContent = b ? '· ' + b : '';
  }
  pill.classList.add('is-visible');
}

// opts.noStatCards — suppress the schema stat-card grid (used in diff mode where
//                    the stats comparison table already covers this information)
function _instanceSectionsHtml(scope, esc, kv, opts) {
  opts = opts || {};
  const inst    = scope.instance || {};
  const stats   = scope.stats    || {};
  const cap     = scope.capabilities || {};
  const build   = scope.build    || {};
  const version = scope.version;

  let html = '';

  if (typeof inst === 'string') {
    html += `<div class="insti-section"><h3>Instance</h3><dl class="insti-kv">${kv('host', inst)}</dl></div>`;
    html += `<div class="insti-warn">This schema was exported with an older format. Re-export using the current Background Script or Node CLI for richer instance metadata, coverage statistics, and the type catalogue.</div>`;
    return html;
  }

  html += `<div class="insti-section"><h3>Identity</h3><dl class="insti-kv">`;
  html += kv('instance name', inst.instance_name);
  html += kv('instance URL',  inst.instance_url);
  html += kv('build name',    inst.build_name);
  html += kv('build tag',     inst.build_tag);
  html += kv('build date',    inst.build_date);
  html += `</dl></div>`;

  if (inst.node_count != null || inst.active_plugins != null || inst.active_packages != null || inst.active_languages != null) {
    html += `<div class="insti-section"><h3>Runtime</h3><dl class="insti-kv">`;
    if (inst.node_count       != null) html += kv('app nodes',         inst.node_count);
    if (inst.active_plugins   != null) html += kv('active plugins',    inst.active_plugins);
    if (inst.active_packages  != null) html += kv('active packages',   inst.active_packages);
    if (inst.active_languages != null) html += kv('active languages',  inst.active_languages);
    html += `</dl></div>`;
  }

  html += `<div class="insti-section"><h3>Export</h3><dl class="insti-kv">`;
  html += kv('exported at',     inst.exported_at);
  html += kv('exported by',     inst.exported_by);
  html += kv('schema version',  version);
  if (build.builderVersion) html += kv('builder version', build.builderVersion);
  if (build.elapsedMs != null) html += kv('build time',     (build.elapsedMs / 1000).toFixed(1) + 's');
  html += `</dl></div>`;

  if (!opts.noStatCards) {
    const counts = stats.counts || {};
    const coverage = stats.coverage || {};
    const statCards = [
      { n: counts.tables,                          label: 'tables' },
      { n: counts.fields,                          label: 'fields' },
      { n: counts.references,                      label: 'references' },
      { n: counts.m2m_relationships,               label: 'M2M' },
      { n: counts.named_relationships,             label: 'named rels' },
      { n: counts.db_views,                        label: 'DB views' },
      { n: counts.view_members,                    label: 'view members' },
      { n: counts.extends_edges,                   label: 'extends' },
      { n: counts.ci_relationships,                label: 'CI topology' },
      { n: counts.unique_scopes,                   label: 'scopes' },
      { n: counts.type_catalog_entries,            label: 'type catalog' },
      { n: coverage.deepest_inheritance_chain,     label: 'deepest chain' },
      { n: coverage.avg_fields_per_table != null ? +coverage.avg_fields_per_table.toFixed(1) : null, label: 'avg fields/tbl' },
    ].filter(c => c.n != null);
    if (statCards.length) {
      html += `<div class="insti-section"><h3>Schema</h3><div class="insti-stat-grid">`;
      for (const c of statCards) {
        html += `<div class="insti-stat"><div class="insti-stat-n">${esc(c.n)}</div><div class="insti-stat-label">${esc(c.label)}</div></div>`;
      }
      html += `</div></div>`;
    }

    const rc = cap.recordCounts;
    if (rc && typeof rc === 'object' && rc.enabled) {
      html += `<div class="insti-section"><h3>Record counts</h3>`;
      html += `<dl class="insti-kv">`;
      html += kv('attempted', rc.attempted);
      html += kv('succeeded', rc.succeeded);
      if (rc.failedCount) html += kv('failed', rc.failedCount);
      html += `</dl>`;
      if (rc.partial && rc.failuresByCategory) {
        const fbc = rc.failuresByCategory;
        const parts = [];
        if (fbc.acl)          parts.push(`${fbc.acl} cross-scope ACL`);
        if (fbc.unsupported)  parts.push(`${fbc.unsupported} unsupported (virtual tables)`);
        if (fbc.script_error) parts.push(`${fbc.script_error} script errors in vtable handlers`);
        if (fbc.other)        parts.push(`${fbc.other} other`);
        html += `<div class="insti-warn"><strong>Partial coverage:</strong> ${rc.failedCount} tables could not be counted (${parts.join(', ')}). Affected tables show no record count rather than a misleading zero.</div>`;
      }
      html += `</div>`;
    } else if (rc === false || (rc && rc.enabled === false)) {
      html += `<div class="insti-section"><h3>Record counts</h3><div class="insti-warn">Record counts were not collected for this export. Re-export with the option enabled to see per-table row counts.</div></div>`;
    }
  }

  return html;
}

// Side-by-side stats comparison table rendered in diff mode.
// Columns: stat label | base value | compare value | Δ (delta)
function _statsDiffHtml(baseStats, cmpStats, esc) {
  if (!baseStats && !cmpStats) return '';
  const bc  = (baseStats && baseStats.counts)   || {};
  const cc  = (cmpStats  && cmpStats.counts)    || {};
  const bv  = (baseStats && baseStats.coverage) || {};
  const cv  = (cmpStats  && cmpStats.coverage)  || {};
  const unk = '<span class="insti-unknown">—</span>';

  const rows = [
    { label: 'tables',         b: bc.tables,               c: cc.tables },
    { label: 'fields',         b: bc.fields,               c: cc.fields },
    { label: 'references',     b: bc.references,           c: cc.references },
    { label: 'M2M',            b: bc.m2m_relationships,    c: cc.m2m_relationships },
    { label: 'named rels',     b: bc.named_relationships,  c: cc.named_relationships },
    { label: 'DB views',       b: bc.db_views,             c: cc.db_views },
    { label: 'view members',   b: bc.view_members,         c: cc.view_members },
    { label: 'extends',        b: bc.extends_edges,        c: cc.extends_edges },
    { label: 'CI topology',    b: bc.ci_relationships,     c: cc.ci_relationships },
    { label: 'scopes',         b: bc.unique_scopes,        c: cc.unique_scopes },
    { label: 'type catalog',   b: bc.type_catalog_entries, c: cc.type_catalog_entries },
    { label: 'deepest chain',  b: bv.deepest_inheritance_chain,  c: cv.deepest_inheritance_chain },
    { label: 'avg fields/tbl',
      b: bv.avg_fields_per_table != null ? +Number(bv.avg_fields_per_table).toFixed(1) : null,
      c: cv.avg_fields_per_table != null ? +Number(cv.avg_fields_per_table).toFixed(1) : null },
  ].filter(r => r.b != null || r.c != null);

  if (!rows.length) return '';

  let html = '<div class="insti-section">';
  html += '<h3>Stats comparison</h3>';
  html += '<div class="insti-sdiff">';
  // Header row
  html += '<span class="isd-lbl"></span>';
  html += '<span class="isd-h isd-h-base">Base</span>';
  html += '<span class="isd-h isd-h-cmp">Compare</span>';
  html += '<span class="isd-h isd-h-delta">Δ</span>';
  // Data rows.
  // Colour scheme: base is always muted (it's the fixed reference).
  // Compare value is coloured by direction vs base so the colour carries meaning:
  //   higher than base → diff-added green   (more coverage / more edges)
  //   lower  than base → diff-removed red   (less coverage)
  //   equal            → muted              (no change)
  //   only in compare  → diff-added green   (stat present in compare, absent in base)
  //   only in base     → compare cell shows "—" in muted
  // Delta follows the same colour as the compare value.
  for (const r of rows) {
    const bn = r.b != null ? r.b : null;
    const cn = r.c != null ? r.c : null;
    let cValCls  = 'isd-same';   // default: muted
    let deltaHtml = unk;
    let deltaCls  = 'isd-same';
    if (bn != null && cn != null) {
      const d = cn - bn;
      if      (d > 0) { cValCls = 'isd-up';   deltaHtml = '+' + d; deltaCls = 'isd-up';   }
      else if (d < 0) { cValCls = 'isd-down'; deltaHtml = '' + d;  deltaCls = 'isd-down'; }
      else            {                        deltaHtml = '=';                             }
    } else if (cn != null) {
      // stat present in compare but missing in base
      cValCls = 'isd-up';
    }
    html += `<span class="isd-lbl">${esc(r.label)}</span>`;
    html += `<span class="isd-bval">${bn != null ? esc(bn) : unk}</span>`;
    html += `<span class="isd-cval ${cValCls}">${cn != null ? esc(cn) : unk}</span>`;
    html += `<span class="isd-delta ${deltaCls}">${deltaHtml}</span>`;
  }
  html += '</div></div>';
  return html;
}

export function showInstanceInfo() {
  const overlay = document.getElementById('insti-overlay');
  const body    = document.getElementById('insti-body');
  const title   = document.getElementById('insti-title');
  if (!overlay || !body) return;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const unk = '<span class="insti-unknown">—</span>';
  const kv  = (k, v) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? unk : '<code>' + esc(v) + '</code>'}</dd>`;

  const base = {
    instance:     graphState.graphData && graphState.graphData._instance,
    stats:        graphState.graphData && graphState.graphData._stats,
    capabilities: graphState.graphData && graphState.graphData._capabilities,
    build:        graphState.graphData && graphState.graphData._build,
    version:      graphState.graphData && graphState.graphData._schema_version
  };

  const diffD = diffState._diffData;
  let html = '';

  if (diffD) {
    // Diff mode — show both schemas with banners + stats comparison table
    if (title) title.textContent = 'Schema Comparison';
    const cmpScope = {
      instance:     diffD._compareInstance,
      stats:        diffD._compareStats,
      capabilities: diffD._compareCapabilities,
      build:        diffD._compareBuild,
      version:      diffD._compareVersion,
    };
    html += '<div class="insti-banner insti-banner-base">Base schema</div>';
    html += _instanceSectionsHtml(base,     esc, kv, { noStatCards: true });
    html += '<div class="insti-banner insti-banner-compare">Compare schema</div>';
    html += _instanceSectionsHtml(cmpScope, esc, kv, { noStatCards: true });
    html += _statsDiffHtml(base.stats, diffD._compareStats, esc);
  } else {
    if (title) title.textContent = 'Instance';
    html += _instanceSectionsHtml(base, esc, kv);
  }

  body.innerHTML = html;
  overlay.classList.add('is-open');
}

(function wireInstanceModal() {
  function attach() {
    const overlay = document.getElementById('insti-overlay');
    const pill    = document.getElementById('footer-instance');
    const closeBtn = document.getElementById('insti-close');
    if (!overlay || !pill || !closeBtn) return;
    pill.addEventListener('click', showInstanceInfo);
    closeBtn.addEventListener('click', () => overlay.classList.remove('is-open'));
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('is-open');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
        overlay.classList.remove('is-open');
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();

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
  'updateActiveFilter', 'syncLegendRows',
  'selectNode', 'clearSel', 'fillInspector', 'showCtx',
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
  if (modeRenderer) { modeRenderer(); return; }
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
  let cxSum = 0, cySum = 0;
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

  const simNodes = visNodes.map(n => {
    const clone = {...n};
    if (typeof clone.x !== 'number' || typeof clone.y !== 'number') {
      const angle = Math.random() * 2 * Math.PI;
      const dist  = 80 + Math.random() * 120;
      clone.x = cx + Math.cos(angle) * dist;
      clone.y = cy + Math.sin(angle) * dist;
    }
    clone._hopDist = (hopDist && hopDist[n.id]) ?? 0;
    return clone;
  });
  const simEdges = visEdges.map(e => ({...e}));

  const NW_SIM   = 174;
  const NH_BASE_SIM = 36;
  const F_ROW_H_SIM = 22;
  const F_PAD_SIM   = 6;

  function nodeRadius(d) {
    const hasFields = uiState.showFields && d.fields?.length &&
      (uiState.connectedNodes.size === 0 || uiState.connectedNodes.has(d.id));
    const h = hasFields
      ? NH_BASE_SIM + F_PAD_SIM + d.fields.length * F_ROW_H_SIM + F_PAD_SIM
      : NH_BASE_SIM;
    return Math.sqrt((NW_SIM/2)**2 + (h/2)**2) + 6;
  }

  const edgeDensity = N > 0 ? simEdges.length / N : 0;

  const chargeMag = large
    ? Math.max(-80, -320 + N * 0.5)
    : Math.min(-800, -(320 + edgeDensity * 60)) * (uiState.showFields ? 1.6 : 1);

  const decay    = large
    ? Math.min(0.1, 0.03 + N * 0.00015)
    : 0.02;

  const linkDist = large ? 70 : (d => {
    const lt = Config.sim.linkDistance;
    if (d.type==='extends') return lt.extends;
    if (d.type==='m2m')     return lt.m2m;
    if (d.type==='view')    return lt.view;
    return lt.ref;
  });
  const linkStr  = large ? Config.sim.linkStrength.large : Config.sim.linkStrength.small;

  if (graphState.simulation) graphState.simulation.stop();

  const lpBar  = Dom.layoutProgress;
  const lpFill = Dom.layoutProgressFill;
  const simCtrl = Dom.simControls;
  lpBar.style.display = 'block';
  lpFill.style.width  = '0%';
  simCtrl.classList.add('visible');

  const startAlpha = mostlyPositioned ? 0.1  : 1.0;
  const fastDecay  = mostlyPositioned ? 0.25 : decay;

  graphState.simulation = d3.forceSimulation(simNodes)
    .alpha(startAlpha)
    .force('link',      d3.forceLink(simEdges).id(d=>d.id)
                          .distance(linkDist).strength(linkStr))
    .force('charge',    d3.forceManyBody().strength(chargeMag)
                          .distanceMax(large ? 300 : 1400))
    .force('center',    d3.forceCenter(0, 0))
    .force('collision', d3.forceCollide(d => nodeRadius(d) + 4)
                          .iterations(large ? 2 : 6))
    .alphaDecay(fastDecay)
    .alphaMin(SETTLE_ALPHA)
    .velocityDecay(large ? Config.sim.velocityDecay.large : Config.sim.velocityDecay.small);

  // Radial force — only when a node is selected. Gently pushes nodes outward
  // in concentric rings by hop distance so deeper nodes stay visually outside
  // shallower ones. strength(0.15) is soft enough not to override link/charge forces.
  const R_HOP = 150; // px per hop ring
  if (uiState.selectedNode) {
    graphState.simulation.force('radial',
      d3.forceRadial(d => (d._hopDist ?? 0) * R_HOP, 0, 0).strength(0.15)
    );
  }

  if (!mostlyPositioned) {
    const preWarm = large
      ? Math.min(60, Math.floor(N / 5))
      : Math.min(120, 20 + Math.floor(edgeDensity * 15));
    for (let i = 0; i < preWarm; i++) graphState.simulation.tick();
  }

  tagRefDirection(simEdges, uiState.selectedNode);
  const edgeG  = root.append('g').attr('class','edges');

  const { fanOffset, fanVisible } = buildFanOffsets(
    simEdges, Config.geomForce.fanStep, Config.geomForce.maxFan
  );

  const edgeSel = edgeG.selectAll('path').data(simEdges).join('path')
    .attr('class',      d => edgeClass(d))
    .attr('id',         (_,i) => `ep-${i}`)
    .style('display',   'none');
  edgeSel.append('title').text(d => {
    if (d._count <= 1) return d.label || d.field || '';
    const labels = d._fieldLabels || [];
    const names  = d._fields || [];
    const pairs  = labels.map((lbl, i) => names[i] ? `${lbl} (${names[i]})` : lbl);
    return `${d._count} fields:\n${pairs.map(p => `• ${p}`).join('\n')}`;
  });

  const nodeG = root.append('g').attr('class','nodes');

  const labelG = root.append('g').attr('class','edge-labels');
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

    labelSel = labelG.selectAll('text').data(simEdges).join('text')
      .attr('class','edge-label')
      .attr('text-anchor','middle')
      .attr('dy', -4)
      .style('display', (_, i) => labelVisible.has(i) ? null : 'none')
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

  const NW       = Config.geomForce.nodeWidth;
  const NH_BASE  = 36;
  const F_ROW_H  = 22;
  const F_PAD    = 6;

  function nHeight(d) {
    const fieldsVisible = uiState.showFields && d.fields?.length &&
      (uiState.connectedNodes.size === 0 || uiState.connectedNodes.has(d.id));
    if (!fieldsVisible) return NH_BASE;
    return NH_BASE + F_PAD + d.fields.length * F_ROW_H + F_PAD;
  }

  const HW = NW/2;
  function nodeHH(d) { return nHeight(d)/2; }
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
    return _fg.edgePath(src.x, src.y, tgt.x, tgt.y,
      nodeHH(src), nodeHH(tgt), offset);
  }
  function bezierMid(d, offset) {
    const flipped = isCmdbRelFlipped(d);
    const src = flipped ? d.target : d.source;
    const tgt = flipped ? d.source : d.target;
    return _fg.bezierMid(src.x, src.y, tgt.x, tgt.y,
      nodeHH(src), nodeHH(tgt), offset);
  }

  function updateEdges() {
    edgeSel.each(function(d, i) {
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
    if (labelSel) {
      labelSel.each(function(d,i) {
        const p = edgePath(d, fanOffset[i]);
        if (!p) return;
        const mid = bezierMid(d, fanOffset[i]);
        d3.select(this).attr('x',mid.x).attr('y',mid.y-5);
      });
    }
  }

  const nodeSel = nodeG.selectAll('g.node-group').data(simNodes).join('g')
    .attr('class', d => `node-group${d.core?' core':''}`)
    .call(d3.drag()
      .on('start',(e,d)=>{ if(!e.active) graphState.simulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag', (e,d)=>{ d.fx=e.x; d.fy=e.y; })
      .on('end',  (e,d)=>{ if(!e.active) graphState.simulation.alphaTarget(0); d.fx=null; d.fy=null; updateEdges(); })
    )
    .on('click',       (e,d)=>{ e.stopPropagation(); _renderImports && _renderImports.selectNode(d, nodeSel, edgeSel); })
    .on('contextmenu', (e,d)=>{ e.preventDefault(); _renderImports && _renderImports.showCtx(e,d); })
    .on('mouseover',   (e,d)=>{
      if (!Settings.isEnabled('dimOnHover') || uiState.selectedNode) return;
      const id = d.id;
      const neighbours = new Set([id]);
      const _hAdj = graphState.graphData._adj;
      if (_hAdj) {
        const na = _hAdj.get(id) || { out: [], in: [] };
        for (const e of na.out) { const t = e.target?.id ?? e.target; neighbours.add(t); }
        for (const e of na.in)  { const s = e.source?.id ?? e.source; neighbours.add(s); }
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

  nodeSel.append('rect').attr('class','node-rect')
    .attr('width', NW)
    .attr('height', d => nHeight(d))
    .attr('x', -NW/2)
    .attr('y', d => -nHeight(d)/2);

  nodeSel.append('rect').attr('class','node-header')
    .attr('width', NW).attr('height', NH_BASE)
    .attr('x', -NW/2).attr('y', d => -nHeight(d)/2)
    .attr('rx', 6).attr('ry', 6)
    .attr('fill','rgba(0,0,0,.22)').attr('pointer-events','none');

  nodeSel.append('circle').attr('r',4)
    .attr('cx', -NW/2+12)
    .attr('cy', d => -nHeight(d)/2 + NH_BASE/2)
    .attr('fill', d=>nodeColor(d));

  nodeSel.append('text').attr('class','node-label')
    .attr('x', -NW/2+22)
    .attr('y', d => -nHeight(d)/2 + NH_BASE/2 - 5)
    .style('display', uiState.compactMode ? 'none' : null)
    .text(d => d.label.length>17 ? d.label.slice(0,16)+'…' : d.label);

  nodeSel.append('text').attr('class','node-scope')
    .attr('x', -NW/2+22)
    .attr('y', d => -nHeight(d)/2 + NH_BASE/2 + 8)
    .style('display', uiState.compactMode ? 'none' : null)
    .text(d => d.id.length>20 ? d.id.slice(0,19)+'…' : d.id);

  if (uiState.showFields) {
    nodeSel.each(function(d) {
      if (!d.fields?.length) return;
      if (uiState.connectedNodes.size > 0 && !uiState.connectedNodes.has(d.id)) return;
      const g = d3.select(this);
      const topY = -nHeight(d)/2;

      g.append('line').attr('class','node-field-sep')
        .attr('x1',-NW/2+6).attr('x2',NW/2-6)
        .attr('y1', topY + NH_BASE).attr('y2', topY + NH_BASE)
        .attr('stroke','var(--border)').attr('stroke-width',1)
        .attr('pointer-events','none');

      d.fields.forEach((f, i) => {
        const fy = topY + NH_BASE + F_PAD + i * F_ROW_H;
        const tc = typeBadgeColor(f.type);
        const typeShort = f.type.length>8 ? f.type.slice(0,7)+'…' : f.type;
        const nameShort = f.name.length>16 ? f.name.slice(0,15)+'…' : f.name;
        const labelShort = f.label.length>18 ? f.label.slice(0,17)+'…' : f.label;

        g.append('rect')
          .attr('x', NW/2-52).attr('y', fy+3)
          .attr('width',48).attr('height',12).attr('rx',2)
          .attr('fill','rgba(0,0,0,.35)').attr('pointer-events','none');

        g.append('text').attr('class','node-field-name')
          .attr('x',-NW/2+8).attr('y', fy + 10)
          .attr('fill','var(--text)')
          .text(nameShort);

        g.append('text').attr('class','node-field-label-sub')
          .attr('x',-NW/2+8).attr('y', fy + 20)
          .attr('fill','var(--muted)')
          .attr('font-size','7.5px')
          .attr('font-family', "'JetBrains Mono', ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace")
          .attr('pointer-events','none')
          .text(labelShort);

        g.append('text').attr('class','node-field-type')
          .attr('x', NW/2-4).attr('y', fy + 11)
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
    lpFill.style.width  = '100%';
    simCtrl.classList.remove('visible');

    const _snNb = graphState.graphData._nodeById;
    simNodes.forEach(sn => {
      const gn = _snNb ? _snNb.get(sn.id) : graphState.graphData.nodes.find(n => n.id === sn.id);
      if (gn) { gn.x = sn.x; gn.y = sn.y; }
    });

    {
      const PAD   = 8;
      const ITERS = 30;

      for (let iter = 0; iter < ITERS; iter++) {
        let moved = false;
        for (let i = 0; i < simNodes.length; i++) {
          for (let j = i + 1; j < simNodes.length; j++) {
            const a = simNodes[i], b = simNodes[j];
            const aW = NW / 2 + PAD / 2, aH = nHeight(a) / 2 + PAD / 2;
            const bW = NW / 2 + PAD / 2, bH = nHeight(b) / 2 + PAD / 2;
            const dx = b.x - a.x, dy = b.y - a.y;
            const overlapX = aW + bW - Math.abs(dx);
            const overlapY = aH + bH - Math.abs(dy);
            if (overlapX <= 0 || overlapY <= 0) continue;
            moved = true;
            if (overlapX < overlapY) {
              const push = overlapX / 2;
              if (dx >= 0) { a.x -= push; b.x += push; }
              else         { a.x += push; b.x -= push; }
            } else {
              const push = overlapY / 2;
              if (dy >= 0) { a.y -= push; b.y += push; }
              else         { a.y += push; b.y -= push; }
            }
          }
        }
        if (!moved) break;
      }
    }

    updateEdges();
    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);

    nodeSel
      .on('click',       (e,d) => { e.stopPropagation(); _renderImports && _renderImports.selectNode(d, nodeSel, edgeSel); })
      .on('contextmenu', (e,d) => { e.preventDefault(); _renderImports && _renderImports.showCtx(e,d); });
    svg.on('click', () => _renderImports && _renderImports.clearSel(nodeSel, edgeSel));

    fitGraph();

    if (uiState.selectedNode) {
      const _selNb = graphState.graphData._nodeById;
      const d = _selNb ? _selNb.get(uiState.selectedNode)
                       : graphState.graphData.nodes.find(n => n.id === uiState.selectedNode);
      if (d) {
        nodeSel.classed('selected', n => n.id === uiState.selectedNode);
        edgeSel.classed('highlighted', e => {
          const s=e.source?.id??e.source, t=e.target?.id??e.target;
          return s===uiState.selectedNode||t===uiState.selectedNode;
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

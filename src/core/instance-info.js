/**
 * Instance-info footer pill + modal — extracted from engine/render.js (#73).
 *
 * Renders the footer instance pill (updateInstancePill) and the instance-details
 * overlay (showInstanceInfo), including the diff-mode side-by-side stats
 * comparison table. Pure DOM / string building; reads the graphState/diffState
 * singletons. No coupling to the canvas render path — render.js re-exports
 * updateInstancePill / showInstanceInfo so existing importers are unaffected.
 */
import { graphState, diffState } from './state.js';

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
      try {
        n = new URL(n).hostname.split('.')[0];
      } catch (_) {}
    }
    return n;
  }
  function buildLabel(x) {
    if (!x || typeof x === 'string') return '';
    return x.build_name || x.build_tag || '';
  }
  const nameEl = document.getElementById('footer-instance-name');
  const buildEl = document.getElementById('footer-instance-build');
  const cmpInst = diffState._diffData && diffState._diffData._compareInstance;
  if (cmpInst) {
    nameEl.textContent = shortLabel(inst) + ' → ' + shortLabel(cmpInst);
    buildEl.textContent = '';
  } else {
    nameEl.textContent = shortLabel(inst);
    const b = buildLabel(inst);
    buildEl.textContent = b ? '· ' + b : '';
  }
  pill.classList.add('is-visible');
}

// opts.noStatCards — suppress the schema stat-card grid (used in diff mode where
//                    the stats comparison table already covers this information)
function _instanceSectionsHtml(scope, esc, kv, opts) {
  opts = opts || {};
  const inst = scope.instance || {};
  const stats = scope.stats || {};
  const cap = scope.capabilities || {};
  const build = scope.build || {};
  const version = scope.version;

  let html = '';

  if (typeof inst === 'string') {
    html += `<div class="insti-section"><h3>Instance</h3><dl class="insti-kv">${kv('host', inst)}</dl></div>`;
    html += `<div class="insti-warn">This schema was exported with an older format. Re-export using the current Background Script or Node CLI for richer instance metadata, coverage statistics, and the type catalogue.</div>`;
    return html;
  }

  html += `<div class="insti-section"><h3>Identity</h3><dl class="insti-kv">`;
  html += kv('instance name', inst.instance_name);
  html += kv('instance URL', inst.instance_url);
  html += kv('build name', inst.build_name);
  html += kv('build tag', inst.build_tag);
  html += kv('build date', inst.build_date);
  html += `</dl></div>`;

  if (
    inst.node_count != null ||
    inst.active_plugins != null ||
    inst.active_packages != null ||
    inst.active_languages != null
  ) {
    html += `<div class="insti-section"><h3>Runtime</h3><dl class="insti-kv">`;
    if (inst.node_count != null) html += kv('app nodes', inst.node_count);
    if (inst.active_plugins != null) html += kv('active plugins', inst.active_plugins);
    if (inst.active_packages != null) html += kv('active packages', inst.active_packages);
    if (inst.active_languages != null) html += kv('active languages', inst.active_languages);
    html += `</dl></div>`;
  }

  html += `<div class="insti-section"><h3>Export</h3><dl class="insti-kv">`;
  html += kv('exported at', inst.exported_at);
  html += kv('exported by', inst.exported_by);
  html += kv('schema version', version);
  if (build.builderVersion) html += kv('builder version', build.builderVersion);
  if (build.elapsedMs != null) html += kv('build time', (build.elapsedMs / 1000).toFixed(1) + 's');
  html += `</dl></div>`;

  if (!opts.noStatCards) {
    const counts = stats.counts || {};
    const coverage = stats.coverage || {};
    const statCards = [
      { n: counts.tables, label: 'tables' },
      { n: counts.fields, label: 'fields' },
      { n: counts.references, label: 'references' },
      { n: counts.m2m_relationships, label: 'M2M' },
      { n: counts.named_relationships, label: 'named rels' },
      { n: counts.db_views, label: 'DB views' },
      { n: counts.view_members, label: 'view members' },
      { n: counts.extends_edges, label: 'extends' },
      { n: counts.ci_relationships, label: 'CI topology' },
      { n: counts.unique_scopes, label: 'scopes' },
      { n: counts.type_catalog_entries, label: 'type catalog' },
      { n: coverage.deepest_inheritance_chain, label: 'deepest chain' },
      {
        n: coverage.avg_fields_per_table != null ? +coverage.avg_fields_per_table.toFixed(1) : null,
        label: 'avg fields/tbl',
      },
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
        if (fbc.acl) parts.push(`${fbc.acl} cross-scope ACL`);
        if (fbc.unsupported) parts.push(`${fbc.unsupported} unsupported (virtual tables)`);
        if (fbc.script_error) parts.push(`${fbc.script_error} script errors in vtable handlers`);
        if (fbc.other) parts.push(`${fbc.other} other`);
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
  const bc = (baseStats && baseStats.counts) || {};
  const cc = (cmpStats && cmpStats.counts) || {};
  const bv = (baseStats && baseStats.coverage) || {};
  const cv = (cmpStats && cmpStats.coverage) || {};
  const unk = '<span class="insti-unknown">—</span>';

  const rows = [
    { label: 'tables', b: bc.tables, c: cc.tables },
    { label: 'fields', b: bc.fields, c: cc.fields },
    { label: 'references', b: bc.references, c: cc.references },
    { label: 'M2M', b: bc.m2m_relationships, c: cc.m2m_relationships },
    { label: 'named rels', b: bc.named_relationships, c: cc.named_relationships },
    { label: 'DB views', b: bc.db_views, c: cc.db_views },
    { label: 'view members', b: bc.view_members, c: cc.view_members },
    { label: 'extends', b: bc.extends_edges, c: cc.extends_edges },
    { label: 'CI topology', b: bc.ci_relationships, c: cc.ci_relationships },
    { label: 'scopes', b: bc.unique_scopes, c: cc.unique_scopes },
    { label: 'type catalog', b: bc.type_catalog_entries, c: cc.type_catalog_entries },
    { label: 'deepest chain', b: bv.deepest_inheritance_chain, c: cv.deepest_inheritance_chain },
    {
      label: 'avg fields/tbl',
      b: bv.avg_fields_per_table != null ? +Number(bv.avg_fields_per_table).toFixed(1) : null,
      c: cv.avg_fields_per_table != null ? +Number(cv.avg_fields_per_table).toFixed(1) : null,
    },
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
    let cValCls = 'isd-same'; // default: muted
    let deltaHtml = unk;
    let deltaCls = 'isd-same';
    if (bn != null && cn != null) {
      const d = cn - bn;
      if (d > 0) {
        cValCls = 'isd-up';
        deltaHtml = '+' + d;
        deltaCls = 'isd-up';
      } else if (d < 0) {
        cValCls = 'isd-down';
        deltaHtml = '' + d;
        deltaCls = 'isd-down';
      } else {
        deltaHtml = '=';
      }
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
  const body = document.getElementById('insti-body');
  const title = document.getElementById('insti-title');
  if (!overlay || !body) return;

  const esc = s =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const unk = '<span class="insti-unknown">—</span>';
  const kv = (k, v) =>
    `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? unk : '<code>' + esc(v) + '</code>'}</dd>`;

  const base = {
    instance: graphState.graphData && graphState.graphData._instance,
    stats: graphState.graphData && graphState.graphData._stats,
    capabilities: graphState.graphData && graphState.graphData._capabilities,
    build: graphState.graphData && graphState.graphData._build,
    version: graphState.graphData && graphState.graphData._schema_version,
  };

  const diffD = diffState._diffData;
  let html = '';

  if (diffD) {
    // Diff mode — show both schemas with banners + stats comparison table
    if (title) title.textContent = 'Schema Comparison';
    const cmpScope = {
      instance: diffD._compareInstance,
      stats: diffD._compareStats,
      capabilities: diffD._compareCapabilities,
      build: diffD._compareBuild,
      version: diffD._compareVersion,
    };
    html += '<div class="insti-banner insti-banner-base">Base schema</div>';
    html += _instanceSectionsHtml(base, esc, kv, { noStatCards: true });
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
    const pill = document.getElementById('footer-instance');
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

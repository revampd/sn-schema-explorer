/**
 * Instance-info footer pill + modal — extracted from engine/render.js (#73).
 *
 * Renders the footer instance pill (updateInstancePill) and the instance-details
 * overlay (showInstanceInfo), including the diff-mode side-by-side stats
 * comparison table. Pure DOM / string building; reads the graphState/diffState
 * singletons. No coupling to the canvas render path — render.js re-exports
 * updateInstancePill / showInstanceInfo so existing importers are unaffected.
 */
import { graphState, diffState, getInstance, instancesState } from './state.js';

// ── Shared HTML primitives ──────────────────────────────────────────────────
export const esc = s =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const unk = '<span class="insti-unknown">—</span>';
const kv = (k, v) =>
  `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? unk : '<code>' + esc(v) + '</code>'}</dd>`;

// Schema stat rows — single source of truth shared by the stat-card grid, the
// 2-way diff table (modal), and the N-way comparison table (Configuration Data).
// `get(stats)` reads a value out of a `_stats` object ({counts, coverage}).
const STAT_ROWS = [
  { label: 'tables', get: s => s.counts.tables },
  { label: 'fields', get: s => s.counts.fields },
  { label: 'references', get: s => s.counts.references },
  { label: 'M2M', get: s => s.counts.m2m_relationships },
  { label: 'named rels', get: s => s.counts.named_relationships },
  { label: 'DB views', get: s => s.counts.db_views },
  { label: 'view members', get: s => s.counts.view_members },
  { label: 'extends', get: s => s.counts.extends_edges },
  { label: 'CI topology', get: s => s.counts.ci_relationships },
  { label: 'scopes', get: s => s.counts.unique_scopes },
  { label: 'type catalog', get: s => s.counts.type_catalog_entries },
  { label: 'deepest chain', get: s => s.coverage.deepest_inheritance_chain },
  {
    label: 'avg fields/tbl',
    get: s =>
      s.coverage.avg_fields_per_table != null
        ? +Number(s.coverage.avg_fields_per_table).toFixed(1)
        : null,
  },
];

// Safe stat accessor — tolerates missing counts/coverage sub-objects.
function statVal(stats, row) {
  if (!stats) return null;
  const s = { counts: stats.counts || {}, coverage: stats.coverage || {} };
  const v = row.get(s);
  return v == null ? null : v;
}

export function updateInstancePill() {
  const pill = document.getElementById('footer-instance');
  if (!pill) return;
  // A tool view owns the chip — drop the landing roster styling (landing repopulates
  // it when the workspace switches back).
  pill.classList.remove('footer-instance--roster');
  const inst = graphState.graphData && graphState.graphData._instance;
  if (!inst) {
    pill.classList.remove('is-visible');
    pill.title = 'Click to view full instance details';
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
  // While comparing, one chip captures the whole set: base → each compare. The
  // visible text ellipsis-truncates; the full list is in the tooltip.
  const cmpIds = (diffState._compareIds || []).filter(Boolean);
  if (cmpIds.length) {
    const names = cmpIds.map(id => getInstance(id)?.label || id);
    nameEl.textContent = shortLabel(inst) + ' → ' + names.join(', ');
    buildEl.textContent = '';
    pill.title = 'Comparing ' + shortLabel(inst) + ' against: ' + names.join(', ');
  } else {
    nameEl.textContent = shortLabel(inst);
    const b = buildLabel(inst);
    buildEl.textContent = b ? '· ' + b : '';
    pill.title = 'Click to view full instance details';
  }
  pill.classList.add('is-visible');
}

// opts.noStatCards — suppress the schema stat-card grid (used in diff mode where
//                    the stats comparison table already covers this information)
export function instanceSectionsHtml(scope, opts) {
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
    const statCards = STAT_ROWS.map(r => ({ n: statVal(stats, r), label: r.label })).filter(
      c => c.n != null
    );
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
function _statsDiffHtml(baseStats, cmpStats) {
  if (!baseStats && !cmpStats) return '';

  const rows = STAT_ROWS.map(r => ({
    label: r.label,
    b: statVal(baseStats, r),
    c: statVal(cmpStats, r),
  })).filter(r => r.b != null || r.c != null);

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

// ── N-way comparison (Configuration Data → Instance Data tab) ────────────────

function scopeLabel(scope, i) {
  return scope.label || (scope.instance && scope.instance.instance_name) || 'Instance ' + (i + 1);
}

// Identity / Runtime / Export attribute groups for the comparison table.
// Each accessor reads from a normalised scope ({ instance, build, version }).
const INFO_GROUPS = [
  {
    title: 'Identity',
    rows: [
      ['instance name', s => s.instance.instance_name],
      ['instance URL', s => s.instance.instance_url],
      ['build name', s => s.instance.build_name],
      ['build tag', s => s.instance.build_tag],
      ['build date', s => s.instance.build_date],
    ],
  },
  {
    title: 'Runtime',
    rows: [
      ['app nodes', s => s.instance.node_count],
      ['active plugins', s => s.instance.active_plugins],
      ['active packages', s => s.instance.active_packages],
      ['active languages', s => s.instance.active_languages],
    ],
  },
  {
    title: 'Export',
    rows: [
      ['exported at', s => s.instance.exported_at],
      ['exported by', s => s.instance.exported_by],
      ['schema version', s => s.version],
      ['builder version', s => s.build && s.build.builderVersion],
      [
        'build time',
        s =>
          s.build && s.build.elapsedMs != null ? (s.build.elapsedMs / 1000).toFixed(1) + 's' : null,
      ],
    ],
  },
];

const hasVal = v => v != null && v !== '';

/**
 * Full instance-comparison panel for an arbitrary number of instances, rendered
 * as ONE aligned table: attribute rows × instance columns. Column 0 is the muted
 * reference (base); schema-stat columns are coloured by direction vs base with an
 * inline delta. Identity/runtime/export rows are plain text. A single table keeps
 * every row aligned across columns (independent per-instance blocks did not) and
 * scrolls horizontally past the container width. Pure HTML; `scopes` is an array
 * of { label, loaded, instance, stats, build, version }. Un-loaded placeholders
 * still show identity/runtime from their persisted `instance` metadata and are
 * blank in the stats rows.
 */
export function instancesComparisonHtml(scopes) {
  if (!scopes || !scopes.length) return '';
  const norm = scopes.map((sc, i) => ({
    loaded: sc.loaded,
    stats: sc.stats,
    build: sc.build,
    version: sc.version,
    instance: sc.instance && typeof sc.instance === 'object' ? sc.instance : {},
    _label: scopeLabel(sc, i),
  }));
  const ncol = norm.length + 1;

  let html = '<div class="insti-section"><div class="insti-ntable-wrap">';
  html += '<table class="insti-ntable insti-compare"><thead><tr><th></th>';
  norm.forEach((s, i) => {
    const note = s.loaded ? '' : '<span class="insti-unknown"> · meta only</span>';
    html += `<th class="${i === 0 ? 'isd-h-base' : 'isd-h-cmp'}">${esc(s._label)}${note}</th>`;
  });
  html += '</tr></thead><tbody>';

  // Identity / Runtime / Export — plain text, only groups/rows with any value.
  for (const g of INFO_GROUPS) {
    const rows = g.rows.filter(([, get]) => norm.some(s => hasVal(get(s))));
    if (!rows.length) continue;
    html += `<tr class="insti-grp"><td colspan="${ncol}">${esc(g.title)}</td></tr>`;
    for (const [label, get] of rows) {
      html += `<tr><td class="isd-lbl">${esc(label)}</td>`;
      norm.forEach(s => {
        const v = get(s);
        html += `<td class="insti-txt">${hasVal(v) ? esc(v) : unk}</td>`;
      });
      html += '</tr>';
    }
  }

  // Schema stats — coloured by direction vs base, with inline deltas.
  const statRows = STAT_ROWS.map(r => ({
    label: r.label,
    vals: norm.map(s => statVal(s.stats, r)),
  })).filter(r => r.vals.some(v => v != null));
  if (statRows.length) {
    html += `<tr class="insti-grp"><td colspan="${ncol}">Schema stats</td></tr>`;
    for (const r of statRows) {
      html += `<tr><td class="isd-lbl">${esc(r.label)}</td>`;
      const baseVal = r.vals[0];
      r.vals.forEach((v, i) => {
        if (i === 0) {
          html += `<td class="isd-bval">${v != null ? esc(v) : unk}</td>`;
          return;
        }
        let cls = 'isd-same';
        let delta = '';
        if (v != null && baseVal != null) {
          const d = v - baseVal;
          if (d > 0) cls = 'isd-up';
          else if (d < 0) cls = 'isd-down';
          if (d !== 0) delta = ` <span class="isd-delta-inline">(${d > 0 ? '+' : ''}${d})</span>`;
        } else if (v != null && baseVal == null) {
          cls = 'isd-up';
        }
        html += `<td class="isd-cval ${cls}">${v != null ? esc(v) + delta : unk}</td>`;
      });
      html += '</tr>';
    }
  }

  html += '</tbody></table></div></div>';
  return html;
}

export function showInstanceInfo() {
  const overlay = document.getElementById('insti-overlay');
  const body = document.getElementById('insti-body');
  const title = document.getElementById('insti-title');
  if (!overlay || !body) return;

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
    html += instanceSectionsHtml(base, { noStatCards: true });
    html += '<div class="insti-banner insti-banner-compare">Compare schema</div>';
    html += instanceSectionsHtml(cmpScope, { noStatCards: true });
    html += _statsDiffHtml(base.stats, diffD._compareStats);
  } else {
    if (title) title.textContent = 'Instance';
    html += instanceSectionsHtml(base);
  }

  body.innerHTML = html;
  overlay.classList.add('is-open');
}

// All-instances overview — opened from the landing footer roster chip, where no
// single instance is selected. Reuses the shared SIDE-BY-SIDE comparison table
// (instancesComparisonHtml): attribute rows × instance columns, so instances are
// compared at a glance rather than stacked (no scroll-down). Same renderer the
// Configuration Data N-way comparison uses.
export function showInstancesRoster() {
  const overlay = document.getElementById('insti-overlay');
  const body = document.getElementById('insti-body');
  const title = document.getElementById('insti-title');
  if (!overlay || !body) return;
  const insts = instancesState.instances || [];
  if (!insts.length) return;
  if (title) title.textContent = insts.length + (insts.length === 1 ? ' instance' : ' instances');
  const scopes = insts.map(e => ({
    label: e.label,
    loaded: !!e.data,
    instance: e.data && e.data._instance,
    stats: e.data && e.data._stats,
    build: e.data && e.data._build,
    version: e.data && e.data._schema_version,
  }));
  body.innerHTML = instancesComparisonHtml(scopes);
  overlay.classList.add('is-open');
}

(function wireInstanceModal() {
  function attach() {
    const overlay = document.getElementById('insti-overlay');
    const pill = document.getElementById('footer-instance');
    const closeBtn = document.getElementById('insti-close');
    if (!overlay || !pill || !closeBtn) return;
    pill.addEventListener('click', () => {
      // On the landing page the chip is a roster of all instances; elsewhere it's
      // the active instance (/comparison).
      if (pill.classList.contains('footer-instance--roster')) showInstancesRoster();
      else showInstanceInfo();
    });
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

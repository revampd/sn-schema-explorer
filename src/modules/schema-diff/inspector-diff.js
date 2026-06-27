/**
 * Unified N-column comparison inspector (#150).
 *
 * Renders the inspector for a table while a comparison is active, as a matrix that
 * scales from one compare (the classic Base | Compare diff) up to N compares (one
 * column per selected instance). It consumes the diff matrix (`diffState._diffMatrix`
 * — one pairwise diff per compare, primary first; see compute-matrix.js) so it
 * stays in lock-step with the canvas, which keys off the primary (`_diffData`).
 *
 * Sections, all column-aware:
 *   • a column-status strip (Base + one chip per compare),
 *   • a Fields matrix (row per field, cell per column, diff-coloured vs Base),
 *   • Relationship changes (grouped per compare),
 *   • Configuration drift (per compare; pairwise resolver reused per column).
 *
 * Registered as the fill-inspector hook by index.js. Returns false — so the rich
 * single-subject inspector (core/inspector.js) renders — when the focused table is
 * identical across every compare and has no config drift (#150: N=1 keeps the rich
 * view; comparison-only content lives here).
 */
import { uiState, diffState, instancesState, getInstance, isComparing } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { typeLabel } from '../../core/render.js';
import { Settings } from '../settings/index.js';
import { focusTable, clearSelection } from '../../core/inspector.js';
import { makeConfigDrift } from './config-drift.js';
import { STATUS_LABELS } from '../config-data/reconcile.js';

const el = (tag, cls) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};
const setText = (e, t) => {
  e.textContent = t;
  return e;
};

// Per-compare status of a table within one pairwise diff.
function tableStatus(diff, id) {
  if (diff.added.has(id)) return 'added';
  if (diff.removed.has(id)) return 'removed';
  if (diff.changed.has(id)) return 'changed';
  if (diff.baseMap.has(id) && diff.compareMap.has(id)) return 'same';
  return 'absent';
}

// Column-header / status-chip colour by the table's status in that instance.
// `same` (identical) reads GREEN — in sync — not the neutral/amber it used to.
const COL_STATUS_CLASS = {
  base: 'cstat-base',
  same: 'cstat-same',
  added: 'cstat-added',
  removed: 'cstat-removed',
  changed: 'cstat-changed',
  absent: 'cstat-absent',
};
const STATUS_TEXT = {
  added: '+ added',
  removed: '− removed',
  changed: '~ changed',
  same: 'identical',
  absent: '— absent',
};

// Friendly relationship grouping — mirrors the edge-type legend + the single
// inspector's relationship sections, including reference direction. Raw edge
// types ('reference', 'rel', 'm2m') are never shown to the user.
const EDGE_ORDER = [
  'reference_out',
  'reference_in',
  'extends_out',
  'extends_in',
  'm2m',
  'rel',
  'view',
  'cmdb_rel',
];
const EDGE_LABEL = {
  reference_out: 'Reference to',
  reference_in: 'Referenced by',
  extends_out: 'Inheritance (extends)',
  extends_in: 'Child tables',
  m2m: 'M2M junction',
  rel: 'Named relationship',
  view: 'DB view member',
  cmdb_rel: 'CI topology',
};
function edgeKind(e, tableId) {
  const s = typeof e.source === 'object' ? e.source.id : e.source;
  const out = s === tableId;
  if (e.type === 'reference') return out ? 'reference_out' : 'reference_in';
  if (e.type === 'extends') return out ? 'extends_out' : 'extends_in';
  return e.type;
}

// Set a grid to N equal columns (the .diff-sbs base style is a 2-col grid).
function setCols(node, n) {
  node.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  return node;
}

export function diffFillInspector(d) {
  if (!isComparing() || uiState.viewMode !== 'force') return false;
  const matrix = diffState._diffMatrix;
  if (!matrix || !matrix.length) return false;

  const tableId = typeof d === 'object' ? d.id : d;

  // Column model: Base first, then one column per compare (matrix order).
  const baseLabel = getInstance(instancesState.selectedId)?.label || 'Base';
  const baseData = getInstance(instancesState.selectedId)?.data || null;
  const cols = [
    { id: '__base__', label: baseLabel, kind: 'base', data: baseData, status: 'base' },
    ...matrix.map(diff => ({
      id: diff._compareId,
      label: diff._compareLabel || diff._compareId,
      kind: 'compare',
      diff,
      data: getInstance(diff._compareId)?.data || null,
      status: tableStatus(diff, tableId),
    })),
  ];

  const baseNode = matrix[0].baseMap.get(tableId) || null;
  const displayNode = baseNode || matrix.map(m => m.compareMap.get(tableId)).find(Boolean) || null;
  const scope = displayNode?.scope || (typeof d === 'object' ? d.scope : null);

  // Config drift per compare (pairwise resolver reused per column — config stays
  // pairwise base-vs-each by design; see memory: per-layer-comparison-reference).
  const cfgByCompare = new Map();
  let anyConfig = false;
  for (const diff of matrix) {
    const cmpData = getInstance(diff._compareId)?.data;
    const entry = scope ? makeConfigDrift(baseData, cmpData).forScope(scope) : null;
    cfgByCompare.set(diff._compareId, entry);
    if (entry) anyConfig = true;
  }

  const differsAnywhere = cols.some(
    c => c.kind === 'compare' && c.status !== 'same' && c.status !== 'absent'
  );
  // Identical across every compare AND no config drift → let the rich inspector render.
  if (!differsAnywhere && !anyConfig) return false;

  Dom.inspectorEmpty.style.display = 'none';
  Dom.inspectorContent.style.display = 'block';
  const ic = Dom.inspectorContent;
  ic.innerHTML = '';

  // ── Header: name, label, per-column status strip ────────────────────────────
  ic.appendChild(setText(el('div', 'insp-name'), tableId));
  ic.appendChild(setText(el('div', 'insp-label'), displayNode?.label || ''));

  const strip = setCols(el('div', 'diff-sbs diff-col-strip'), cols.length);
  cols.forEach(c => {
    const chip = el('div', 'diff-col-chip ' + (COL_STATUS_CLASS[c.status] || 'cstat-same'));
    const nm = setText(el('div', 'diff-col-name'), c.label);
    const st = setText(
      el('div', 'diff-col-status'),
      c.kind === 'base' ? 'base' : STATUS_TEXT[c.status]
    );
    chip.appendChild(nm);
    chip.appendChild(st);
    strip.appendChild(chip);
  });
  ic.appendChild(strip);

  // ── Fields matrix (inheritance-aware) ────────────────────────────────────────
  renderFieldsMatrix(ic, cols, tableId);

  // ── Relationship changes (grouped, friendly labels) ──────────────────────────
  renderRelChanges(ic, cols, tableId);

  // ── Configuration (per compare) ─────────────────────────────────────────────
  renderConfig(ic, cols, cfgByCompare);

  return true;
}

// Build child→parent map from a subject's `extends` edges (source extends target).
function buildParentMap(data) {
  const m = new Map();
  for (const e of data?.edges || []) {
    if (e.type !== 'extends') continue;
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    if (s && t) m.set(s, t);
  }
  return m;
}

// The EFFECTIVE field set of a table in one subject: its own fields PLUS those
// inherited up the extends chain (own wins on a name clash). Mirrors the single
// inspector, which walks the inheritance chain rather than trusting a flattened
// node — so the diff reflects the same schema the single view shows.
//   → Map<name, { type, inherited, source }>
function effectiveFields(data, tableId) {
  const out = new Map();
  if (!data) return out;
  const nodes = new Map((data.nodes || []).map(n => [n.id, n]));
  const parents = buildParentMap(data);
  const seen = new Set();
  let cur = tableId;
  for (let depth = 0; cur && !seen.has(cur) && depth < 25; depth++) {
    seen.add(cur);
    const node = nodes.get(cur);
    for (const f of node?.fields || []) {
      if (!out.has(f.name)) {
        out.set(f.name, { type: f.type, inherited: cur !== tableId, source: cur });
      }
    }
    cur = parents.get(cur);
  }
  return out;
}

function renderFieldsMatrix(ic, cols, tableId) {
  // Per-column effective field set (own + inherited).
  const colFields = cols.map(c => effectiveFields(c.data, tableId));
  const baseFields = colFields[0];

  const names = new Set();
  colFields.forEach(m => m.forEach((_v, name) => names.add(name)));
  if (!names.size) return;

  // A row is "interesting" only when a compare column differs from base in type
  // (present↔absent counts). Identical fields — inherited ones included — fold
  // into the unchanged tally, exactly like the single view treats them as noise.
  const rows = [];
  let unchanged = 0;
  for (const name of [...names].sort()) {
    const bt = baseFields.get(name)?.type;
    const differs = cols.some((c, i) => i > 0 && colFields[i].get(name)?.type !== bt);
    if (differs) rows.push(name);
    else unchanged++;
  }

  ic.appendChild(setText(el('div', 'diff-insp-section-title'), 'Fields — by instance'));

  // Column headers coloured by the table's status in that instance (identical =
  // green, changed = amber …) — not a uniform "compare" colour.
  const header = setCols(el('div', 'diff-sbs'), cols.length);
  cols.forEach(c => {
    const h = el('div', 'diff-sbs-col-header ' + (COL_STATUS_CLASS[c.status] || 'cstat-same'));
    setText(h, c.label);
    header.appendChild(h);
  });
  ic.appendChild(header);

  const customOn = Settings.isEnabled('customHighlight');
  for (const name of rows) {
    const bt = baseFields.get(name)?.type;
    const row = setCols(el('div', 'diff-sbs'), cols.length);
    cols.forEach((c, i) => {
      const entry = colFields[i].get(name);
      const t = entry?.type;
      let cls;
      if (c.kind === 'base') cls = t === undefined ? '' : 'dfr-base';
      else if (t === undefined) cls = bt === undefined ? '' : 'dfr-removed';
      else if (bt === undefined) cls = 'dfr-added';
      else if (t !== bt) cls = 'dfr-changed';
      else cls = 'dfr-same';

      const cell = el('div', 'diff-field-row' + (cls ? ' ' + cls : ''));
      if (t === undefined) {
        cell.appendChild(setText(el('div', 'diff-field-absent'), '—'));
      } else {
        const wrap = el('div', 'diff-field-text');
        const nm = setText(el('div', 'diff-field-name'), name);
        if (customOn && Settings.isCustomName(name)) {
          nm.appendChild(setText(el('span', 'insp-custom-badge'), 'custom'));
        }
        if (entry.inherited) {
          const inh = setText(el('span', 'diff-field-inh'), 'inherited');
          inh.title = 'Inherited from ' + entry.source;
          nm.appendChild(inh);
        }
        wrap.appendChild(nm);
        cell.appendChild(wrap);
        cell.appendChild(setText(el('span', 'diff-field-type'), typeLabel(t)));
      }
      row.appendChild(cell);
    });
    ic.appendChild(row);
  }

  if (unchanged) {
    setText(
      ic.appendChild(el('div', 'diff-field-absent')),
      `${unchanged} field${unchanged === 1 ? '' : 's'} identical across all instances — not shown`
    );
  }
}

function renderRelChanges(ic, cols, tableId) {
  const compareCols = cols.filter(c => c.kind === 'compare');
  const groups = [];
  for (const c of compareCols) {
    const ch = c.diff.changed.get(tableId);
    const added = (ch && ch.addedEdges) || [];
    const removed = (ch && ch.removedEdges) || [];
    if (added.length || removed.length) groups.push({ col: c, added, removed });
  }
  if (!groups.length) return;

  // Human-readable table labels, from every subject's node maps.
  const labelById = new Map();
  for (const c of compareCols) {
    for (const [id, n] of c.diff.baseMap)
      if (n.label && !labelById.has(id)) labelById.set(id, n.label);
    for (const [id, n] of c.diff.compareMap)
      if (n.label && !labelById.has(id)) labelById.set(id, n.label);
  }
  const otherOf = e => {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    return s === tableId ? t : s;
  };

  ic.appendChild(setText(el('div', 'diff-insp-section-title'), 'Relationship changes'));
  const single = compareCols.length === 1;

  const renderRow = (e, sign) => {
    const otherId = otherOf(e);
    const row = el('div', 'diff-field-row ' + (sign === '+' ? 'dfr-added' : 'dfr-removed'));
    row.dataset.id = otherId;
    row.title = otherId;
    row.appendChild(
      setText(el('span', 'diff-edge-sign ' + (sign === '+' ? 'des-added' : 'des-removed')), sign)
    );
    const name = setText(el('span', 'diff-field-name'), labelById.get(otherId) || otherId);
    row.appendChild(name);
    // For references, show the dot-walk field (the single inspector's "via field").
    if (e.type === 'reference' && e.field) {
      row.appendChild(setText(el('span', 'diff-field-type'), e.field));
    }
    ic.appendChild(row);
  };

  for (const g of groups) {
    // With more than one compare, head each group with the instance label so the
    // change is attributable; a single compare keeps the flat grouped list.
    if (!single) ic.appendChild(setText(el('div', 'diff-rel-group-head'), 'vs ' + g.col.label));

    // Group the changed edges by friendly relationship type (Reference to /
    // Referenced by / Child tables / M2M junction / …), mirroring the legend and
    // the single inspector — not raw edge-type strings.
    const byKind = new Map();
    const push = (e, sign) => {
      const k = edgeKind(e, tableId);
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k).push({ e, sign });
    };
    g.added.forEach(e => push(e, '+'));
    g.removed.forEach(e => push(e, '−'));

    for (const kind of EDGE_ORDER) {
      const list = byKind.get(kind);
      if (!list || !list.length) continue;
      ic.appendChild(
        setText(el('div', 'diff-rel-subhead'), `${EDGE_LABEL[kind]} (${list.length})`)
      );
      list.forEach(({ e, sign }) => renderRow(e, sign));
    }
  }

  // Delegate row clicks → navigate to the related table (idempotent listener).
  if (!ic._relClickWired) {
    ic.addEventListener('click', e => {
      const row = e.target.closest('.diff-field-row[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      if (id) (id === uiState.selectedNode ? clearSelection : () => focusTable(id, false))();
    });
    ic._relClickWired = true;
  }
}

function renderConfig(ic, cols, cfgByCompare) {
  const compareCols = cols.filter(c => c.kind === 'compare');
  const entries = compareCols.map(c => cfgByCompare.get(c.id)).filter(Boolean);
  if (!entries.length) return;

  // App identity comes from any resolved entry (same scope → same app).
  const app = entries[0].app;
  ic.appendChild(setText(el('div', 'diff-insp-section-title'), 'Configuration'));

  const appRow = el('div', 'cfg-insp-app');
  appRow.appendChild(setText(el('span', 'cfg-insp-app-name'), app?.name || '(unknown app)'));
  appRow.appendChild(
    setText(
      el('span', 'cfg-insp-chip'),
      app?._section === 'customApps' ? 'Custom app' : 'Store app'
    )
  );
  ic.appendChild(appRow);

  // Status banner: a single pairwise status when there's one compare (parity with
  // the classic inspector + e2e), else "Drift" if any compare drifts/misses.
  const statuses = entries.map(e => e.status);
  const bannerStatus =
    compareCols.length === 1
      ? statuses[0]
      : statuses.some(s => s === 'drift' || s === 'missing')
        ? 'drift'
        : 'sync';
  ic.appendChild(
    setText(
      el('div', 'cfg-insp-status cfgs-' + bannerStatus),
      STATUS_LABELS[bannerStatus] || bannerStatus
    )
  );

  // Base + per-compare version/active cells. Base record is shared across entries.
  const grid = setCols(el('div', 'diff-sbs'), cols.length);
  const cell = (label, rec) => {
    const c = el('div', 'cfg-insp-cell');
    c.appendChild(setText(el('div', 'cfg-insp-cell-head'), label));
    if (!rec) {
      c.appendChild(setText(el('div', 'diff-field-absent'), '— not present'));
    } else {
      c.appendChild(setText(el('div', 'cfg-insp-ver'), 'v' + (rec.version || '?')));
      c.appendChild(
        setText(el('div', 'cfg-insp-act'), rec.active === false ? 'inactive' : 'active')
      );
    }
    return c;
  };
  // Base column: any entry's base record is the same instance.
  grid.appendChild(cell(cols[0].label, entries[0].base));
  compareCols.forEach(c => {
    const entry = cfgByCompare.get(c.id);
    grid.appendChild(cell(c.label, entry ? entry.compare : null));
  });
  ic.appendChild(grid);
}

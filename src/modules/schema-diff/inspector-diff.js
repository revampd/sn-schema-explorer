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
import { typeLabel, typeBadgeColor } from '../../core/render.js';
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
  // The base graph has the compare's ADDED tables/edges grafted in (marked
  // `_diffOnly`) so they render on the map. Those are NOT real base entities, so
  // strip them here — otherwise the base column would show a compare-only table's
  // fields / properties / relationships as if they existed in the base (and the
  // field matrix would call them "identical"). The compare columns read their own
  // (un-grafted) instance data, so only the base needs cleaning.
  const rawBase = getInstance(instancesState.selectedId)?.data || null;
  const baseData = rawBase
    ? {
        ...rawBase,
        nodes: (rawBase.nodes || []).filter(n => !n._diffOnly),
        edges: (rawBase.edges || []).filter(e => !e._diffOnly),
      }
    : null;
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

  // Effective field set per column (own + inherited from parent tables) — computed
  // once and reused by the matrix. The single inspector always shows inherited
  // fields, so the diff must reflect inherited differences too: a column whose
  // EFFECTIVE schema differs from Base reads 'changed' even when computeDiff (which
  // only sees own fields) called it 'same'. This keeps a child consistent when a
  // parent's field changed, without flooding the sidebar/canvas (those stay
  // own-change-based — the change is attributed to the parent there).
  const colFields = cols.map(c => effectiveFields(c.data, tableId));
  const effectiveDiffersFromBase = i => {
    const base = colFields[0];
    const names = new Set([...base.keys(), ...colFields[i].keys()]);
    for (const name of names) {
      if (colFields[i].get(name)?.type !== base.get(name)?.type) return true;
    }
    return false;
  };
  cols.forEach((c, i) => {
    if (c.kind === 'compare' && c.status === 'same' && effectiveDiffersFromBase(i)) {
      c.status = 'changed';
    }
  });

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

  // ── Properties matrix (parity with the single inspector's Properties) ────────
  renderPropsMatrix(ic, cols, tableId);

  // ── Fields matrix (inheritance-aware) ────────────────────────────────────────
  renderFieldsMatrix(ic, cols, colFields);

  // ── Relationships matrix (inheritance-aware, N-column presence) ──────────────
  renderRelMatrix(ic, cols, tableId);

  // ── Configuration (per compare) ─────────────────────────────────────────────
  renderConfig(ic, cols, cfgByCompare);

  return true;
}

// Per-subject node for a table.
function nodeOf(data, tableId) {
  return (data?.nodes || []).find(n => n.id === tableId) || null;
}
// Count of direct child tables (extends-in) for a table in one subject.
function childCount(data, tableId) {
  let n = 0;
  for (const e of data?.edges || []) {
    if (e.type !== 'extends') continue;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    if (t === tableId) n++;
  }
  return n;
}

// Properties matrix — mirrors the single inspector's Properties (scope, core,
// children, records) but column-aware, so the same facts read across instances.
// A compare cell that differs from Base is highlighted — EXCEPT `records`, which
// is shown for reference but never flagged: row counts naturally differ between
// instances (dev vs prod) and aren't a schema/config difference (`diff: false`).
function renderPropsMatrix(ic, cols, tableId) {
  const rowsDef = [
    { key: 'scope', fn: c => nodeOf(c.data, tableId)?.scope || '—' },
    { key: 'core', fn: c => (nodeOf(c.data, tableId)?.core ? '✓ yes' : 'no') },
    { key: 'children', fn: c => String(childCount(c.data, tableId)) },
    {
      key: 'records',
      diff: false,
      fn: c => {
        const n = nodeOf(c.data, tableId)?.recordCount;
        return typeof n === 'number' ? n.toLocaleString() : '—';
      },
    },
  ];

  ic.appendChild(setText(el('div', 'diff-insp-section-title'), 'Properties'));
  const gcols = `minmax(70px, 0.8fr) repeat(${cols.length}, minmax(0, 1fr))`;
  for (const { key, fn, diff = true } of rowsDef) {
    const row = el('div', 'diff-props-row');
    row.style.gridTemplateColumns = gcols;
    row.appendChild(setText(el('div', 'diff-props-key'), key));
    const baseVal = fn(cols[0]);
    cols.forEach(c => {
      const v = fn(c);
      const differs = diff && c.kind === 'compare' && v !== baseVal;
      const cell = setText(el('div', 'diff-props-cell' + (differs ? ' dfr-changed' : '')), v);
      row.appendChild(cell);
    });
    ic.appendChild(row);
  }
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

function renderFieldsMatrix(ic, cols, colFields) {
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
        // Colour the type label by field type, matching the single inspector.
        const ftype = setText(el('span', 'diff-field-type'), typeLabel(t));
        ftype.style.color = typeBadgeColor(t);
        ftype.title = t;
        cell.appendChild(ftype);
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

// The EFFECTIVE relationships of a table in one subject: its own edges PLUS those
// inherited up the extends chain (the ancestor's own inheritance edges are
// excluded — that's the chain itself, not a relationship). Mirrors effectiveFields.
//   → Map<key, { kind, otherId, field, inherited, source }>
// key = `${kind}|${otherId}|${field}` so the same relationship lines up across
// instances for the presence matrix.
function effectiveRelations(data, tableId) {
  const out = new Map();
  if (!data) return out;
  const parents = buildParentMap(data);
  const depthOf = new Map();
  {
    const seen = new Set();
    let cur = tableId;
    for (let d = 0; cur && !seen.has(cur) && d < 25; d++) {
      seen.add(cur);
      depthOf.set(cur, d);
      cur = parents.get(cur);
    }
  }
  for (const e of data.edges || []) {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    // Owner = the chain member this edge attaches to (closest to the table).
    let owner = null;
    if (depthOf.has(s)) owner = s;
    if (depthOf.has(t) && (owner === null || depthOf.get(t) < depthOf.get(owner))) owner = t;
    if (owner === null) continue;
    const inherited = owner !== tableId;
    if (e.type === 'extends' && inherited) continue; // ancestor's own chain — not a relationship
    const kind = edgeKind(e, owner);
    const otherId = s === owner ? t : s;
    const field = e.type === 'reference' ? e.field || '' : '';
    const key = `${kind}|${otherId}|${field}`;
    if (!out.has(key)) out.set(key, { kind, otherId, field, inherited, source: owner });
  }
  return out;
}

function renderRelMatrix(ic, cols, tableId) {
  const colRels = cols.map(c => effectiveRelations(c.data, tableId));
  const baseRels = colRels[0];

  const keys = new Set();
  colRels.forEach(m => m.forEach((_v, k) => keys.add(k)));
  if (!keys.size) return;

  // Human-readable table labels, from every subject's node maps.
  const labelById = new Map();
  for (const c of cols) {
    if (c.kind !== 'compare') continue;
    for (const [id, n] of c.diff.baseMap)
      if (n.label && !labelById.has(id)) labelById.set(id, n.label);
    for (const [id, n] of c.diff.compareMap)
      if (n.label && !labelById.has(id)) labelById.set(id, n.label);
  }
  const labelOf = id => labelById.get(id) || id;

  // Only rows where a compare's presence differs from base.
  const rows = [];
  for (const k of keys) {
    const inBase = baseRels.has(k);
    const differs = cols.some((c, i) => i > 0 && colRels[i].has(k) !== inBase);
    if (!differs) continue;
    const meta = baseRels.get(k) || colRels.map(m => m.get(k)).find(Boolean);
    rows.push({ key: k, meta, inBase });
  }
  if (!rows.length) return;
  rows.sort(
    (a, b) =>
      EDGE_ORDER.indexOf(a.meta.kind) - EDGE_ORDER.indexOf(b.meta.kind) ||
      labelOf(a.meta.otherId).localeCompare(labelOf(b.meta.otherId))
  );

  ic.appendChild(setText(el('div', 'diff-insp-section-title'), 'Relationships — by instance'));

  const gcols = `minmax(96px, 1.5fr) repeat(${cols.length}, minmax(0, 1fr))`;
  const header = el('div', 'diff-rel-matrix-row');
  header.style.gridTemplateColumns = gcols;
  header.appendChild(el('div')); // spacer over the row-label column
  cols.forEach(c =>
    header.appendChild(
      setText(
        el('div', 'diff-sbs-col-header ' + (COL_STATUS_CLASS[c.status] || 'cstat-same')),
        c.label
      )
    )
  );
  ic.appendChild(header);

  for (const { key, meta, inBase } of rows) {
    const row = el('div', 'diff-rel-matrix-row');
    row.style.gridTemplateColumns = gcols;
    row.dataset.id = meta.otherId;
    row.title = meta.otherId;

    const lab = el('div', 'diff-rel-rowhead');
    lab.appendChild(setText(el('span', 'diff-rel-kind'), EDGE_LABEL[meta.kind] || meta.kind));
    const nm = setText(el('span', 'diff-field-name'), labelOf(meta.otherId));
    if (meta.field) nm.textContent += ' · ' + meta.field;
    lab.appendChild(nm);
    if (meta.inherited) {
      const inh = setText(el('span', 'diff-field-inh'), 'inherited');
      inh.title = 'Inherited from ' + meta.source;
      lab.appendChild(inh);
    }
    row.appendChild(lab);

    cols.forEach((c, i) => {
      const present = colRels[i].has(key);
      let cls;
      if (c.kind === 'base') cls = present ? 'dfr-base' : '';
      else if (present && !inBase) cls = 'dfr-added';
      else if (!present && inBase) cls = 'dfr-removed';
      else cls = present ? 'dfr-same' : '';
      const cell = el('div', 'diff-rel-cell' + (cls ? ' ' + cls : ''));
      cell.textContent = present ? '✓' : '—';
      row.appendChild(cell);
    });
    ic.appendChild(row);
  }

  // Delegate row clicks → navigate to the related table (idempotent listener).
  if (!ic._relClickWired) {
    ic.addEventListener('click', e => {
      const row = e.target.closest('[data-id].diff-rel-matrix-row, .diff-field-row[data-id]');
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

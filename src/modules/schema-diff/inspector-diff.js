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

const STATUS_CLASS = {
  added: 'dfr-added',
  removed: 'dfr-removed',
  changed: 'dfr-changed',
  same: 'dfr-same',
  absent: '',
};
const STATUS_TEXT = {
  added: '+ added',
  removed: '− removed',
  changed: '~ changed',
  same: 'identical',
  absent: '— absent',
};

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
    { id: '__base__', label: baseLabel, kind: 'base' },
    ...matrix.map(diff => ({
      id: diff._compareId,
      label: diff._compareLabel || diff._compareId,
      kind: 'compare',
      diff,
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
    const chip = el(
      'div',
      'diff-col-chip ' + (c.kind === 'base' ? 'dcc-base' : STATUS_CLASS[c.status] || 'dfr-same')
    );
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

  // ── Fields matrix ───────────────────────────────────────────────────────────
  renderFieldsMatrix(ic, cols, baseNode, tableId);

  // ── Relationship changes (grouped per compare) ──────────────────────────────
  renderRelChanges(ic, cols, tableId);

  // ── Configuration (per compare) ─────────────────────────────────────────────
  renderConfig(ic, cols, cfgByCompare);

  return true;
}

// Field type for a node's field, or undefined if the field/node is absent.
function fieldType(node, name) {
  if (!node) return undefined;
  const f = (node.fields || []).find(x => x.name === name);
  return f ? f.type : undefined;
}

function renderFieldsMatrix(ic, cols, baseNode, tableId) {
  // Per-column node for this table.
  const nodeFor = c => (c.kind === 'base' ? baseNode : c.diff.compareMap.get(tableId) || null);
  const colNodes = cols.map(nodeFor);

  // Union of every field name across all columns.
  const names = new Set();
  colNodes.forEach(n => (n?.fields || []).forEach(f => names.add(f.name)));
  if (!names.size) return;

  const baseType = name => fieldType(baseNode, name);

  // A field row is "interesting" if any compare column differs from base.
  const rows = [];
  let unchanged = 0;
  for (const name of [...names].sort()) {
    const bt = baseType(name);
    const differs = cols.some(c => {
      if (c.kind === 'base') return false;
      const ct = fieldType(c.diff.compareMap.get(tableId), name);
      return ct !== bt; // absent-vs-present or type change
    });
    if (!differs) {
      unchanged++;
      continue;
    }
    rows.push(name);
  }

  ic.appendChild(setText(el('div', 'diff-insp-section-title'), 'Fields — by instance'));

  const header = setCols(el('div', 'diff-sbs'), cols.length);
  cols.forEach(c => {
    const h = el('div', 'diff-sbs-col-header ' + (c.kind === 'base' ? 'dsc-base' : 'dsc-compare'));
    setText(h, c.label);
    header.appendChild(h);
  });
  ic.appendChild(header);

  const customOn = Settings.isEnabled('customHighlight');
  for (const name of rows) {
    const bt = baseType(name);
    const row = setCols(el('div', 'diff-sbs'), cols.length);
    cols.forEach(c => {
      const node = nodeFor(c);
      const t = fieldType(node, name);
      let cls;
      if (c.kind === 'base') {
        cls = t === undefined ? '' : 'dfr-base';
      } else if (t === undefined) {
        cls = bt === undefined ? '' : 'dfr-removed'; // present in base, gone here
      } else if (bt === undefined) {
        cls = 'dfr-added'; // new here vs base
      } else if (t !== bt) {
        cls = 'dfr-changed';
      } else {
        cls = 'dfr-same';
      }
      const cell = el('div', 'diff-field-row' + (cls ? ' ' + cls : ''));
      if (t === undefined) {
        cell.appendChild(setText(el('div', 'diff-field-absent'), '—'));
      } else {
        const wrap = el('div', 'diff-field-text');
        const nm = setText(el('div', 'diff-field-name'), name);
        if (customOn && Settings.isCustomName(name)) {
          const badge = setText(el('span', 'insp-custom-badge'), 'custom');
          nm.appendChild(badge);
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

  ic.appendChild(setText(el('div', 'diff-insp-section-title'), 'Relationship changes'));
  const single = compareCols.length === 1;

  for (const g of groups) {
    // With more than one compare, head each group with the instance label so the
    // change is attributable; with a single compare keep the flat list (parity
    // with the classic diff).
    if (!single) {
      ic.appendChild(setText(el('div', 'diff-rel-group-head'), 'vs ' + g.col.label));
    }
    const rows = [
      ...g.added.map(e => ({ e, sign: '+', cls: 'dfr-added' })),
      ...g.removed.map(e => ({ e, sign: '−', cls: 'dfr-removed' })),
    ];
    for (const { e, sign, cls } of rows) {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      const otherId = s === tableId ? t : s;
      const row = el('div', 'diff-field-row ' + cls);
      row.dataset.id = otherId;
      row.title = otherId;
      row.appendChild(
        setText(el('span', 'diff-edge-sign ' + (sign === '+' ? 'des-added' : 'des-removed')), sign)
      );
      row.appendChild(setText(el('span', 'diff-edge-type'), e.type || ''));
      row.appendChild(setText(el('span', 'diff-field-name'), otherId));
      ic.appendChild(row);
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

/**
 * Schema-diff inspector renderer — extracted from schema-diff/index.js (#73).
 *
 * Renders the inspector panel for a table that is added / removed / changed in
 * the current diff: the status banner, the field list (or side-by-side base vs
 * compare view for changed tables), and the relationship-change rows. Registered
 * as the fill-inspector hook by index.js; behaviour-preserving.
 */
import { uiState, diffState } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { typeLabel } from '../../engine/render.js';
import { Settings } from '../settings/index.js';
import { focusTable, clearSelection } from '../../shared/inspector.js';

export function diffFillInspector(d) {
  if (!diffState._diffData || uiState.viewMode !== 'diff') return false;
  const tableId = d.id || d;
  const isAdded = diffState._diffData.added.has(tableId);
  const isRemoved = diffState._diffData.removed.has(tableId);
  const isChanged = diffState._diffData.changed.has(tableId);
  if (!isAdded && !isRemoved && !isChanged) return false;

  Dom.inspectorEmpty.style.display = 'none';
  Dom.inspectorContent.style.display = 'block';
  const ic = Dom.inspectorContent;
  ic.innerHTML = '';

  const setText = (el, t) => {
    el.textContent = t;
    return el;
  };
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  const baseNode = diffState._diffData.baseMap.get(tableId);
  const compareNode = diffState._diffData.compareMap.get(tableId);
  const displayNode = baseNode || compareNode;

  const nameEl = el('div', 'insp-name');
  setText(nameEl, tableId);
  const labelEl = el('div', 'insp-label');
  setText(labelEl, displayNode?.label || '');
  ic.appendChild(nameEl);
  ic.appendChild(labelEl);

  const banner = el('div', 'diff-insp-banner');
  if (isAdded) {
    banner.className += ' dib-added';
    banner.textContent = '+ Added in compare';
  }
  if (isRemoved) {
    banner.className += ' dib-removed';
    banner.textContent = '− Removed in compare';
  }
  if (isChanged) {
    const ch0 = diffState._diffData.changed.get(tableId);
    const hasFields =
      ch0.addedFields.length || ch0.removedFields.length || ch0.changedFields.length;
    const hasEdges = ch0.addedEdges.length || ch0.removedEdges.length;
    const parts = [];
    if (hasFields) parts.push('fields');
    if (hasEdges) parts.push('relationships');
    banner.className += ' dib-changed';
    banner.textContent = '~ Changed: ' + (parts.join(' & ') || 'details below');
  }
  ic.appendChild(banner);

  if (isAdded || isRemoved) {
    const node = isAdded ? compareNode : baseNode;
    const secTitle = el('div', 'diff-insp-section-title');
    secTitle.textContent = isAdded ? 'Fields (compare schema)' : 'Fields (base schema)';
    ic.appendChild(secTitle);
    const fields = node?.fields || [];
    if (!fields.length) {
      const empty = el('div', 'diff-field-absent');
      empty.textContent = 'No field data available';
      ic.appendChild(empty);
    } else {
      fields.forEach(f => {
        const row = el('div', isAdded ? 'diff-field-row dfr-added' : 'diff-field-row dfr-removed');
        const wrap = el('div', 'diff-field-text');
        const name = el('div', 'diff-field-name');
        setText(name, f.name);
        if (Settings.isEnabled('customHighlight') && Settings.isCustomName(f.name)) {
          const badge = el('span', 'insp-custom-badge');
          badge.textContent = 'custom';
          name.appendChild(badge);
        }
        wrap.appendChild(name);
        if (f.label && f.label !== f.name) {
          const lbl = el('div', 'diff-field-label');
          setText(lbl, f.label);
          wrap.appendChild(lbl);
        }
        const type = el('span', 'diff-field-type');
        setText(type, typeLabel(f.type));
        row.appendChild(wrap);
        row.appendChild(type);
        ic.appendChild(row);
      });
    }
    const schema = isAdded ? compareNode : baseNode;
    if (schema) {
      const edgeSec = el('div', 'diff-insp-section-title');
      edgeSec.textContent = 'Relationships';
      ic.appendChild(edgeSec);
      const note = el('div', 'diff-field-absent');
      note.textContent = isAdded
        ? 'All relationships for this table are new in the compare schema.'
        : 'All relationships for this table are gone in the compare schema.';
      ic.appendChild(note);
    }
    return true;
  }

  // Changed table — side-by-side fields view
  const ch = diffState._diffData.changed.get(tableId);
  const bFields = new Map((baseNode?.fields || []).map(f => [f.name, f]));
  const cFields = new Map((compareNode?.fields || []).map(f => [f.name, f]));
  const allNames = [...new Set([...bFields.keys(), ...cFields.keys()])].sort();

  const secTitle = el('div', 'diff-insp-section-title');
  secTitle.textContent = 'Fields — side by side';
  ic.appendChild(secTitle);

  const colHeaders = el('div', 'diff-sbs');
  const bh = el('div', 'diff-sbs-col-header dsc-base');
  bh.textContent = 'Base';
  const ch2 = el('div', 'diff-sbs-col-header dsc-compare');
  ch2.textContent = 'Compare';
  colHeaders.appendChild(bh);
  colHeaders.appendChild(ch2);
  ic.appendChild(colHeaders);

  let unchangedCount = 0;
  for (const name of allNames) {
    const bf = bFields.get(name);
    const cf = cFields.get(name);
    if (bf && cf && bf.type === cf.type) {
      unchangedCount++;
      continue;
    }

    const row = el('div', 'diff-sbs');
    let rowCls = 'dfr-same';
    if (!bf) rowCls = 'dfr-added';
    else if (!cf) rowCls = 'dfr-removed';
    else rowCls = 'dfr-changed';

    // Colour only the cell that has content — the absent (—) cell gets no highlight
    // so green/red never lands on a dash.
    const _diffFieldCell = (f, cls) => {
      const cell = el('div', cls);
      if (f) {
        const wrap = el('div', 'diff-field-text');
        const n = el('div', 'diff-field-name');
        setText(n, f.name);
        if (Settings.isEnabled('customHighlight') && Settings.isCustomName(f.name)) {
          const badge = el('span', 'insp-custom-badge');
          badge.textContent = 'custom';
          n.appendChild(badge);
        }
        wrap.appendChild(n);
        if (f.label && f.label !== f.name) {
          const lbl = el('div', 'diff-field-label');
          setText(lbl, f.label);
          wrap.appendChild(lbl);
        }
        const t = el('span', 'diff-field-type');
        setText(t, typeLabel(f.type));
        cell.appendChild(wrap);
        cell.appendChild(t);
      } else {
        cell.appendChild(el('div', 'diff-field-absent')).textContent = '—';
      }
      return cell;
    };
    const bCell = _diffFieldCell(bf, `diff-field-row${bf ? ' ' + rowCls : ''}`);
    const cCell = _diffFieldCell(cf, `diff-field-row${cf ? ' ' + rowCls : ''}`);

    row.appendChild(bCell);
    row.appendChild(cCell);
    ic.appendChild(row);
  }

  if (unchangedCount) {
    const summary2 = el('div', 'diff-field-absent');
    summary2.textContent =
      unchangedCount + ' unchanged field' + (unchangedCount === 1 ? '' : 's') + ' not shown';
    ic.appendChild(summary2);
  }

  const hasEdgeChanges = ch.addedEdges.length || ch.removedEdges.length;
  if (hasEdgeChanges) {
    const edgeSec = el('div', 'diff-insp-section-title');
    edgeSec.textContent = 'Relationships';
    ic.appendChild(edgeSec);
    // Build a label lookup from both base and compare schemas so we can show
    // the human-readable table label (e.g. "Business Application") in the far-right column
    const labelById = new Map();
    for (const [id, node] of diffState._diffData.baseMap) {
      if (node.label) labelById.set(id, node.label);
    }
    for (const [id, node] of diffState._diffData.compareMap) {
      if (node.label && !labelById.has(id)) labelById.set(id, node.label);
    }
    function renderEdgeRows(edges, rowCls, sign) {
      for (const e of edges) {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        const otherId = s === tableId ? t : s;
        const row = el('div', 'diff-field-row ' + rowCls);
        row.dataset.id = otherId;
        row.title = otherId;
        const signEl = el(
          'span',
          'diff-edge-sign ' + (rowCls === 'dfr-added' ? 'des-added' : 'des-removed')
        );
        setText(signEl, sign);
        const typeEl = el('span', 'diff-edge-type');
        setText(typeEl, e.type || '');
        const tgt = el('span', 'diff-field-name');
        setText(tgt, otherId);
        if (e.field) {
          const fld = el('span', 'diff-field-type');
          setText(fld, labelById.get(otherId) || otherId);
          row.appendChild(signEl);
          row.appendChild(typeEl);
          row.appendChild(tgt);
          row.appendChild(fld);
        } else {
          row.appendChild(signEl);
          row.appendChild(typeEl);
          row.appendChild(tgt);
        }
        ic.appendChild(row);
      }
    }
    renderEdgeRows(ch.addedEdges, 'dfr-added', '+');
    renderEdgeRows(ch.removedEdges, 'dfr-removed', '−');
    ic.addEventListener('click', e => {
      const row = e.target.closest('.diff-field-row[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      if (id) {
        id === uiState.selectedNode ? clearSelection() : focusTable(id, false);
      }
    });
  }

  return true;
}

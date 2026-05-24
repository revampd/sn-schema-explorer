import { graphState, uiState, nodeColor } from '../core/state.js';
import { Settings } from '../modules/settings/index.js';
import { Dom } from '../core/dom.js';
import { INSP_OPEN_BY_DEFAULT } from '../core/constants.js';
import { render } from '../engine/render.js';
import { computeNeighbourhood } from '../engine/compute.js';
import { typeBadgeColor, typeLabel } from '../engine/render.js';
import { openPanel, closePanel } from '../engine/canvas.js';
import { applyTableFilter } from '../modules/search/index.js';
import { fitGraph } from '../modules/export/index.js';
import { highlightListItem } from './table-list.js';
import { updateDensityInfo, updateHopDepthSlider } from './density-controls.js';
import { filterOk } from '../core/advanced-filter.js';
import { pushHistory } from '../modules/history/index.js';

// _fillInspectorHook: optional override injected by path-finder
let _fillInspectorHook = null;
// _makePathLink: injected by path-finder when the feature is enabled
let _makePathLink = null;

export function setFillInspectorHook(fn) {
  _fillInspectorHook = fn;
}

/** Accepts only path-finder-specific deps (makePathLink). Everything else is now a direct import. */
export function initInspectorDeps(deps) {
  if (deps.makePathLink !== undefined) _makePathLink = deps.makePathLink;
}

export function selectNode(d, nodeSel, edgePath) {
  if (!graphState.graphData) return;
  uiState.selectedNode = d.id;
  Dom.statFocus.textContent = d.id;

  if (Settings.isEnabled('clearSearchOnSelect')) {
    Dom.searchBox.value = '';
    applyTableFilter('');
  }

  render();

  if (Settings.isEnabled('autoFitOnSelect')) {
    setTimeout(() => { fitGraph(); }, 250);
  }

  pushHistory();
}

export function clearSel(nodeSel, edgePath) {
  clearSelection();
}

export function clearSelection() {
  if (!uiState.selectedNode) return;
  uiState.selectedNode = null;
  uiState.connectedNodes = new Set();
  uiState._lastInheritedSeeds = new Set();
  uiState.hiddenNodes.clear();
  Dom.statFocus.textContent = '—';
  Dom.inspectorEmpty.style.display = '';
  Dom.inspectorContent.style.display = 'none';
  Dom.activeFilter.style.display = 'none';
  document.querySelectorAll('.table-item').forEach(el=>el.classList.remove('selected'));
  const totalAvailable = uiState.filterConditions.length === 0
    ? graphState.graphData.nodes.length
    : graphState.graphData.nodes.filter(filterOk).length;
  const newCeiling = Math.max(1, totalAvailable);
  Dom.slMaxNodes.max = newCeiling;
  if (uiState.maxNodes > newCeiling) uiState.maxNodes = newCeiling;
  Dom.slMaxNodes.value = uiState.maxNodes;
  Dom.valMaxNodes.textContent = uiState.maxNodes;
  updateDensityInfo();
  updateHopDepthSlider();
  render();
  pushHistory();
}

export function fillInspector(d) {
  if (_fillInspectorHook && _fillInspectorHook(d)) return;
  Dom.inspectorEmpty.style.display   = 'none';
  Dom.inspectorContent.style.display = 'block';
  const ic = Dom.inspectorContent;

  const id   = d.id;
  const _nb  = graphState.graphData._nodeById;
  const _adj = graphState.graphData._adj;

  // Use adjacency index for O(degree) lookups instead of O(|edges|) full scans
  const adj = _adj ? (_adj.get(id) || { out: [], in: [] })
                   : { out: graphState.graphData.edges, in: graphState.graphData.edges };
  const _filtOut = (type) => _adj
    ? adj.out.filter(e => e.type === type)
    : graphState.graphData.edges.filter(e => (e.source?.id??e.source)===id && e.type===type);
  const _filtIn  = (type) => _adj
    ? adj.in.filter(e => e.type === type)
    : graphState.graphData.edges.filter(e => (e.target?.id??e.target)===id && e.type===type);
  const _findOut = (type) => _adj
    ? adj.out.find(e => e.type === type)
    : graphState.graphData.edges.find(e => (e.source?.id??e.source)===id && e.type===type);

  const outR     = _filtOut('reference');
  const inR      = _filtIn('reference');
  const extE     = _findOut('extends');
  const kids     = _filtIn('extends');
  const m2mOut   = _filtOut('m2m');
  const m2mIn    = _filtIn('m2m');
  const relOut   = _filtOut('rel');
  const relIn    = _filtIn('rel');
  const viewOf   = _filtOut('view');
  const ciRelOut = _filtOut('cmdb_rel');
  const ciRelIn  = _filtIn('cmdb_rel');

  const inheritanceChain = [];
  {
    const seen = new Set([id]);
    let cur = id;
    for (let depth = 0; depth < 20; depth++) {
      const curAdj = _adj ? _adj.get(cur) : null;
      const e = curAdj
        ? curAdj.out.find(ed => ed.type === 'extends')
        : graphState.graphData.edges.find(ed => (ed.source?.id ?? ed.source) === cur && ed.type === 'extends');
      if (!e) break;
      const parentId = e.target?.id ?? e.target;
      if (seen.has(parentId)) break;
      seen.add(parentId);
      const parentNode = _nb ? _nb.get(parentId) : graphState.graphData.nodes.find(n => n.id === parentId);
      if (!parentNode) break;
      inheritanceChain.push({
        id: parentId,
        label: parentNode.label || parentId,
        fields: parentNode.fields || []
      });
      cur = parentId;
    }
  }

  const ownFieldNames = new Set((d.fields || []).map(f => f.name));
  let isFlattened = false;
  if (inheritanceChain.length && inheritanceChain[0].fields.length) {
    const parent = inheritanceChain[0];
    const overlap = parent.fields.filter(f => ownFieldNames.has(f.name)).length;
    isFlattened = overlap / parent.fields.length >= 0.5;
  }

  const fieldSourceMap = new Map();
  const inheritedFields = [];
  const inheritedSeen = new Set();
  for (const anc of inheritanceChain) {
    for (const f of anc.fields) {
      fieldSourceMap.set(f.name, { sourceId: anc.id, sourceLabel: anc.label });
    }
  }
  if (!isFlattened) {
    for (const anc of inheritanceChain) {
      for (const f of anc.fields) {
        if (ownFieldNames.has(f.name)) continue;
        if (inheritedSeen.has(f.name)) continue;
        inheritedSeen.add(f.name);
        inheritedFields.push({
          ...f,
          sourceId: anc.id,
          sourceLabel: anc.label
        });
      }
    }
  }

  const setText = (el, text) => { el.textContent = text; return el; };
  const el      = (tag, cls) => { const e=document.createElement(tag); if(cls) e.className=cls; return e; };

  function makeEdgeItem(tableId, sub, cls) {
    const div = el('div', 'edge-list-item' + (cls ? ' '+cls : ''));
    div.dataset.table = tableId;
    const target = el('div','el-target'); setText(target, tableId);
    const field  = el('div','el-field');  setText(field,  sub||'');
    div.appendChild(target); div.appendChild(field);
    return div;
  }

  function makeSection(sectionKey, title, items) {
    if (!items || !items.length) return null;
    const stateKey = id + ':' + sectionKey;
    const isOpen   = uiState.inspSectionState.has(stateKey)
      ? uiState.inspSectionState.get(stateKey)
      : INSP_OPEN_BY_DEFAULT.has(sectionKey);

    const section  = el('div','insp-section');
    section.dataset.section = stateKey;

    const titleEl  = el('div','insp-section-title' + (isOpen?' open':''));
    const titleSpan = el('span'); setText(titleSpan, title);
    const toggle   = el('span','insp-toggle'); toggle.textContent = '+';
    titleEl.appendChild(titleSpan); titleEl.appendChild(toggle);

    const body = el('div','insp-section-body' + (isOpen?' open':''));
    items.forEach(child => { if(child) body.appendChild(child); });

    section.appendChild(titleEl); section.appendChild(body);

    titleEl.addEventListener('click', () => {
      const open = titleEl.classList.toggle('open');
      body.classList.toggle('open', open);
      uiState.inspSectionState.set(stateKey, open);
    });
    return section;
  }

  const nodeLabel = nid => (_nb ? _nb.get(nid) : graphState.graphData.nodes.find(n=>n.id===nid))?.label ?? nid;

  const byTargetLabel = (a, b) => {
    const tl = nodeLabel(a.target?.id??a.target).localeCompare(nodeLabel(b.target?.id??b.target));
    return tl !== 0 ? tl : (a.label||a.field||'').localeCompare(b.label||b.field||'');
  };
  const bySourceLabel = (a, b) => {
    const sl = nodeLabel(a.source?.id??a.source).localeCompare(nodeLabel(b.source?.id??b.source));
    return sl !== 0 ? sl : (a.label||a.field||'').localeCompare(b.label||b.field||'');
  };

  ic.innerHTML = '';

  const nameEl  = el('div','insp-name');  setText(nameEl,  id);
  const labelEl = el('div','insp-label'); setText(labelEl, d.label||'');
  ic.appendChild(nameEl); ic.appendChild(labelEl);

  const propsDiv = el('div');
  const addRow = (key, val, accent) => {
    const row = el('div','insp-row');
    const k   = el('span','insp-key');   setText(k, key);
    const v   = el('span','insp-val' + (accent?' accent':''));
    setText(v, val);
    row.appendChild(k); row.appendChild(v);
    propsDiv.appendChild(row);
  };
  addRow('scope',    d.scope,               true);
  addRow('core',     d.core ? '✓ yes':'no', false);
  if (extE) addRow('extends', extE.target?.id??extE.target, true);
  if (inheritanceChain.length > 1) {
    const chainStr = inheritanceChain.map(a => a.id).join(' → ');
    addRow('chain',  chainStr, false);
  }
  addRow('children', String(kids.length),   false);

  if (typeof d.recordCount === 'number') {
    addRow('records', d.recordCount.toLocaleString(), false);
  } else if (d.recordCountStatus) {
    const statusLabels = {
      acl:          'unavailable (cross-scope ACL)',
      unsupported:  'unavailable (virtual table)',
      script_error: 'unavailable (vtable handler error)',
      other:        'unavailable'
    };
    addRow('records', statusLabels[d.recordCountStatus] || 'unavailable', false);
  }

  const propsSection = makeSection('properties', 'Properties', [propsDiv]);
  if (propsSection) ic.appendChild(propsSection);

  if (d.fields?.length) {
    const sortedFields = [...d.fields].sort((a,b) => a.label.localeCompare(b.label));
    const grid = el('div','insp-fields-grid');
    let inheritedCount = 0;
    sortedFields.forEach(f => {
      const col   = typeBadgeColor(f.type);
      const src   = isFlattened ? fieldSourceMap.get(f.name) : null;
      if (src) inheritedCount++;
      const isCustomField = Settings.isEnabled('customHighlight') && Settings.isCustomName(f.name);
      const row   = el('div','insp-field-row' + (src ? ' insp-field-inherited' : '') + (isCustomField ? ' insp-field-row--custom' : ''));
      row.dataset.field = f.name;
      const names = el('div','insp-field-names');
      const fname = el('span','insp-field-name');  setText(fname, f.name);
      if (isCustomField) {
        const badge = el('span', 'insp-custom-badge'); badge.textContent = 'custom';
        fname.appendChild(badge);
      }
      const flabel= el('span','insp-field-label'); setText(flabel, f.label);
      names.appendChild(fname); names.appendChild(flabel);
      const meta  = el('div','insp-field-meta');
      if (src) {
        const sbadge = el('span','insp-field-source');
        sbadge.dataset.table = src.sourceId;
        sbadge.classList.add('edge-list-item');
        setText(sbadge, src.sourceId);
        sbadge.title = `Inherited from ${src.sourceLabel} (${src.sourceId})`;
        meta.appendChild(sbadge);
      }
      const ftype = el('span','insp-field-type');  setText(ftype, typeLabel(f.type));
      ftype.style.color = col; ftype.title = f.type;
      meta.appendChild(ftype);
      const pflink = _makePathLink ? _makePathLink(f.name, id) : null;
      if (pflink) meta.appendChild(pflink);
      row.appendChild(names); row.appendChild(meta);
      grid.appendChild(row);
    });
    const ownCount = sortedFields.length - inheritedCount;
    const customCount = Settings.isEnabled('customHighlight')
      ? sortedFields.filter(f => Settings.isCustomName(f.name)).length : 0;
    const customSuffix = customCount > 0 ? `, ${customCount} custom` : '';
    const titleStr = isFlattened && inheritedCount > 0
      ? `Fields (${sortedFields.length}: ${ownCount} own, ${inheritedCount} inherited${customSuffix})`
      : `Fields (${sortedFields.length}${customSuffix})`;
    const sec = makeSection('fields', titleStr, [grid]);
    if (sec) ic.appendChild(sec);
  }

  if (inheritedFields.length) {
    const byAncestor = new Map();
    for (const anc of inheritanceChain) {
      byAncestor.set(anc.id, { label: anc.label, fields: [] });
    }
    for (const f of inheritedFields) {
      byAncestor.get(f.sourceId).fields.push(f);
    }

    const grid = el('div', 'insp-fields-grid');
    for (const [ancId, group] of byAncestor) {
      if (!group.fields.length) continue;
      const sub = el('div', 'insp-inherit-source');
      sub.dataset.table = ancId;
      sub.classList.add('edge-list-item');
      const subLabel = el('span','insp-inherit-source-label');
      setText(subLabel, group.label);
      const subId = el('span', 'insp-inherit-source-id');
      setText(subId, `${ancId} · ${group.fields.length} field${group.fields.length===1?'':'s'}`);
      sub.appendChild(subLabel); sub.appendChild(subId);
      grid.appendChild(sub);

      const sortedGroupFields = [...group.fields].sort((a,b) => a.label.localeCompare(b.label));
      for (const f of sortedGroupFields) {
        const col   = typeBadgeColor(f.type);
        const row   = el('div', 'insp-field-row insp-field-inherited');
        row.dataset.field = f.name;
        const names = el('div', 'insp-field-names');
        const fname = el('span','insp-field-name');  setText(fname, f.name);
        const flabel= el('span','insp-field-label'); setText(flabel, f.label);
        names.appendChild(fname); names.appendChild(flabel);
        const meta  = el('div','insp-field-meta');
        const ftype = el('span','insp-field-type');  setText(ftype, typeLabel(f.type));
        ftype.style.color = col; ftype.title = f.type;
        meta.appendChild(ftype);
        row.appendChild(names); row.appendChild(meta);
        grid.appendChild(row);
      }
    }
    const sec = makeSection('inherited-fields',
      `Inherited fields (${inheritedFields.length})`, [grid]);
    if (sec) ic.appendChild(sec);
  }

  const tgt = e => e.target?.id??e.target;
  const src2= e => e.source?.id??e.source;

  let refsOutSection = null, refsInSection = null;
  function edgeSec(key, title, edges, getTableId, getSub, cls) {
    if (!edges.length) return null;
    const items = edges.map(e => makeEdgeItem(getTableId(e), getSub(e), cls));
    const sec = makeSection(key, `${title} (${edges.length})`, items);
    if (sec) ic.appendChild(sec);
    return sec;
  }

  refsOutSection = edgeSec('refs-out',  'References out',
    [...outR].sort(byTargetLabel),
    tgt, e => e.field||e.label||'', '');

  refsInSection = edgeSec('refs-in',   'Referenced by',
    [...inR].sort(bySourceLabel),
    src2, e => 'via '+(e.field||e.label||''), '');

  if (Settings.isEnabled('inheritedRefsInspector') && inheritanceChain.length) {
    const ownRefOutTargets = new Set(outR.map(e => e.target?.id ?? e.target));
    const ownRefInSources  = new Set(inR.map(e => e.source?.id ?? e.source));

    const insertAfterSection = (refNode, newNode) => {
      if (refNode && refNode.parentNode === ic && refNode.nextSibling) {
        ic.insertBefore(newNode, refNode.nextSibling);
      } else if (refNode && refNode.parentNode === ic) {
        ic.appendChild(newNode);
      } else {
        ic.appendChild(newNode);
      }
    };

    let lastOut = refsOutSection;
    let lastIn  = refsInSection;

    inheritanceChain.forEach((anc, ancIdx) => {
      const ancId    = anc.id;
      const ancLabel = anc.label || ancId;

      const ancAdj = _adj ? (_adj.get(ancId) || { out: [], in: [] })
                          : { out: graphState.graphData.edges, in: graphState.graphData.edges };
      const ancOut = (_adj
        ? ancAdj.out.filter(e => e.type === 'reference')
        : graphState.graphData.edges.filter(e => (e.source?.id ?? e.source) === ancId && e.type === 'reference')
      ).filter(e => !ownRefOutTargets.has(e.target?.id ?? e.target)).sort(byTargetLabel);

      const ancIn = (_adj
        ? ancAdj.in.filter(e => e.type === 'reference')
        : graphState.graphData.edges.filter(e => (e.target?.id ?? e.target) === ancId && e.type === 'reference')
      ).filter(e => !ownRefInSources.has(e.source?.id ?? e.source)).sort(bySourceLabel);

      if (ancOut.length) {
        const items = ancOut.map(e => {
          const item = makeEdgeItem(tgt(e), (e.field || e.label || '') + ' (from ' + ancLabel + ')', 'inherited');
          item.dataset.inheritedFrom = ancId;
          return item;
        });
        const sec = makeSection('inh-refs-out-' + ancIdx,
          'References out — inherited from ' + ancLabel + ' (' + ancOut.length + ')', items);
        if (sec) {
          sec.classList.add('insp-section-inherited');
          insertAfterSection(lastOut, sec);
          lastOut = sec;
        }
      }

      if (ancIn.length) {
        const items = ancIn.map(e => {
          const item = makeEdgeItem(src2(e), 'via ' + (e.field || e.label || '') + ' (targets ' + ancLabel + ')', 'inherited');
          item.dataset.inheritedFrom = ancId;
          return item;
        });
        const sec = makeSection('inh-refs-in-' + ancIdx,
          'Referenced by (targets ' + ancLabel + ') — ' + ancIn.length, items);
        if (sec) {
          sec.classList.add('insp-section-inherited');
          insertAfterSection(lastIn, sec);
          lastIn = sec;
        }
      }
    });
  }

  edgeSec('children',  'Child tables',
    [...kids].sort(bySourceLabel),
    src2, () => 'extends '+id, 'ext');

  if (m2mOut.length || m2mIn.length) {
    const all = [...m2mOut,...m2mIn].sort((a,b) => {
      const ai=tgt(a)||src2(a), bi=tgt(b)||src2(b);
      return nodeLabel(ai).localeCompare(nodeLabel(bi));
    });
    const items = all.map(e => {
      const tid = tgt(e)||src2(e);
      return makeEdgeItem(tid, 'junction: '+(e.label||''), 'm2m');
    });
    const sec = makeSection('m2m', `M2M relationships (${all.length})`, items);
    if (sec) ic.appendChild(sec);
  }

  if (relOut.length || relIn.length) {
    const all = [...relOut,...relIn].sort((a,b) => {
      const ai=tgt(a)||src2(a), bi=tgt(b)||src2(b);
      return nodeLabel(ai).localeCompare(nodeLabel(bi));
    });
    const items = all.map(e => makeEdgeItem(tgt(e)||src2(e), e.label||'', 'rel'));
    const sec = makeSection('rels', `Named relationships (${all.length})`, items);
    if (sec) ic.appendChild(sec);
  }

  if (ciRelOut.length || ciRelIn.length) {
    const all = [];
    ciRelOut.forEach(e => {
      const otherId = (e.target && e.target.id) || e.target;
      all.push({
        otherId,
        verbCentre: e.parentLabel || '',
        verbOther:  e.childLabel  || '',
        relType:    e.relTypeDisplay || ''
      });
    });
    ciRelIn.forEach(e => {
      const otherId = (e.source && e.source.id) || e.source;
      all.push({
        otherId,
        verbCentre: e.childLabel  || '',
        verbOther:  e.parentLabel || '',
        relType:    e.relTypeDisplay || ''
      });
    });
    all.sort((a, b) => nodeLabel(a.otherId).localeCompare(nodeLabel(b.otherId)));
    const items = all.map(r => makeEdgeItem(
      r.otherId,
      r.verbCentre + (r.verbOther ? '  ↔  ' + r.verbOther : ''),
      'cmdbrel'
    ));
    const sec = makeSection('cirel',
      `CI relationships — cmdb_rel_type_suggest (${all.length})`,
      items);
    if (sec) ic.appendChild(sec);
  }

  edgeSec('views', 'DB views',
    [...viewOf].sort(byTargetLabel),
    tgt, () => 'view member', 'view');
}

export function focusTable(id, clearSearch = true) {
  if (!graphState.graphData) return;
  uiState.hiddenNodes.clear();
  const node = graphState.graphData._nodeById
    ? graphState.graphData._nodeById.get(id)
    : graphState.graphData.nodes.find(n => n.id === id);
  if (!node) return;

  if (clearSearch && Settings.isEnabled('clearSearchOnSelect')) {
    Dom.searchBox.value = '';
    applyTableFilter('');
  }

  uiState.selectedNode = id;
  Dom.statFocus.textContent = id;
  updateHopDepthSlider();
  render();
  fillInspector(node);
  highlightListItem(id);

  if (Settings.isEnabled('autoFitOnSelect')) {
    setTimeout(() => { fitGraph(); }, 250);
  }

  pushHistory();
}

import { graphState, uiState } from '../../core/state.js';
import { Dom } from '../../core/dom.js';
import { svg, root, zoom } from '../../engine/canvas.js';
import { Settings } from '../settings/index.js';
import { typeLabel } from '../../engine/render.js';

export function syncPair(desktopId, mobileId, val) {
  [desktopId, mobileId].forEach(id => document.getElementById(id)?.classList.toggle('active', val));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);
}

function exportTimestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function exportSlug() {
  if (uiState.selectedNode) return uiState.selectedNode.replace(/[^a-z0-9_-]+/gi, '_');
  return 'schema';
}

export function exportSchemaJSON() {
  if (!graphState.graphData) return;
  const clean = {
    nodes: graphState.graphData.nodes.map(n => {
      const { x, y, vx, vy, fx, fy, index, ...rest } = n;
      return rest;
    }),
    edges: graphState.graphData.edges.map(e => {
      const { index, ...rest } = e;
      return {
        ...rest,
        source: rest.source?.id ?? rest.source,
        target: rest.target?.id ?? rest.target,
      };
    }),
  };
  const blob = new Blob([JSON.stringify(clean)], { type: 'application/json' });
  downloadBlob(blob, `sn_schema_${exportTimestamp()}.json`);
}

export function exportNeighbourhoodJSON() {
  if (!graphState.graphData || !uiState.selectedNode) {
    alert("Select a table first — there's no neighbourhood to export without one.");
    return;
  }
  const visible = new Set(uiState.connectedNodes);
  visible.add(uiState.selectedNode);
  for (const h of uiState.hiddenNodes) visible.delete(h);
  const nodes = graphState.graphData.nodes
    .filter(n => visible.has(n.id))
    .map(n => {
      const { x, y, vx, vy, fx, fy, index, ...rest } = n;
      return rest;
    });
  const edges = graphState.graphData.edges
    .map(e => {
      const s = e.source?.id ?? e.source;
      const t = e.target?.id ?? e.target;
      return { src: s, tgt: t, edge: e };
    })
    .filter(({ src, tgt }) => visible.has(src) && visible.has(tgt))
    .map(({ src, tgt, edge }) => {
      const { index, ...rest } = edge;
      return { ...rest, source: src, target: tgt };
    });
  const payload = {
    exportedAt: new Date().toISOString(),
    source: 'sn_schema_explorer.neighbourhood',
    rootTable: uiState.selectedNode,
    hopDepth: uiState.hopDepth,
    viewMode: uiState.viewMode,
    nodes,
    edges,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  downloadBlob(blob, `sn_neighbourhood_${exportSlug()}_${exportTimestamp()}.json`);
}

// ── Markdown export ───────────────────────────────────────────────────────────

/**
 * Convert one node to a Markdown section.
 * Includes: heading (with parent), fields table, outgoing refs, extended-by list.
 */
function _nodeToMarkdown(node, data, opts) {
  const etSet = new Set(
    (opts && opts.edgeTypes) || ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel']
  );
  const lines = [];
  const adj = data._adj?.get(node.id);
  const out = adj?.out || [];
  const inn = adj?.in || [];

  // Heading — include parent when extends edges are included
  const parentEdge = etSet.has('extends') ? out.find(e => e.type === 'extends') : null;
  const parentId = parentEdge ? (parentEdge.target?.id ?? parentEdge.target) : null;
  let heading = `## ${node.id}`;
  if (node.label && node.label !== node.id) heading += ` — ${node.label}`;
  if (parentId) heading += ` *(extends: ${parentId})*`;
  lines.push(heading, '');

  // Fields table
  if (node.fields?.length) {
    lines.push('| Field | Type | Label |');
    lines.push('|---|---|---|');
    for (const f of node.fields) {
      const tl = typeLabel(f.type) || f.type || '';
      const lbl = f.label && f.label !== f.name ? f.label : '';
      lines.push(`| \`${f.name}\` | ${tl} | ${lbl} |`);
    }
    lines.push('');
  }

  // Outgoing references
  if (etSet.has('reference')) {
    const refs = out
      .filter(e => e.type === 'reference')
      .map(e => {
        const tgt = e.target?.id ?? e.target;
        return e.field ? `\`${e.field}\` → ${tgt}` : `→ ${tgt}`;
      });
    if (refs.length) lines.push(`**References:** ${refs.join(', ')}`, '');
  }

  // Incoming references (referenced by)
  if (etSet.has('reference')) {
    const refsIn = inn
      .filter(e => e.type === 'reference')
      .map(e => {
        const src = e.source?.id ?? e.source;
        return e.field ? `${src}.\`${e.field}\`` : src;
      })
      .sort();
    if (refsIn.length) lines.push(`**Referenced by:** ${refsIn.join(', ')}`, '');
  }

  // Tables that extend this one
  if (etSet.has('extends')) {
    const extBy = inn
      .filter(e => e.type === 'extends')
      .map(e => e.source?.id ?? e.source)
      .sort();
    if (extBy.length) lines.push(`**Extended by:** ${extBy.join(', ')}`, '');
  }

  // M2M relationships
  if (etSet.has('m2m')) {
    const seen = new Set();
    const m2ms = [];
    for (const e of [...out, ...inn]) {
      if (e.type !== 'm2m') continue;
      const other =
        (e.source?.id ?? e.source) === node.id
          ? (e.target?.id ?? e.target)
          : (e.source?.id ?? e.source);
      const key = other + '\0' + (e.m2mTable || '');
      if (seen.has(key)) continue;
      seen.add(key);
      m2ms.push(e.m2mTable ? `${other} (via \`${e.m2mTable}\`)` : other);
    }
    m2ms.sort();
    if (m2ms.length) lines.push(`**M2M relationships:** ${m2ms.join(', ')}`, '');
  }

  // Named relationships
  if (etSet.has('rel')) {
    const seen = new Set();
    const rels = [];
    for (const e of [...out, ...inn]) {
      if (e.type !== 'rel') continue;
      const other =
        (e.source?.id ?? e.source) === node.id
          ? (e.target?.id ?? e.target)
          : (e.source?.id ?? e.source);
      const key = other + '\0' + (e.name || '');
      if (seen.has(key)) continue;
      seen.add(key);
      rels.push(e.name ? `${other} (${e.name})` : other);
    }
    rels.sort();
    if (rels.length) lines.push(`**Named relationships:** ${rels.join(', ')}`, '');
  }

  // CMDB CI topology
  if (etSet.has('cmdb_rel')) {
    const seen = new Set();
    const ciRels = [];
    for (const e of [...out, ...inn]) {
      if (e.type !== 'cmdb_rel') continue;
      const other =
        (e.source?.id ?? e.source) === node.id
          ? (e.target?.id ?? e.target)
          : (e.source?.id ?? e.source);
      const key = other + '\0' + (e.label || '');
      if (seen.has(key)) continue;
      seen.add(key);
      ciRels.push(e.label ? `${e.label} → ${other}` : other);
    }
    ciRels.sort();
    if (ciRels.length) lines.push(`**CI topology:** ${ciRels.join(', ')}`, '');
  }

  // DB View membership
  if (etSet.has('view')) {
    if (node._isView) {
      const viewIncludes = out
        .filter(e => e.type === 'view')
        .map(e => e.target?.id ?? e.target)
        .sort();
      if (viewIncludes.length)
        lines.push(`**View includes tables:** ${viewIncludes.join(', ')}`, '');
    } else {
      const memberOf = inn
        .filter(e => e.type === 'view')
        .map(e => e.source?.id ?? e.source)
        .sort();
      if (memberOf.length) lines.push(`**Member of views:** ${memberOf.join(', ')}`, '');
    }
  }

  return lines.join('\n');
}

function _markdownHeader(scope, data) {
  const instance = data?._instance?.instance_name || data?._instance?.instance_url || '';
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# ServiceNow Schema Export`,
    '',
    `> Generated by [SN Schema Explorer](https://github.com/revampd/sn-schema-explorer) on ${date}` +
      (instance ? ` — instance: ${instance}` : ''),
    '',
    scope === 'neighbourhood'
      ? `**Scope:** neighbourhood of \`${uiState.selectedNode}\` (${uiState.hopDepth} hop${uiState.hopDepth !== 1 ? 's' : ''})`
      : `**Scope:** full schema`,
    '',
    '---',
    '',
  ];
  return lines.join('\n');
}

// ── Node/edge collection helpers ─────────────────────────────────────────────

/**
 * Return a sorted array of nodes for the given scope.
 * scope: 'full' | 'neighbourhood'
 * Returns null if neighbourhood scope requested but nothing is selected.
 */
function _collectNodes(scope, data) {
  if (!data) data = graphState.graphData;
  if (!data) return null;
  if (scope === 'neighbourhood') {
    if (!uiState.selectedNode) return null;
    const visible = new Set(uiState.connectedNodes);
    visible.add(uiState.selectedNode);
    for (const h of uiState.hiddenNodes) visible.delete(h);
    return data.nodes.filter(n => visible.has(n.id)).sort((a, b) => a.id.localeCompare(b.id));
  }
  return data.nodes.filter(n => !n._diffOnly).sort((a, b) => a.id.localeCompare(b.id));
}

export function exportNeighbourhoodMarkdown() {
  if (!graphState.graphData || !uiState.selectedNode) {
    alert("Select a table first — there's no neighbourhood to export without one.");
    return;
  }
  const data = graphState.graphData;
  const nodes = _collectNodes('neighbourhood', data);
  if (!nodes) return;
  let md = _markdownHeader('neighbourhood', data);
  md += nodes.map(n => _nodeToMarkdown(n, data)).join('\n---\n\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  downloadBlob(blob, `sn_neighbourhood_${exportSlug()}_${exportTimestamp()}.md`);
}

export function exportSchemaMarkdown() {
  if (!graphState.graphData) return;
  const data = graphState.graphData;
  const nodes = _collectNodes('full', data);
  let md = _markdownHeader('full', data);
  md += nodes.map(n => _nodeToMarkdown(n, data)).join('\n---\n\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  downloadBlob(blob, `sn_schema_${exportTimestamp()}.md`);
}

// ── JSON-LD export ────────────────────────────────────────────────────────────

/** SN internal type → XSD type (used by JSON-LD and OWL/Turtle serialisers) */
const _TYPE_XSD = {
  string: 'xsd:string',
  string_full_utf8: 'xsd:string',
  html: 'xsd:string',
  url: 'xsd:anyURI',
  translated_text: 'xsd:string',
  phone_number: 'xsd:string',
  char: 'xsd:string',
  GUID: 'xsd:string',
  password: 'xsd:string',
  integer: 'xsd:integer',
  smallint: 'xsd:integer',
  longint: 'xsd:integer',
  float: 'xsd:decimal',
  decimal: 'xsd:decimal',
  currency: 'xsd:decimal',
  boolean: 'xsd:boolean',
  glide_date_time: 'xsd:dateTime',
  due_date: 'xsd:dateTime',
  glide_date: 'xsd:date',
  glide_time: 'xsd:time',
};
function _snTypeToXsd(type) {
  return _TYPE_XSD[type] || 'xsd:string';
}

function _nodeToJsonLd(node, data, opts) {
  const etSet = new Set(
    (opts && opts.edgeTypes) || ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel']
  );
  const adj = data._adj?.get(node.id);
  const out = adj?.out || [];
  const inn = adj?.in || [];

  const cls = {
    '@id': 'snp:' + node.id,
    '@type': node._isView ? ['owl:Class', 'sn:DbView'] : 'owl:Class',
    'rdfs:label': node.label || node.id,
    'sn:technicalName': node.id,
    'sn:scope': node.scope || 'Global',
  };
  if (node.ws_access === false) cls['sn:wsAccessible'] = false;

  if (etSet.has('extends')) {
    const parentEdge = out.find(e => e.type === 'extends');
    if (parentEdge)
      cls['rdfs:subClassOf'] = { '@id': 'snp:' + (parentEdge.target?.id ?? parentEdge.target) };
    const children = inn
      .filter(e => e.type === 'extends')
      .map(e => ({ '@id': 'snp:' + (e.source?.id ?? e.source) }));
    if (children.length) cls['sn:extendedBy'] = children.length === 1 ? children[0] : children;
  }

  if (node.fields?.length) {
    cls['sn:fields'] = node.fields.map(f => {
      const isRef = f.type === 'reference';
      const fd = {
        '@type': isRef ? 'owl:ObjectProperty' : 'owl:DatatypeProperty',
        'rdfs:label': f.label || f.name,
        'sn:technicalName': f.name,
        'sn:dataType': f.type || 'string',
      };
      if (isRef && etSet.has('reference')) {
        const refEdge = out.find(e => e.type === 'reference' && e.field === f.name);
        if (refEdge) fd['rdfs:range'] = { '@id': 'snp:' + (refEdge.target?.id ?? refEdge.target) };
      } else if (!isRef) {
        fd['rdfs:range'] = { '@id': _snTypeToXsd(f.type) };
      }
      if (f.mandatory) fd['sn:mandatory'] = true;
      if (f.primary) fd['sn:primary'] = true;
      return fd;
    });
  }

  if (etSet.has('m2m')) {
    const seen = new Set();
    const m2ms = [];
    for (const e of [...out, ...inn]) {
      if (e.type !== 'm2m') continue;
      const other =
        (e.source?.id ?? e.source) === node.id
          ? (e.target?.id ?? e.target)
          : (e.source?.id ?? e.source);
      if (seen.has(other)) continue;
      seen.add(other);
      const r = { 'sn:relatedTable': { '@id': 'snp:' + other } };
      if (e.m2mTable) r['sn:junctionTable'] = e.m2mTable;
      m2ms.push(r);
    }
    if (m2ms.length) cls['sn:m2mRelationships'] = m2ms.length === 1 ? m2ms[0] : m2ms;
  }

  if (etSet.has('rel')) {
    const seen = new Set();
    const rels = [];
    for (const e of [...out, ...inn]) {
      if (e.type !== 'rel') continue;
      const other =
        (e.source?.id ?? e.source) === node.id
          ? (e.target?.id ?? e.target)
          : (e.source?.id ?? e.source);
      const key = other + '\0' + (e.name || '');
      if (seen.has(key)) continue;
      seen.add(key);
      rels.push({ 'sn:relatedTable': { '@id': 'snp:' + other }, 'rdfs:label': e.name || '' });
    }
    if (rels.length) cls['sn:namedRelationships'] = rels.length === 1 ? rels[0] : rels;
  }

  if (etSet.has('cmdb_rel')) {
    const seen = new Set();
    const ciRels = [];
    for (const e of [...out, ...inn]) {
      if (e.type !== 'cmdb_rel') continue;
      const other =
        (e.source?.id ?? e.source) === node.id
          ? (e.target?.id ?? e.target)
          : (e.source?.id ?? e.source);
      const key = other + '\0' + (e.label || '');
      if (seen.has(key)) continue;
      seen.add(key);
      ciRels.push({ 'sn:relatedClass': { '@id': 'snp:' + other }, 'rdfs:label': e.label || '' });
    }
    if (ciRels.length) cls['sn:ciTopology'] = ciRels.length === 1 ? ciRels[0] : ciRels;
  }

  if (etSet.has('view')) {
    if (node._isView) {
      const v = out
        .filter(e => e.type === 'view')
        .map(e => ({ '@id': 'snp:' + (e.target?.id ?? e.target) }));
      if (v.length) cls['sn:viewIncludes'] = v.length === 1 ? v[0] : v;
    } else {
      const v = inn
        .filter(e => e.type === 'view')
        .map(e => ({ '@id': 'snp:' + (e.source?.id ?? e.source) }));
      if (v.length) cls['sn:memberOfView'] = v.length === 1 ? v[0] : v;
    }
  }

  return cls;
}

function _schemaToJsonLd(nodes, data, opts) {
  const inst = data?._instance?.instance_name || data?._instance?.instance_url || '';
  const context = {
    owl: 'http://www.w3.org/2002/07/owl#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    sn: 'https://servicenow.com/schema#',
    snp: 'https://servicenow.com/table/',
  };
  const meta = {
    '@id': 'https://servicenow.com/schema',
    '@type': 'owl:Ontology',
    'rdfs:label': 'ServiceNow Schema' + (inst ? ' — ' + inst : ''),
    'sn:exportedAt': new Date().toISOString(),
    'sn:scope': (opts && opts.scope) || 'full',
  };
  return JSON.stringify({
    '@context': context,
    '@graph': [meta, ...nodes.map(n => _nodeToJsonLd(n, data, opts))],
  });
}

export function exportSchemaJsonLd() {
  if (!graphState.graphData) return;
  const data = graphState.graphData;
  const nodes = _collectNodes('full', data);
  const blob = new Blob([_schemaToJsonLd(nodes, data)], { type: 'application/ld+json' });
  downloadBlob(blob, `sn_schema_${exportTimestamp()}.jsonld`);
}

export function exportNeighbourhoodJsonLd() {
  if (!graphState.graphData || !uiState.selectedNode) {
    alert("Select a table first — there's no neighbourhood to export without one.");
    return;
  }
  const data = graphState.graphData;
  const nodes = _collectNodes('neighbourhood', data);
  if (!nodes) return;
  const blob = new Blob([_schemaToJsonLd(nodes, data, { scope: 'neighbourhood' })], {
    type: 'application/ld+json',
  });
  downloadBlob(blob, `sn_neighbourhood_${exportSlug()}_${exportTimestamp()}.jsonld`);
}

// ── OWL / Turtle export ───────────────────────────────────────────────────────

function _ttlLit(s) {
  return (
    '"' +
    String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n') +
    '"'
  );
}
function _ttlId(s) {
  // Sanitize identifier for use as Turtle local name (after prefix:)
  return String(s)
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^([^a-zA-Z_])/, '_$1');
}
function _ttlBlock(subj, pairs) {
  if (!pairs.length) return subj + ' .\n\n';
  const lines = [subj];
  for (let i = 0; i < pairs.length; i++) {
    lines.push('  ' + pairs[i][0] + ' ' + pairs[i][1] + (i < pairs.length - 1 ? ' ;' : ' .'));
  }
  return lines.join('\n') + '\n\n';
}

function _schemaToTurtle(nodes, data, opts) {
  const etSet = new Set(
    (opts && opts.edgeTypes) || ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel']
  );
  const inst = data?._instance?.instance_name || data?._instance?.instance_url || '';
  const date = new Date().toISOString();
  const out_lines = [
    '@prefix owl:  <http://www.w3.org/2002/07/owl#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix sn:   <https://servicenow.com/schema#> .',
    '@prefix snp:  <https://servicenow.com/table/> .',
    '',
    '# ServiceNow Schema Export' + (inst ? ' — ' + inst : ''),
    '# Generated: ' + date,
    '',
    _ttlBlock('<https://servicenow.com/schema>', [
      ['a', 'owl:Ontology'],
      ['rdfs:label', _ttlLit('ServiceNow Schema' + (inst ? ' — ' + inst : ''))],
      ['sn:exportedAt', _ttlLit(date) + '^^xsd:dateTime'],
    ]),
  ];

  for (const node of nodes) {
    const id = _ttlId(node.id);
    const adj = data._adj?.get(node.id);
    const edgeOut = adj?.out || [];
    const edgeIn = adj?.in || [];

    // Class declaration
    const clsPairs = [
      ['a', node._isView ? 'owl:Class, sn:DbView' : 'owl:Class'],
      ['rdfs:label', _ttlLit(node.label || node.id)],
      ['sn:technicalName', _ttlLit(node.id)],
      ['sn:scope', _ttlLit(node.scope || 'Global')],
    ];
    if (node.ws_access === false) clsPairs.push(['sn:wsAccessible', '"false"^^xsd:boolean']);
    if (etSet.has('extends')) {
      const parentEdge = edgeOut.find(e => e.type === 'extends');
      if (parentEdge)
        clsPairs.push([
          'rdfs:subClassOf',
          'snp:' + _ttlId(parentEdge.target?.id ?? parentEdge.target),
        ]);
    }
    // DB view membership (added to class block)
    if (etSet.has('view')) {
      if (node._isView) {
        for (const e of edgeOut) {
          if (e.type === 'view')
            clsPairs.push(['sn:viewIncludes', 'snp:' + _ttlId(e.target?.id ?? e.target)]);
        }
      } else {
        for (const e of edgeIn) {
          if (e.type === 'view')
            clsPairs.push(['sn:memberOfView', 'snp:' + _ttlId(e.source?.id ?? e.source)]);
        }
      }
    }
    out_lines.push(_ttlBlock('snp:' + id, clsPairs));

    // Field properties
    if (node.fields?.length) {
      for (const f of node.fields) {
        const isRef = f.type === 'reference';
        const propPairs = [
          ['a', isRef ? 'owl:ObjectProperty' : 'owl:DatatypeProperty'],
          ['rdfs:label', _ttlLit(f.label || f.name)],
          ['sn:technicalName', _ttlLit(f.name)],
          ['rdfs:domain', 'snp:' + id],
        ];
        if (isRef && etSet.has('reference')) {
          const refEdge = edgeOut.find(e => e.type === 'reference' && e.field === f.name);
          if (refEdge)
            propPairs.push(['rdfs:range', 'snp:' + _ttlId(refEdge.target?.id ?? refEdge.target)]);
        } else if (!isRef) {
          propPairs.push(['rdfs:range', _snTypeToXsd(f.type)]);
        }
        out_lines.push(_ttlBlock('sn:' + _ttlId(node.id + '_' + f.name), propPairs));
      }
    }

    // M2M associations
    if (etSet.has('m2m')) {
      const seen = new Set();
      for (const e of [...edgeOut, ...edgeIn]) {
        if (e.type !== 'm2m') continue;
        const other =
          (e.source?.id ?? e.source) === node.id
            ? (e.target?.id ?? e.target)
            : (e.source?.id ?? e.source);
        const key = node.id + '\0' + other;
        if (seen.has(key)) continue;
        seen.add(key);
        const m2mPairs = [
          ['a', 'sn:M2MRelationship'],
          ['rdfs:domain', 'snp:' + id],
          ['rdfs:range', 'snp:' + _ttlId(other)],
        ];
        if (e.m2mTable) m2mPairs.push(['sn:junctionTable', _ttlLit(e.m2mTable)]);
        out_lines.push(_ttlBlock('sn:m2m_' + _ttlId(node.id) + '_' + _ttlId(other), m2mPairs));
      }
    }

    // Named relationship associations
    if (etSet.has('rel')) {
      const seen = new Set();
      for (const e of [...edgeOut, ...edgeIn]) {
        if (e.type !== 'rel') continue;
        const other =
          (e.source?.id ?? e.source) === node.id
            ? (e.target?.id ?? e.target)
            : (e.source?.id ?? e.source);
        const key = other + '\0' + (e.name || '');
        if (seen.has(key)) continue;
        seen.add(key);
        const relPairs = [
          ['a', 'sn:NamedRelationship'],
          ['rdfs:domain', 'snp:' + id],
          ['rdfs:range', 'snp:' + _ttlId(other)],
        ];
        if (e.name) relPairs.push(['sn:name', _ttlLit(e.name)]);
        out_lines.push(
          _ttlBlock(
            'sn:rel_' +
              _ttlId(node.id) +
              '_' +
              _ttlId(other) +
              (e.name ? '_' + _ttlId(e.name) : ''),
            relPairs
          )
        );
      }
    }

    // CMDB CI topology
    if (etSet.has('cmdb_rel')) {
      const seen = new Set();
      for (const e of [...edgeOut, ...edgeIn]) {
        if (e.type !== 'cmdb_rel') continue;
        const other =
          (e.source?.id ?? e.source) === node.id
            ? (e.target?.id ?? e.target)
            : (e.source?.id ?? e.source);
        const key = other + '\0' + (e.label || '');
        if (seen.has(key)) continue;
        seen.add(key);
        const ciPairs = [
          ['a', 'sn:CiRelationship'],
          ['rdfs:domain', 'snp:' + id],
          ['rdfs:range', 'snp:' + _ttlId(other)],
        ];
        if (e.label) ciPairs.push(['sn:relationshipType', _ttlLit(e.label)]);
        out_lines.push(
          _ttlBlock(
            'sn:ciRel_' +
              _ttlId(node.id) +
              '_' +
              _ttlId(other) +
              (e.label ? '_' + _ttlId(e.label) : ''),
            ciPairs
          )
        );
      }
    }
  }

  return out_lines.join('\n');
}

export function exportSchemaTurtle() {
  if (!graphState.graphData) return;
  const data = graphState.graphData;
  const nodes = _collectNodes('full', data);
  const blob = new Blob([_schemaToTurtle(nodes, data)], { type: 'text/turtle;charset=utf-8' });
  downloadBlob(blob, `sn_schema_${exportTimestamp()}.ttl`);
}

export function exportNeighbourhoodTurtle() {
  if (!graphState.graphData || !uiState.selectedNode) {
    alert("Select a table first — there's no neighbourhood to export without one.");
    return;
  }
  const data = graphState.graphData;
  const nodes = _collectNodes('neighbourhood', data);
  if (!nodes) return;
  const blob = new Blob([_schemaToTurtle(nodes, data)], { type: 'text/turtle;charset=utf-8' });
  downloadBlob(blob, `sn_neighbourhood_${exportSlug()}_${exportTimestamp()}.ttl`);
}

// ── OpenAPI / YAML export ─────────────────────────────────────────────────────

const _TYPE_OPENAPI = {
  string: 'string',
  string_full_utf8: 'string',
  html: 'string',
  url: 'string',
  translated_text: 'string',
  phone_number: 'string',
  char: 'string',
  GUID: 'string',
  password: 'string',
  integer: 'integer',
  smallint: 'integer',
  longint: 'integer',
  float: 'number',
  decimal: 'number',
  currency: 'number',
  boolean: 'boolean',
  glide_date_time: 'string',
  due_date: 'string',
  glide_date: 'string',
  glide_time: 'string',
};
const _TYPE_OPENAPI_FMT = {
  url: 'uri',
  float: 'float',
  decimal: 'double',
  currency: 'double',
  longint: 'int64',
  smallint: 'int32',
  glide_date_time: 'date-time',
  due_date: 'date-time',
  glide_date: 'date',
  glide_time: 'time',
};

function _yamlStr(s) {
  s = String(s == null ? '' : s);
  // Simple values that don't need quoting
  if (
    /^[a-zA-Z0-9_.-]+$/.test(s) &&
    s.length > 0 &&
    !['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(s.toLowerCase())
  )
    return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

function _schemaToOpenApi(nodes, data, opts) {
  const etSet = new Set(
    (opts && opts.edgeTypes) || ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel']
  );
  const inst = data?._instance?.instance_name || data?._instance?.instance_url || '';
  const instUrl = data?._instance?.instance_url || '';
  const date = new Date().toISOString();
  const nodeIds = new Set(nodes.map(n => n.id));

  const lines = [
    'openapi: 3.0.3',
    'info:',
    '  title: ' + _yamlStr('ServiceNow Schema' + (inst ? ' — ' + inst : '')),
    '  description: ' + _yamlStr('Exported by SN Schema Explorer on ' + date),
    '  version: ' + _yamlStr(data?._instance?.build_name || '1.0'),
  ];
  if (instUrl) {
    lines.push('servers:');
    lines.push('  - url: ' + _yamlStr(instUrl));
    lines.push('    description: ' + _yamlStr(inst || 'ServiceNow instance'));
  }

  // Table API CRUD paths — GET/POST collection endpoint, GET/PATCH/DELETE by sys_id
  // DB views are read-only (no POST/PATCH/DELETE).
  lines.push('paths:');
  for (const node of nodes) {
    const opId = node.id.replace(/[^a-zA-Z0-9]/g, '_');
    const ref = _yamlStr('#/components/schemas/' + node.id);
    const lbl = node.label || node.id;
    lines.push('  /api/now/table/' + node.id + ':');
    lines.push('    get:');
    lines.push('      summary: ' + _yamlStr('Query ' + lbl));
    lines.push('      operationId: list_' + opId);
    lines.push('      tags: [' + _yamlStr(node.id) + ']');
    lines.push('      parameters:');
    lines.push('        - {name: sysparm_query, in: query, schema: {type: string}}');
    lines.push(
      '        - {name: sysparm_limit, in: query, schema: {type: integer, default: 10000}}'
    );
    lines.push('        - {name: sysparm_offset, in: query, schema: {type: integer, default: 0}}');
    lines.push('        - {name: sysparm_fields, in: query, schema: {type: string}}');
    lines.push(
      '        - {name: sysparm_display_value, in: query, schema: {type: string, enum: ["true","false","all"], default: "false"}}'
    );
    lines.push(
      '        - {name: sysparm_exclude_reference_link, in: query, schema: {type: boolean, default: false}}'
    );
    lines.push(
      '        - {name: sysparm_suppress_pagination_header, in: query, schema: {type: boolean, default: false}}'
    );
    lines.push('        - {name: sysparm_view, in: query, schema: {type: string}}');
    lines.push('      responses:');
    lines.push('        "200":');
    lines.push('          description: OK');
    lines.push('          content:');
    lines.push('            application/json:');
    lines.push('              schema:');
    lines.push('                properties:');
    lines.push('                  result:');
    lines.push('                    type: array');
    lines.push('                    items: {$ref: ' + ref + '}');
    if (!node._isView) {
      lines.push('    post:');
      lines.push('      summary: ' + _yamlStr('Create ' + lbl));
      lines.push('      operationId: create_' + opId);
      lines.push('      tags: [' + _yamlStr(node.id) + ']');
      lines.push('      parameters:');
      lines.push(
        '        - {name: sysparm_display_value, in: query, schema: {type: string, enum: ["true","false","all"], default: "false"}}'
      );
      lines.push(
        '        - {name: sysparm_input_display_value, in: query, schema: {type: boolean, default: false}}'
      );
      lines.push('      requestBody:');
      lines.push('        content:');
      lines.push('          application/json:');
      lines.push('            schema: {$ref: ' + ref + '}');
      lines.push('      responses:');
      lines.push('        "201":');
      lines.push('          description: Created');
      lines.push('          content:');
      lines.push('            application/json:');
      lines.push('              schema:');
      lines.push('                properties:');
      lines.push('                  result: {$ref: ' + ref + '}');
    }
    lines.push('  /api/now/table/' + node.id + '/{sys_id}:');
    lines.push('    parameters:');
    lines.push('      - {name: sys_id, in: path, required: true, schema: {type: string}}');
    lines.push('    get:');
    lines.push('      summary: ' + _yamlStr('Get ' + lbl));
    lines.push('      operationId: get_' + opId);
    lines.push('      tags: [' + _yamlStr(node.id) + ']');
    lines.push('      parameters:');
    lines.push(
      '        - {name: sysparm_display_value, in: query, schema: {type: string, enum: ["true","false","all"], default: "false"}}'
    );
    lines.push(
      '        - {name: sysparm_exclude_reference_link, in: query, schema: {type: boolean, default: false}}'
    );
    lines.push('        - {name: sysparm_fields, in: query, schema: {type: string}}');
    lines.push('      responses:');
    lines.push('        "200":');
    lines.push('          description: OK');
    lines.push('          content:');
    lines.push('            application/json:');
    lines.push('              schema:');
    lines.push('                properties:');
    lines.push('                  result: {$ref: ' + ref + '}');
    if (!node._isView) {
      lines.push('    patch:');
      lines.push('      summary: ' + _yamlStr('Update ' + lbl));
      lines.push('      operationId: patch_' + opId);
      lines.push('      tags: [' + _yamlStr(node.id) + ']');
      lines.push('      parameters:');
      lines.push(
        '        - {name: sysparm_display_value, in: query, schema: {type: string, enum: ["true","false","all"], default: "false"}}'
      );
      lines.push(
        '        - {name: sysparm_input_display_value, in: query, schema: {type: boolean, default: false}}'
      );
      lines.push('      requestBody:');
      lines.push('        content:');
      lines.push('          application/json:');
      lines.push('            schema: {$ref: ' + ref + '}');
      lines.push('      responses:');
      lines.push('        "200":');
      lines.push('          description: OK');
      lines.push('          content:');
      lines.push('            application/json:');
      lines.push('              schema:');
      lines.push('                properties:');
      lines.push('                  result: {$ref: ' + ref + '}');
      lines.push('    delete:');
      lines.push('      summary: ' + _yamlStr('Delete ' + lbl));
      lines.push('      operationId: delete_' + opId);
      lines.push('      tags: [' + _yamlStr(node.id) + ']');
      lines.push('      responses:');
      lines.push('        "204": {description: "No Content"}');
    }
  }
  lines.push('components:');
  lines.push('  schemas:');

  for (const node of nodes) {
    const adj = data._adj?.get(node.id);
    const edgeOut = adj?.out || [];
    const edgeIn = adj?.in || [];
    const i4 = '    '; // 4-space indent (under components.schemas)

    lines.push(i4 + _yamlStr(node.id) + ':');
    lines.push(i4 + '  type: object');
    if (node.label && node.label !== node.id) lines.push(i4 + '  title: ' + _yamlStr(node.label));
    if (node.scope) lines.push(i4 + '  x-sn-scope: ' + _yamlStr(node.scope));
    if (node._isView) lines.push(i4 + '  x-sn-is-view: true');
    if (node.ws_access === false) lines.push(i4 + '  x-sn-ws-accessible: false');

    if (etSet.has('extends')) {
      const parentEdge = edgeOut.find(e => e.type === 'extends');
      if (parentEdge) {
        const pid = parentEdge.target?.id ?? parentEdge.target;
        lines.push(
          i4 + '  x-sn-extends: ' + _yamlStr(nodeIds.has(pid) ? '#/components/schemas/' + pid : pid)
        );
      }
    }

    if (node.fields?.length) {
      lines.push(i4 + '  properties:');
      for (const f of node.fields) {
        lines.push(i4 + '    ' + _yamlStr(f.name) + ':');
        const isRef = f.type === 'reference';
        if (isRef && etSet.has('reference')) {
          const refEdge = edgeOut.find(e => e.type === 'reference' && e.field === f.name);
          const tgt = refEdge ? (refEdge.target?.id ?? refEdge.target) : null;
          if (tgt && nodeIds.has(tgt)) {
            lines.push(i4 + '      $ref: ' + _yamlStr('#/components/schemas/' + tgt));
          } else {
            lines.push(i4 + '      type: string');
            if (tgt) lines.push(i4 + '      x-sn-reference: ' + _yamlStr(tgt));
          }
        } else {
          const oaType = _TYPE_OPENAPI[f.type] || 'string';
          const oaFmt = _TYPE_OPENAPI_FMT[f.type];
          lines.push(i4 + '      type: ' + oaType);
          if (oaFmt) lines.push(i4 + '      format: ' + oaFmt);
        }
        lines.push(i4 + '      x-sn-type: ' + _yamlStr(f.type || 'string'));
        if (f.label && f.label !== f.name) lines.push(i4 + '      title: ' + _yamlStr(f.label));
        if (f.mandatory) lines.push(i4 + '      x-sn-mandatory: true');
      }
    }

    // M2M as YAML extension list
    if (etSet.has('m2m')) {
      const seen = new Set();
      const m2ms = [];
      for (const e of [...edgeOut, ...edgeIn]) {
        if (e.type !== 'm2m') continue;
        const other =
          (e.source?.id ?? e.source) === node.id
            ? (e.target?.id ?? e.target)
            : (e.source?.id ?? e.source);
        if (seen.has(other)) continue;
        seen.add(other);
        m2ms.push({ table: other, junctionTable: e.m2mTable || null });
      }
      if (m2ms.length) {
        lines.push(i4 + '  x-sn-m2m:');
        for (const m of m2ms) {
          lines.push(i4 + '    - table: ' + _yamlStr(m.table));
          if (m.junctionTable) lines.push(i4 + '      junctionTable: ' + _yamlStr(m.junctionTable));
        }
      }
    }

    // Named rels as YAML extension list
    if (etSet.has('rel')) {
      const seen = new Set();
      const rels = [];
      for (const e of [...edgeOut, ...edgeIn]) {
        if (e.type !== 'rel') continue;
        const other =
          (e.source?.id ?? e.source) === node.id
            ? (e.target?.id ?? e.target)
            : (e.source?.id ?? e.source);
        const key = other + '\0' + (e.name || '');
        if (seen.has(key)) continue;
        seen.add(key);
        rels.push({ table: other, name: e.name || '' });
      }
      if (rels.length) {
        lines.push(i4 + '  x-sn-relationships:');
        for (const r of rels) {
          lines.push(i4 + '    - table: ' + _yamlStr(r.table));
          if (r.name) lines.push(i4 + '      name: ' + _yamlStr(r.name));
        }
      }
    }

    // CMDB CI topology as YAML extension list
    if (etSet.has('cmdb_rel')) {
      const seen = new Set();
      const ciRels = [];
      for (const e of [...edgeOut, ...edgeIn]) {
        if (e.type !== 'cmdb_rel') continue;
        const other =
          (e.source?.id ?? e.source) === node.id
            ? (e.target?.id ?? e.target)
            : (e.source?.id ?? e.source);
        const key = other + '\0' + (e.label || '');
        if (seen.has(key)) continue;
        seen.add(key);
        ciRels.push({ table: other, label: e.label || '' });
      }
      if (ciRels.length) {
        lines.push(i4 + '  x-sn-ci-topology:');
        for (const r of ciRels) {
          lines.push(i4 + '    - table: ' + _yamlStr(r.table));
          if (r.label) lines.push(i4 + '      label: ' + _yamlStr(r.label));
        }
      }
    }

    // DB view membership as YAML extension lists
    if (etSet.has('view')) {
      if (node._isView) {
        const members = edgeOut.filter(e => e.type === 'view').map(e => e.target?.id ?? e.target);
        if (members.length) {
          lines.push(i4 + '  x-sn-view-includes:');
          for (const m of members) lines.push(i4 + '    - ' + _yamlStr(m));
        }
      } else {
        const views = edgeIn.filter(e => e.type === 'view').map(e => e.source?.id ?? e.source);
        if (views.length) {
          lines.push(i4 + '  x-sn-member-of-view:');
          for (const v of views) lines.push(i4 + '    - ' + _yamlStr(v));
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}

export function exportSchemaOpenApi() {
  if (!graphState.graphData) return;
  const data = graphState.graphData;
  const nodes = _collectNodes('full', data);
  const blob = new Blob([_schemaToOpenApi(nodes, data)], { type: 'application/yaml' });
  downloadBlob(blob, `sn_schema_${exportTimestamp()}.yaml`);
}

export function exportNeighbourhoodOpenApi() {
  if (!graphState.graphData || !uiState.selectedNode) {
    alert("Select a table first — there's no neighbourhood to export without one.");
    return;
  }
  const data = graphState.graphData;
  const nodes = _collectNodes('neighbourhood', data);
  if (!nodes) return;
  const blob = new Blob([_schemaToOpenApi(nodes, data)], { type: 'application/yaml' });
  downloadBlob(blob, `sn_neighbourhood_${exportSlug()}_${exportTimestamp()}.yaml`);
}

export function buildExportSvg(opts) {
  opts = opts || {};
  const scope = opts.scope || 'viewport';
  const svgEl = document.getElementById('graph');
  if (!svgEl) return null;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  let exportWidth, exportHeight;
  if (scope === 'full') {
    const liveRoot = document.getElementById('graph-root');
    if (liveRoot) {
      let bb;
      try {
        bb = liveRoot.getBBox();
      } catch (_) {
        bb = null;
      }
      if (bb && bb.width > 0 && bb.height > 0) {
        const MARGIN = 40;
        const x = Math.floor(bb.x - MARGIN);
        const y = Math.floor(bb.y - MARGIN);
        const w = Math.ceil(bb.width + MARGIN * 2);
        const h = Math.ceil(bb.height + MARGIN * 2);
        clone.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
        clone.setAttribute('width', w);
        clone.setAttribute('height', h);
        exportWidth = w;
        exportHeight = h;
        const cloneRoot = clone.querySelector('#graph-root');
        if (cloneRoot) cloneRoot.removeAttribute('transform');
      }
    }
  }
  if (!exportWidth) {
    const rect = svgEl.getBoundingClientRect();
    exportWidth = Math.round(rect.width);
    exportHeight = Math.round(rect.height);
    clone.setAttribute('width', exportWidth);
    clone.setAttribute('height', exportHeight);
  }
  const STYLE_PROPS = [
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-dasharray',
    'stroke-linecap',
    'stroke-linejoin',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
    'text-anchor',
    'dominant-baseline',
  ];
  const CONTAINER_SKIP = new Set([
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'color',
  ]);
  const CONTAINER_TAGS = new Set(['g', 'svg', 'defs', 'marker', 'symbol', 'pattern']);

  const liveEls = svgEl.querySelectorAll('*');
  const cloneEls = clone.querySelectorAll('*');
  for (let i = 0; i < liveEls.length; i++) {
    const liveEl = liveEls[i];
    const cloneEl = cloneEls[i];
    if (!cloneEl) continue;
    const tag = liveEl.tagName.toLowerCase();
    const isContainer = CONTAINER_TAGS.has(tag);
    const cs = getComputedStyle(liveEl);
    let inline = '';
    for (const p of STYLE_PROPS) {
      if (isContainer && CONTAINER_SKIP.has(p)) continue;
      const v = cs.getPropertyValue(p);
      if (!v) continue;
      if (v === 'normal') continue;
      inline += `${p}:${v};`;
    }
    if (liveEl.style.display === 'none') inline += 'display:none;';
    if (liveEl.style.visibility === 'hidden') inline += 'visibility:hidden;';
    if (inline) cloneEl.setAttribute('style', inline);
  }

  const _exportBg = getExportBgColor();
  if (_exportBg !== 'transparent') {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const vb = clone.getAttribute('viewBox');
    if (vb) {
      const parts = vb.split(/\s+/).map(Number);
      bg.setAttribute('x', parts[0]);
      bg.setAttribute('y', parts[1]);
      bg.setAttribute('width', parts[2]);
      bg.setAttribute('height', parts[3]);
    } else {
      bg.setAttribute('width', '100%');
      bg.setAttribute('height', '100%');
    }
    bg.setAttribute(
      'fill',
      _exportBg || getComputedStyle(document.getElementById('canvas')).backgroundColor || '#0b1220'
    );
    clone.insertBefore(bg, clone.firstChild);
  }
  // 'transparent' → no rect inserted; PNG canvas default is transparent,
  // SVG renders without a background element.
  return {
    svg: new XMLSerializer().serializeToString(clone),
    width: exportWidth,
    height: exportHeight,
  };
}

const PNG_SCALE_KEY = 'snse:pngExportScale';
export function getPngExportScale() {
  const raw = localStorage.getItem(PNG_SCALE_KEY);
  const n = parseInt(raw, 10);
  const max = Settings.getMaxPngScale();
  if (n >= 1 && n <= max) return n;
  return Math.min(2, max);
}
export function setPngExportScale(n) {
  n = Math.max(1, Math.min(Settings.getMaxPngScale(), Math.round(n)));
  try {
    localStorage.setItem(PNG_SCALE_KEY, String(n));
  } catch (e) {
    console.warn('Export: localStorage write failed', e);
  }
  const slider = document.getElementById('export-scale-slider');
  if (slider) slider.value = n;
  const valEl = document.getElementById('export-scale-val');
  if (valEl) valEl.textContent = n + '×';
  _updateScaleInfo(n);
}

const EXPORT_BG_KEY = 'snse:exportBgColor';

export function getExportBgColor() {
  // null → use canvas computed background (default behaviour)
  // hex string → user-chosen solid color
  // 'transparent' → no background rect
  return localStorage.getItem(EXPORT_BG_KEY) || null;
}

export function setExportBgColor(value) {
  try {
    localStorage.setItem(EXPORT_BG_KEY, value);
  } catch (e) {
    console.warn('Export: localStorage write failed', e);
  }
  _syncBgUI();
}

function _normaliseHex(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/^#+/, '');
  // Expand 3-digit shorthand (#abc → #aabbcc)
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return '#' + s.toLowerCase();
}

// ── Custom HSV color picker ───────────────────────────────────────────────────

let _cpH = 200,
  _cpS = 0.7,
  _cpV = 0.15; // HSV state (h: 0–359, s/v: 0–1)
let _cpA = 1; // opacity 0–1 (0 = transparent)
let _cpDragging = false;

function _hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function _rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function _rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map(x =>
        Math.max(0, Math.min(255, Math.round(x)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

function _updateAlphaSliderBg() {
  const wrap = document.querySelector('.export-cp-alpha-wrap');
  if (!wrap) return;
  const { r, g, b } = _hsvToRgb(_cpH, _cpS, _cpV);
  wrap.style.setProperty('--alpha-color', `rgb(${r},${g},${b})`);
}

function _drawSVCanvas() {
  const canvas = document.getElementById('export-cp-sv');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width,
    H = canvas.height;
  // Saturation gradient: white → pure hue
  const { r, g, b } = _hsvToRgb(_cpH, 1, 1);
  const satGrad = ctx.createLinearGradient(0, 0, W, 0);
  satGrad.addColorStop(0, '#fff');
  satGrad.addColorStop(1, `rgb(${r},${g},${b})`);
  ctx.fillStyle = satGrad;
  ctx.fillRect(0, 0, W, H);
  // Value gradient: transparent → black (top → bottom)
  const valGrad = ctx.createLinearGradient(0, 0, 0, H);
  valGrad.addColorStop(0, 'rgba(0,0,0,0)');
  valGrad.addColorStop(1, '#000');
  ctx.fillStyle = valGrad;
  ctx.fillRect(0, 0, W, H);
  // Cursor ring
  const cx = _cpS * W,
    cy = (1 - _cpV) * H;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.strokeStyle = _cpV > 0.45 && _cpS < 0.85 ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function _cpSyncOutput() {
  const { r, g, b } = _hsvToRgb(_cpH, _cpS, _cpV);
  const hex = _rgbToHex(r, g, b);
  const swBtn = document.getElementById('export-bg-swatch-btn');
  const hexEl = document.getElementById('export-bg-hex');
  let stored;
  if (_cpA <= 0) {
    stored = 'transparent';
    if (swBtn) {
      swBtn.classList.add('transparent-mode');
      swBtn.style.background = '';
    }
    if (hexEl) {
      hexEl.value = '';
      hexEl.placeholder = 'transparent';
      hexEl.classList.remove('invalid');
    }
  } else {
    const a = parseFloat(_cpA.toFixed(3));
    stored = a >= 1 ? hex : `rgba(${r},${g},${b},${a})`;
    if (swBtn) {
      swBtn.style.background = `rgba(${r},${g},${b},${_cpA})`;
      swBtn.classList.remove('transparent-mode');
    }
    if (hexEl) {
      hexEl.value = hex;
      hexEl.classList.remove('invalid');
      hexEl.placeholder = '#rrggbb';
    }
  }
  _updateAlphaSliderBg();
  try {
    localStorage.setItem(EXPORT_BG_KEY, stored);
  } catch (e) {
    console.warn('Export: localStorage write failed', e);
  }
}

function _cpSyncFromHex(raw) {
  const alphaSlider = document.getElementById('export-cp-alpha');
  // transparent / null / empty
  if (!raw || raw === 'transparent') {
    _cpA = 0;
    if (alphaSlider) alphaSlider.value = 0;
    _updateAlphaSliderBg();
    return true;
  }
  // rgba(r,g,b,a) or rgb(r,g,b)
  const m = String(raw).match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)$/
  );
  if (m) {
    const { h, s, v: val } = _rgbToHsv(+m[1], +m[2], +m[3]);
    _cpH = h;
    _cpS = s;
    _cpV = val;
    _cpA = m[4] != null ? Math.min(1, Math.max(0, parseFloat(m[4]))) : 1;
    const hueSlider = document.getElementById('export-cp-hue');
    if (hueSlider) hueSlider.value = Math.round(_cpH);
    if (alphaSlider) alphaSlider.value = Math.round(_cpA * 100);
    _drawSVCanvas();
    _updateAlphaSliderBg();
    return true;
  }
  // #rrggbb hex
  const n = _normaliseHex(raw);
  if (!n) return false;
  const v = parseInt(n.slice(1), 16);
  const { h, s, v: val } = _rgbToHsv((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  _cpH = h;
  _cpS = s;
  _cpV = val;
  _cpA = 1;
  const hueSlider = document.getElementById('export-cp-hue');
  if (hueSlider) hueSlider.value = Math.round(_cpH);
  if (alphaSlider) alphaSlider.value = 100;
  _drawSVCanvas();
  _updateAlphaSliderBg();
  return true;
}

function _cpOpen() {
  const picker = document.getElementById('export-color-picker');
  const swBtn = document.getElementById('export-bg-swatch-btn');
  if (!picker) return;
  picker.hidden = false;
  if (swBtn) swBtn.setAttribute('aria-expanded', 'true');
  // Sync canvas resolution to its actual rendered width (avoids blur)
  const canvas = document.getElementById('export-cp-sv');
  if (canvas && canvas.clientWidth > 0) {
    const w = canvas.clientWidth;
    canvas.width = w;
    canvas.height = Math.round((w * 130) / 240);
  }
  const stored = getExportBgColor();
  if (!stored) {
    // First use — default dark bg at full opacity
    _cpA = 1;
    const alphaSlider = document.getElementById('export-cp-alpha');
    if (alphaSlider) alphaSlider.value = 100;
    _cpSyncFromHex('#0b1220');
  } else {
    _cpSyncFromHex(stored);
  }
}

function _cpClose() {
  const picker = document.getElementById('export-color-picker');
  const swBtn = document.getElementById('export-bg-swatch-btn');
  if (picker) picker.hidden = true;
  if (swBtn) swBtn.setAttribute('aria-expanded', 'false');
}

// ─────────────────────────────────────────────────────────────────────────────

function _syncBgUI() {
  const swBtn = document.getElementById('export-bg-swatch-btn');
  const hexInput = document.getElementById('export-bg-hex');
  if (!swBtn) return;
  const stored = getExportBgColor();
  if (hexInput) hexInput.classList.remove('invalid');
  if (!stored || stored === 'transparent') {
    swBtn.classList.add('transparent-mode');
    swBtn.style.background = '';
    if (hexInput) {
      hexInput.value = '';
      hexInput.placeholder = 'transparent';
    }
  } else if (/^rgba?\(/.test(stored)) {
    swBtn.classList.remove('transparent-mode');
    swBtn.style.background = stored;
    if (hexInput) {
      const m = stored.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) hexInput.value = _rgbToHex(+m[1], +m[2], +m[3]);
    }
  } else {
    swBtn.classList.remove('transparent-mode');
    swBtn.style.background = stored;
    if (hexInput) {
      hexInput.value = stored;
      hexInput.placeholder = '#rrggbb';
    }
  }
  // Keep picker in sync if open
  const picker = document.getElementById('export-color-picker');
  if (picker && !picker.hidden) _cpSyncFromHex(stored || '#0b1220');
}

function detectCanvasLimit() {
  const candidates = [268435456, 67108864, 16777216, 8388608];
  const probe = document.createElement('canvas');
  for (const area of candidates) {
    const side = Math.ceil(Math.sqrt(area));
    probe.width = side;
    probe.height = side;
    const ctx = probe.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = 'rgb(1,0,0)';
    ctx.fillRect(0, 0, 1, 1);
    try {
      if (ctx.getImageData(0, 0, 1, 1).data[0] === 1) return area;
    } catch (_) {}
  }
  return 4194304;
}
const PNG_MAX_PIXELS = detectCanvasLimit();
// Seed the Settings max-scale default based on what this browser can actually handle.
// Only affects first-time users; stored preferences are always respected.
Settings.initMaxPngScale(PNG_MAX_PIXELS);
export function rasteriseSvgToPng(svgText, logicalW, logicalH, requestedScale, filename) {
  let scale = requestedScale;
  let capped = false;
  while (scale > 1 && logicalW * scale * (logicalH * scale) > PNG_MAX_PIXELS) {
    scale--;
    capped = true;
  }
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(logicalW * scale);
    c.height = Math.round(logicalH * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    c.toBlob(blob => {
      if (!blob) {
        alert('PNG export failed — the browser could not generate the image.');
        return;
      }
      downloadBlob(blob, filename);
      if (capped) {
        console.info(
          '[export] PNG was capped at ' +
            scale +
            '× to stay under the browser canvas size limit (' +
            PNG_MAX_PIXELS.toLocaleString() +
            ' pixels).'
        );
      }
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('PNG export failed — the browser could not rasterise the SVG.');
  };
  img.src = url;
}

export function exportViewSVG() {
  if (!graphState.graphData) return;
  const result = buildExportSvg({ scope: 'viewport' });
  if (!result) return;
  const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `sn_view_${exportSlug()}_${exportTimestamp()}.svg`);
}

export function exportViewPNG() {
  if (!graphState.graphData) return;
  const result = buildExportSvg({ scope: 'viewport' });
  if (!result) return;
  rasteriseSvgToPng(
    result.svg,
    result.width,
    result.height,
    getPngExportScale(),
    `sn_view_${exportSlug()}_${exportTimestamp()}.png`
  );
}

export function exportFullSVG() {
  if (!graphState.graphData) return;
  const result = buildExportSvg({ scope: 'full' });
  if (!result) return;
  const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `sn_full_${exportSlug()}_${exportTimestamp()}.svg`);
}

export function exportFullPNG() {
  if (!graphState.graphData) return;
  const result = buildExportSvg({ scope: 'full' });
  if (!result) return;
  rasteriseSvgToPng(
    result.svg,
    result.width,
    result.height,
    getPngExportScale(),
    `sn_full_${exportSlug()}_${exportTimestamp()}.png`
  );
}

function _updateScaleInfo(scale) {
  const infoEl = document.getElementById('export-scale-info');
  if (!infoEl) return;
  const cv = Dom.canvas;
  if (!cv || !cv.clientWidth || !cv.clientHeight) {
    infoEl.textContent = '';
    return;
  }
  const w = Math.round(cv.clientWidth * scale);
  const h = Math.round(cv.clientHeight * scale);
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let text = `→ ${fmt(w)} × ${fmt(h)} px`;
  if (w * h > PNG_MAX_PIXELS) {
    let cappedScale = scale;
    while (
      cappedScale > 1 &&
      cv.clientWidth * cappedScale * cv.clientHeight * cappedScale > PNG_MAX_PIXELS
    ) {
      cappedScale--;
    }
    text += `  (capped at ${cappedScale}×)`;
    infoEl.classList.add('export-scale-capped');
  } else {
    infoEl.classList.remove('export-scale-capped');
  }
  infoEl.textContent = text;
}

// ── Export bar (panel below header) ──────────────────────────────────────────

let _dataScope = 'full'; // 'full' | 'neighbourhood'  — for JSON / Markdown
let _imageScope = 'view'; // 'view' | 'full'            — for PNG / SVG

function _syncScopeUI() {
  const isNbhd = _dataScope === 'neighbourhood';
  const isImgFull = _imageScope === 'full';
  const hasSelect = !!uiState.selectedNode;

  // Data scope toggle
  document.getElementById('export-data-scope-full')?.classList.toggle('active', !isNbhd);
  document.getElementById('export-data-scope-nbhd')?.classList.toggle('active', isNbhd);
  // Image scope toggle
  document.getElementById('export-img-scope-view')?.classList.toggle('active', !isImgFull);
  document.getElementById('export-img-scope-full')?.classList.toggle('active', isImgFull);

  // Data format buttons — disabled when neighbourhood scope but nothing selected
  const dataDisabled = isNbhd && !hasSelect;
  for (const id of ['epb-json', 'epb-markdown', 'epb-jsonld', 'epb-turtle', 'epb-openapi']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = dataDisabled;
  }
  // Hint text
  const hint = document.getElementById('export-nbhd-hint');
  if (hint) hint.hidden = !(isNbhd && !hasSelect);
}

export function exportBarOpen() {
  if (!Dom.exportBar) return;
  const maxScale = Settings.getMaxPngScale();
  const slider = document.getElementById('export-scale-slider');
  if (slider) {
    slider.max = maxScale;
    const persisted = getPngExportScale();
    slider.value = persisted;
    const valEl = document.getElementById('export-scale-val');
    if (valEl) valEl.textContent = persisted + '×';
    _updateScaleInfo(persisted);
  }
  _syncBgUI();
  _syncScopeUI();
  Dom.exportBar.classList.add('open');
  Dom.btnExport.setAttribute('aria-expanded', 'true');
}

export function exportBarClose() {
  if (!Dom.exportBar) return;
  Dom.exportBar.classList.remove('open');
  Dom.btnExport.setAttribute('aria-expanded', 'false');
  _cpClose();
}

/** @deprecated kept for back-compat — callers should use exportBarOpen/Close */
export function exportMenuOpen() {
  exportBarOpen();
}
export function exportMenuClose() {
  exportBarClose();
}

export function fitGraph() {
  if (!graphState.graphData) return;
  const b = root.node().getBBox();
  if (!b.width) return;
  const cv = Dom.canvas,
    W = cv.clientWidth,
    H = cv.clientHeight;
  const s = Math.min(0.9, 0.9 / Math.max(b.width / W, b.height / H));
  svg
    .transition()
    .duration(600)
    .call(
      zoom.transform,
      d3.zoomIdentity
        .translate(W / 2 - s * (b.x + b.width / 2), H / 2 - s * (b.y + b.height / 2))
        .scale(s)
    );
}

export function initExportListeners() {
  // Toggle export bar
  Dom.btnExport.addEventListener('click', e => {
    e.stopPropagation();
    if (Dom.exportBar?.classList.contains('open')) exportBarClose();
    else exportBarOpen();
  });

  // Scope toggles + format buttons (delegated on the bar)
  Dom.exportBar?.addEventListener('click', e => {
    // Scope toggle — data or image row, independent
    const scopeBtn = e.target.closest('.export-scope-btn');
    if (scopeBtn) {
      const { cat, scope } = scopeBtn.dataset;
      if (cat === 'data') _dataScope = scope;
      if (cat === 'image') _imageScope = scope;
      _syncScopeUI();
      return;
    }
    // Format button — dispatch based on format + category scope, then close
    const fmtBtn = e.target.closest('.export-fmt-btn');
    if (fmtBtn && !fmtBtn.disabled) {
      const { fmt, cat } = fmtBtn.dataset;
      exportBarClose();
      if (cat === 'data') {
        if (_dataScope === 'full') {
          if (fmt === 'json') {
            exportSchemaJSON();
            return;
          }
          if (fmt === 'markdown') {
            exportSchemaMarkdown();
            return;
          }
          if (fmt === 'jsonld') {
            exportSchemaJsonLd();
            return;
          }
          if (fmt === 'turtle') {
            exportSchemaTurtle();
            return;
          }
          if (fmt === 'openapi') {
            exportSchemaOpenApi();
            return;
          }
        } else {
          if (fmt === 'json') {
            exportNeighbourhoodJSON();
            return;
          }
          if (fmt === 'markdown') {
            exportNeighbourhoodMarkdown();
            return;
          }
          if (fmt === 'jsonld') {
            exportNeighbourhoodJsonLd();
            return;
          }
          if (fmt === 'turtle') {
            exportNeighbourhoodTurtle();
            return;
          }
          if (fmt === 'openapi') {
            exportNeighbourhoodOpenApi();
            return;
          }
        }
      }
      if (cat === 'image') {
        if (_imageScope === 'view') {
          if (fmt === 'png') {
            exportViewPNG();
            return;
          }
          if (fmt === 'svg') {
            exportViewSVG();
            return;
          }
        } else {
          if (fmt === 'png') {
            exportFullPNG();
            return;
          }
          if (fmt === 'svg') {
            exportFullSVG();
            return;
          }
        }
      }
    }
  });

  // Close on Escape or click outside the bar
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && Dom.exportBar?.classList.contains('open')) {
      exportBarClose();
    }
  });

  document.addEventListener('click', e => {
    if (!Dom.exportBar?.classList.contains('open')) return;
    if (e.target.closest('#export-bar') || e.target.closest('#btn-export')) return;
    exportBarClose();
  });

  // Swatch button — toggle picker open/close
  document.getElementById('export-bg-swatch-btn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    const picker = document.getElementById('export-color-picker');
    if (picker && !picker.hidden) _cpClose();
    else _cpOpen();
  });

  // SV canvas — drag to pick saturation + value (mouse + touch)
  const _svCanvas = document.getElementById('export-cp-sv');
  if (_svCanvas) {
    const _svCoords = (clientX, clientY) => {
      const rect = _svCanvas.getBoundingClientRect();
      _cpS = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      _cpV = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    };
    _svCanvas.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _cpDragging = true;
      _svCoords(e.clientX, e.clientY);
      _drawSVCanvas();
      _cpSyncOutput();
    });
    document.addEventListener('mousemove', function (e) {
      if (!_cpDragging) return;
      _svCoords(e.clientX, e.clientY);
      _drawSVCanvas();
      _cpSyncOutput();
    });
    document.addEventListener('mouseup', () => {
      _cpDragging = false;
    });
    // Touch support
    _svCanvas.addEventListener(
      'touchstart',
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.touches[0]) return;
        _cpDragging = true;
        _svCoords(e.touches[0].clientX, e.touches[0].clientY);
        _drawSVCanvas();
        _cpSyncOutput();
      },
      { passive: false }
    );
    _svCanvas.addEventListener(
      'touchmove',
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!_cpDragging || !e.touches[0]) return;
        _svCoords(e.touches[0].clientX, e.touches[0].clientY);
        _drawSVCanvas();
        _cpSyncOutput();
      },
      { passive: false }
    );
    _svCanvas.addEventListener(
      'touchend',
      function () {
        _cpDragging = false;
      },
      { passive: false }
    );
  }

  // Hue slider — update hue, redraw canvas
  document.getElementById('export-cp-hue')?.addEventListener('input', function (e) {
    e.stopPropagation();
    _cpH = parseInt(this.value, 10);
    _drawSVCanvas();
    _cpSyncOutput();
  });

  // Alpha slider — update opacity
  document.getElementById('export-cp-alpha')?.addEventListener('input', function (e) {
    e.stopPropagation();
    _cpA = parseInt(this.value, 10) / 100;
    _cpSyncOutput();
  });

  // Scale slider — live label + info, persist on release
  const _scaleSlider = document.getElementById('export-scale-slider');
  if (_scaleSlider) {
    _scaleSlider.addEventListener('input', function (e) {
      e.stopPropagation();
      const n = parseInt(this.value, 10);
      const valEl = document.getElementById('export-scale-val');
      if (valEl) valEl.textContent = n + '×';
      _updateScaleInfo(n);
    });
    _scaleSlider.addEventListener('change', function (e) {
      e.stopPropagation();
      setPngExportScale(parseInt(this.value, 10));
    });
  }

  // Hex text input — live swatch preview on input, validate + store on blur
  const _hexEl = document.getElementById('export-bg-hex');
  if (_hexEl) {
    _hexEl.addEventListener('input', function (e) {
      e.stopPropagation();
      const v = _normaliseHex(this.value);
      this.classList.toggle('invalid', !!this.value && !v);
      if (v) {
        const swBtn = document.getElementById('export-bg-swatch-btn');
        if (swBtn) {
          swBtn.style.background = v;
          swBtn.classList.remove('transparent-mode');
        }
        const picker = document.getElementById('export-color-picker');
        if (picker && !picker.hidden) _cpSyncFromHex(v);
      }
    });
    _hexEl.addEventListener('blur', function () {
      const v = _normaliseHex(this.value);
      if (v) setExportBgColor(v);
      else _syncBgUI(); // revert invalid entry to stored value
    });
    _hexEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        this.blur();
        e.preventDefault();
      }
    });
  }
}

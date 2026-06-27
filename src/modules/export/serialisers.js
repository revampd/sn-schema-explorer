/**
 * Pure schema serialisers and colour math, extracted from export/index.js (#73).
 *
 * These functions are DOM-free: they take (nodes, data, opts) — or plain
 * numbers/strings for the colour helpers — and return a string/object. They do
 * not read `graphState`/`uiState` or touch the document, so they're unit-tested
 * in isolation (`tests/unit/export-serialisers.test.js`). The only sibling
 * import is `typeLabel` (a pure type→label map) for the Markdown table.
 */
import { typeLabel } from '../../core/render.js';

// ── Markdown export ───────────────────────────────────────────────────────────

/**
 * Convert one node to a Markdown section.
 * Includes: heading (with parent), fields table, outgoing refs, extended-by list.
 */
export function _nodeToMarkdown(node, data, opts) {
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

export function _nodeToJsonLd(node, data, opts) {
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

export function _schemaToJsonLd(nodes, data, opts) {
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

export function _schemaToTurtle(nodes, data, opts) {
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

export function _schemaToOpenApi(nodes, data, opts) {
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

// ── Colour math (HSV/RGB/hex) ─────────────────────────────────────────────────

export function _normaliseHex(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/^#+/, '');
  // Expand 3-digit shorthand (#abc → #aabbcc)
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return '#' + s.toLowerCase();
}

export function _hsvToRgb(h, s, v) {
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

export function _rgbToHsv(r, g, b) {
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

export function _rgbToHex(r, g, b) {
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

/* ============================================================================
 * Format serialisers for the Node.js extractor — extracted from
 * sn-schema-export.node.js (#73), behaviour-preserving.
 * ============================================================================
 *
 * Pure functions: (schema, opts) → string. They navigate the graph via the
 * adjacency map attached as `schema._adj` (built by buildAdj here). No I/O, no
 * process/env access — so they unit-test in isolation.
 *
 * CommonJS-authored (`require`/`module.exports`) like the rest of the exporter.
 * In the dist layout this file is copied next to the node script and required
 * as `./serialisers.js`; in the standalone artifact build.js inlines it (zero
 * external dependencies), the same way it inlines schema-builder.js.
 */

'use strict';

const ALL_EDGE_TYPES = ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel'];

/**
 * Build an adjacency map from the raw schema object.
 * The viewer normally builds this at load time; we replicate it here so the
 * serialiser functions can navigate the graph without iterating all edges repeatedly.
 */
function buildAdj(schema) {
  const adj = new Map();
  const ensure = id => {
    if (!adj.has(id)) adj.set(id, { out: [], in: [] });
  };
  const allEdges = [
    ...(schema.edges || []),
    ...(schema._ciRelationships || []).map(r => ({
      type: 'cmdb_rel',
      source: r.source || r.baseClass || '',
      target: r.target || r.dependentClass || '',
      label: r.label || r.relTypeDisplay || '',
    })),
  ];
  for (const e of allEdges) {
    const s = e.source && e.source.id ? e.source.id : e.source;
    const t = e.target && e.target.id ? e.target.id : e.target;
    if (!s || !t) continue;
    ensure(s);
    ensure(t);
    adj.get(s).out.push(e);
    adj.get(t).in.push(e);
  }
  return adj;
}

/** Human-readable label for a SN field type (mirrors viewer's typeLabel()). */
function snTypeLabel(type) {
  const MAP = {
    string: 'String',
    string_full_utf8: 'String (Full UTF-8)',
    html: 'HTML',
    url: 'URL',
    translated_text: 'Translated Text',
    phone_number: 'Phone Number',
    char: 'Single Line Text',
    GUID: 'Sys ID (GUID)',
    password: 'Password',
    integer: 'Integer',
    smallint: 'Small Integer',
    longint: 'Long Integer',
    float: 'Floating Point',
    decimal: 'Decimal',
    currency: 'Currency',
    boolean: 'True/False',
    percent_complete: 'Percent Complete',
    glide_date_time: 'Date/Time',
    due_date: 'Due Date',
    glide_date: 'Date',
    glide_time: 'Time',
    timer: 'Timer',
    reference: 'Reference',
    glide_list: 'List',
    document_id: 'Document ID',
    journal: 'Journal',
    journal_input: 'Journal Input',
    journal_list: 'Journal List',
    composite_field: 'Composite Field',
    conditions: 'Conditions',
    script: 'Script',
    script_plain: 'Script (Plain)',
    script_server: 'Script (Server)',
    user_image: 'User Image',
    image: 'Image',
    audio: 'Audio',
    color: 'Color',
    color_display: 'Color Display',
    email: 'Email',
    ip_addr: 'IP Address',
    price: 'Price',
    order_index: 'Order Index',
    sequence: 'Sequence',
    counter: 'Counter',
    table_name: 'Table Name',
    field_name: 'Field Name',
    value: 'Value',
    xml: 'XML',
    json: 'JSON',
    slushbucket: 'Slushbucket',
    domain_id: 'Domain',
    wiki: 'Wiki',
  };
  return MAP[type] || type || '';
}

// XSD type mapping
const NODE_TYPE_XSD = {
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
const snTypeToXsd = t => NODE_TYPE_XSD[t] || 'xsd:string';

// OpenAPI type mapping
const NODE_TYPE_OA = {
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
const NODE_TYPE_OA_FMT = {
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

function serializeMarkdown(schema, opts) {
  const etSet = new Set(opts.edgeTypes || ALL_EDGE_TYPES);
  const inst =
    (schema._instance && (schema._instance.instance_name || schema._instance.instance_url)) || '';
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    '# ServiceNow Schema Export',
    '',
    '> Generated by [SN Schema Explorer](https://github.com/revampd/sn-schema-explorer) on ' +
      date +
      (inst ? ' — instance: ' + inst : ''),
    '',
    '**Scope:** full schema',
    '',
    '---',
    '',
  ];
  const nodes = (schema.nodes || [])
    .filter(n => !n._diffOnly)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const node of nodes) {
    const adj = schema._adj.get(node.id);
    const out = (adj && adj.out) || [];
    const inn = (adj && adj.in) || [];
    const parentEdge = etSet.has('extends') ? out.find(e => e.type === 'extends') : null;
    const parentId = parentEdge
      ? (parentEdge.target && parentEdge.target.id) || parentEdge.target
      : null;
    let heading = '## ' + node.id;
    if (node.label && node.label !== node.id) heading += ' — ' + node.label;
    if (parentId) heading += ' *(extends: ' + parentId + ')*';
    lines.push(heading, '');
    if (node.fields && node.fields.length) {
      lines.push('| Field | Type | Label |');
      lines.push('|---|---|---|');
      for (const f of node.fields) {
        const tl = snTypeLabel(f.type) || f.type || '';
        const lbl = f.label && f.label !== f.name ? f.label : '';
        lines.push('| `' + f.name + '` | ' + tl + ' | ' + lbl + ' |');
      }
      lines.push('');
    }
    if (etSet.has('reference')) {
      const refs = out
        .filter(e => e.type === 'reference')
        .map(e => {
          const tgt = (e.target && e.target.id) || e.target;
          return e.field ? '`' + e.field + '` → ' + tgt : '→ ' + tgt;
        });
      if (refs.length) lines.push('**References:** ' + refs.join(', '), '');
      const refsIn = inn
        .filter(e => e.type === 'reference')
        .map(e => {
          const src = (e.source && e.source.id) || e.source;
          return e.field ? src + '.`' + e.field + '`' : src;
        })
        .sort();
      if (refsIn.length) lines.push('**Referenced by:** ' + refsIn.join(', '), '');
    }
    if (etSet.has('extends')) {
      const extBy = inn
        .filter(e => e.type === 'extends')
        .map(e => (e.source && e.source.id) || e.source)
        .sort();
      if (extBy.length) lines.push('**Extended by:** ' + extBy.join(', '), '');
    }
    if (etSet.has('m2m')) {
      const seen = new Set();
      const m2ms = [];
      for (const e of out.concat(inn)) {
        if (e.type !== 'm2m') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        const key = other + '\0' + (e.m2mTable || '');
        if (seen.has(key)) continue;
        seen.add(key);
        m2ms.push(e.m2mTable ? other + ' (via `' + e.m2mTable + '`)' : other);
      }
      m2ms.sort();
      if (m2ms.length) lines.push('**M2M relationships:** ' + m2ms.join(', '), '');
    }
    if (etSet.has('cmdb_rel')) {
      const seen = new Set();
      const ciRels = [];
      for (const e of out.concat(inn)) {
        if (e.type !== 'cmdb_rel') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        const key = other + '\0' + (e.label || '');
        if (seen.has(key)) continue;
        seen.add(key);
        ciRels.push(e.label ? e.label + ' → ' + other : other);
      }
      ciRels.sort();
      if (ciRels.length) lines.push('**CI topology:** ' + ciRels.join(', '), '');
    }
    if (etSet.has('view') && node._isView) {
      const v = out
        .filter(e => e.type === 'view')
        .map(e => (e.target && e.target.id) || e.target)
        .sort();
      if (v.length) lines.push('**View includes tables:** ' + v.join(', '), '');
    } else if (etSet.has('view') && !node._isView) {
      const v = inn
        .filter(e => e.type === 'view')
        .map(e => (e.source && e.source.id) || e.source)
        .sort();
      if (v.length) lines.push('**Member of views:** ' + v.join(', '), '');
    }
    lines.push('\n---\n');
  }
  return lines.join('\n');
}

function serializeJsonLd(schema, opts) {
  const etSet = new Set(opts.edgeTypes || ALL_EDGE_TYPES);
  const inst =
    (schema._instance && (schema._instance.instance_name || schema._instance.instance_url)) || '';
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
  };
  const nodes = (schema.nodes || [])
    .filter(n => !n._diffOnly)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const graph = [meta];
  for (const node of nodes) {
    const adj = schema._adj.get(node.id);
    const out = (adj && adj.out) || [];
    const inn = (adj && adj.in) || [];
    const cls = {
      '@id': 'snp:' + node.id,
      '@type': node._isView ? ['owl:Class', 'sn:DbView'] : 'owl:Class',
      'rdfs:label': node.label || node.id,
      'sn:technicalName': node.id,
      'sn:scope': node.scope || 'Global',
    };
    if (node.ws_access === false) cls['sn:wsAccessible'] = false;
    if (etSet.has('extends')) {
      const pe = out.find(e => e.type === 'extends');
      if (pe)
        cls['rdfs:subClassOf'] = { '@id': 'snp:' + ((pe.target && pe.target.id) || pe.target) };
      const ch = inn
        .filter(e => e.type === 'extends')
        .map(e => ({ '@id': 'snp:' + ((e.source && e.source.id) || e.source) }));
      if (ch.length) cls['sn:extendedBy'] = ch.length === 1 ? ch[0] : ch;
    }
    if (node.fields && node.fields.length) {
      cls['sn:fields'] = node.fields.map(f => {
        const isRef = f.type === 'reference';
        const fd = {
          '@type': isRef ? 'owl:ObjectProperty' : 'owl:DatatypeProperty',
          'rdfs:label': f.label || f.name,
          'sn:technicalName': f.name,
          'sn:dataType': f.type || 'string',
        };
        if (isRef && etSet.has('reference')) {
          const re = out.find(e => e.type === 'reference' && e.field === f.name);
          if (re) fd['rdfs:range'] = { '@id': 'snp:' + ((re.target && re.target.id) || re.target) };
        } else if (!isRef) {
          fd['rdfs:range'] = { '@id': snTypeToXsd(f.type) };
        }
        if (f.mandatory) fd['sn:mandatory'] = true;
        if (f.primary) fd['sn:primary'] = true;
        return fd;
      });
    }
    if (etSet.has('m2m')) {
      const seen = new Set();
      const m2ms = [];
      for (const e of out.concat(inn)) {
        if (e.type !== 'm2m') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        if (seen.has(other)) continue;
        seen.add(other);
        const r = { 'sn:relatedTable': { '@id': 'snp:' + other } };
        if (e.m2mTable) r['sn:junctionTable'] = e.m2mTable;
        m2ms.push(r);
      }
      if (m2ms.length) cls['sn:m2mRelationships'] = m2ms.length === 1 ? m2ms[0] : m2ms;
    }
    graph.push(cls);
  }
  return JSON.stringify({ '@context': context, '@graph': graph }, null, opts.pretty ? 2 : 0);
}

function serializeTurtle(schema, opts) {
  const etSet = new Set(opts.edgeTypes || ALL_EDGE_TYPES);
  const inst =
    (schema._instance && (schema._instance.instance_name || schema._instance.instance_url)) || '';
  const date = new Date().toISOString();
  const ttlLit = s =>
    '"' +
    String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n') +
    '"';
  const ttlId = s =>
    String(s)
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^([^a-zA-Z_])/, '_$1');
  const block = (subj, pairs) => {
    if (!pairs.length) return subj + ' .\n\n';
    return (
      subj +
      '\n' +
      pairs
        .map((p, i) => '  ' + p[0] + ' ' + p[1] + (i < pairs.length - 1 ? ' ;' : ' .'))
        .join('\n') +
      '\n\n'
    );
  };
  const parts = [
    '@prefix owl:  <http://www.w3.org/2002/07/owl#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix sn:   <https://servicenow.com/schema#> .',
    '@prefix snp:  <https://servicenow.com/table/> .',
    '',
    '# ServiceNow Schema Export' + (inst ? ' — ' + inst : ''),
    '# Generated: ' + date,
    '',
    block('<https://servicenow.com/schema>', [
      ['a', 'owl:Ontology'],
      ['rdfs:label', ttlLit('ServiceNow Schema' + (inst ? ' — ' + inst : ''))],
      ['sn:exportedAt', ttlLit(date) + '^^xsd:dateTime'],
    ]),
  ];
  const nodes = (schema.nodes || [])
    .filter(n => !n._diffOnly)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const node of nodes) {
    const id = ttlId(node.id);
    const adj = schema._adj.get(node.id);
    const eo = (adj && adj.out) || [];
    const ei = (adj && adj.in) || [];
    const clsPairs = [
      ['a', node._isView ? 'owl:Class, sn:DbView' : 'owl:Class'],
      ['rdfs:label', ttlLit(node.label || node.id)],
      ['sn:technicalName', ttlLit(node.id)],
      ['sn:scope', ttlLit(node.scope || 'Global')],
    ];
    if (node.ws_access === false) clsPairs.push(['sn:wsAccessible', '"false"^^xsd:boolean']);
    if (etSet.has('extends')) {
      const pe = eo.find(e => e.type === 'extends');
      if (pe)
        clsPairs.push([
          'rdfs:subClassOf',
          'snp:' + ttlId((pe.target && pe.target.id) || pe.target),
        ]);
    }
    // DB view membership (added to class block)
    if (etSet.has('view')) {
      if (node._isView) {
        for (var vi = 0; vi < eo.length; vi++) {
          if (eo[vi].type === 'view')
            clsPairs.push([
              'sn:viewIncludes',
              'snp:' + ttlId((eo[vi].target && eo[vi].target.id) || eo[vi].target),
            ]);
        }
      } else {
        for (var vi = 0; vi < ei.length; vi++) {
          if (ei[vi].type === 'view')
            clsPairs.push([
              'sn:memberOfView',
              'snp:' + ttlId((ei[vi].source && ei[vi].source.id) || ei[vi].source),
            ]);
        }
      }
    }
    parts.push(block('snp:' + id, clsPairs));
    if (node.fields && node.fields.length) {
      for (const f of node.fields) {
        const isRef = f.type === 'reference';
        const propPairs = [
          ['a', isRef ? 'owl:ObjectProperty' : 'owl:DatatypeProperty'],
          ['rdfs:label', ttlLit(f.label || f.name)],
          ['sn:technicalName', ttlLit(f.name)],
          ['rdfs:domain', 'snp:' + id],
        ];
        if (isRef && etSet.has('reference')) {
          const re = eo.find(e => e.type === 'reference' && e.field === f.name);
          if (re)
            propPairs.push([
              'rdfs:range',
              'snp:' + ttlId((re.target && re.target.id) || re.target),
            ]);
        } else if (!isRef) {
          propPairs.push(['rdfs:range', snTypeToXsd(f.type)]);
        }
        parts.push(block('sn:' + ttlId(node.id + '_' + f.name), propPairs));
      }
    }
    if (etSet.has('m2m')) {
      const seen = new Set();
      for (const e of eo.concat(ei)) {
        if (e.type !== 'm2m') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        const key = node.id + '\0' + other;
        if (seen.has(key)) continue;
        seen.add(key);
        const mp = [
          ['a', 'sn:M2MRelationship'],
          ['rdfs:domain', 'snp:' + id],
          ['rdfs:range', 'snp:' + ttlId(other)],
        ];
        if (e.m2mTable) mp.push(['sn:junctionTable', ttlLit(e.m2mTable)]);
        parts.push(block('sn:m2m_' + ttlId(node.id) + '_' + ttlId(other), mp));
      }
    }

    // Named relationship associations
    if (etSet.has('rel')) {
      const seen = new Set();
      for (const e of eo.concat(ei)) {
        if (e.type !== 'rel') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        const key = other + '\0' + (e.name || '');
        if (seen.has(key)) continue;
        seen.add(key);
        const rp = [
          ['a', 'sn:NamedRelationship'],
          ['rdfs:domain', 'snp:' + id],
          ['rdfs:range', 'snp:' + ttlId(other)],
        ];
        if (e.name) rp.push(['sn:name', ttlLit(e.name)]);
        parts.push(
          block(
            'sn:rel_' + ttlId(node.id) + '_' + ttlId(other) + (e.name ? '_' + ttlId(e.name) : ''),
            rp
          )
        );
      }
    }

    // CMDB CI topology
    if (etSet.has('cmdb_rel')) {
      const seen = new Set();
      for (const e of eo.concat(ei)) {
        if (e.type !== 'cmdb_rel') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        const key = other + '\0' + (e.label || '');
        if (seen.has(key)) continue;
        seen.add(key);
        const cp = [
          ['a', 'sn:CiRelationship'],
          ['rdfs:domain', 'snp:' + id],
          ['rdfs:range', 'snp:' + ttlId(other)],
        ];
        if (e.label) cp.push(['sn:relationshipType', ttlLit(e.label)]);
        parts.push(
          block(
            'sn:ciRel_' +
              ttlId(node.id) +
              '_' +
              ttlId(other) +
              (e.label ? '_' + ttlId(e.label) : ''),
            cp
          )
        );
      }
    }
  }
  return parts.join('\n');
}

function serializeOpenApi(schema, opts) {
  const etSet = new Set(opts.edgeTypes || ALL_EDGE_TYPES);
  const inst =
    (schema._instance && (schema._instance.instance_name || schema._instance.instance_url)) || '';
  const instUrl = (schema._instance && schema._instance.instance_url) || '';
  const date = new Date().toISOString();
  const nodeIds = new Set((schema.nodes || []).map(n => n.id));
  const yamlStr = s => {
    s = String(s == null ? '' : s);
    if (
      /^[a-zA-Z0-9_.-]+$/.test(s) &&
      s.length > 0 &&
      !['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(s.toLowerCase())
    )
      return s;
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  };
  const lines = [
    'openapi: 3.0.3',
    'info:',
    '  title: ' + yamlStr('ServiceNow Schema' + (inst ? ' — ' + inst : '')),
    '  description: ' + yamlStr('Exported by SN Schema Export on ' + date),
    '  version: ' + yamlStr((schema._instance && schema._instance.build_name) || '1.0'),
  ];
  if (instUrl) {
    lines.push('servers:');
    lines.push('  - url: ' + yamlStr(instUrl));
    lines.push('    description: ' + yamlStr(inst || 'ServiceNow instance'));
  }
  // Table API CRUD paths — GET/POST collection endpoint, GET/PATCH/DELETE by sys_id
  // DB views are read-only (no POST/PATCH/DELETE).
  lines.push('paths:');
  const allNodes = (schema.nodes || [])
    .filter(function (n) {
      return !n._diffOnly;
    })
    .sort(function (a, b) {
      return a.id < b.id ? -1 : 1;
    });
  for (const node of allNodes) {
    const opId = node.id.replace(/[^a-zA-Z0-9]/g, '_');
    const ref = yamlStr('#/components/schemas/' + node.id);
    const lbl = node.label || node.id;
    lines.push('  /api/now/table/' + node.id + ':');
    lines.push('    get:');
    lines.push('      summary: ' + yamlStr('Query ' + lbl));
    lines.push('      operationId: list_' + opId);
    lines.push('      tags: [' + yamlStr(node.id) + ']');
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
      lines.push('      summary: ' + yamlStr('Create ' + lbl));
      lines.push('      operationId: create_' + opId);
      lines.push('      tags: [' + yamlStr(node.id) + ']');
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
    lines.push('      summary: ' + yamlStr('Get ' + lbl));
    lines.push('      operationId: get_' + opId);
    lines.push('      tags: [' + yamlStr(node.id) + ']');
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
      lines.push('      summary: ' + yamlStr('Update ' + lbl));
      lines.push('      operationId: patch_' + opId);
      lines.push('      tags: [' + yamlStr(node.id) + ']');
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
      lines.push('      summary: ' + yamlStr('Delete ' + lbl));
      lines.push('      operationId: delete_' + opId);
      lines.push('      tags: [' + yamlStr(node.id) + ']');
      lines.push('      responses:');
      lines.push('        "204": {description: "No Content"}');
    }
  }
  lines.push('components:', '  schemas:');
  const nodes = (schema.nodes || [])
    .filter(n => !n._diffOnly)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const node of nodes) {
    const adj = schema._adj.get(node.id);
    const eo = (adj && adj.out) || [];
    const ei = (adj && adj.in) || [];
    const i4 = '    ';
    lines.push(i4 + yamlStr(node.id) + ':');
    lines.push(i4 + '  type: object');
    if (node.label && node.label !== node.id) lines.push(i4 + '  title: ' + yamlStr(node.label));
    if (node.scope) lines.push(i4 + '  x-sn-scope: ' + yamlStr(node.scope));
    if (node._isView) lines.push(i4 + '  x-sn-is-view: true');
    if (node.ws_access === false) lines.push(i4 + '  x-sn-ws-accessible: false');
    if (etSet.has('extends')) {
      const pe = eo.find(e => e.type === 'extends');
      if (pe) {
        const pid = (pe.target && pe.target.id) || pe.target;
        lines.push(
          i4 + '  x-sn-extends: ' + yamlStr(nodeIds.has(pid) ? '#/components/schemas/' + pid : pid)
        );
      }
    }
    if (node.fields && node.fields.length) {
      lines.push(i4 + '  properties:');
      for (const f of node.fields) {
        lines.push(i4 + '    ' + yamlStr(f.name) + ':');
        const isRef = f.type === 'reference';
        if (isRef && etSet.has('reference')) {
          const re = eo.find(e => e.type === 'reference' && e.field === f.name);
          const tgt = re ? (re.target && re.target.id) || re.target : null;
          if (tgt && nodeIds.has(tgt)) {
            lines.push(i4 + '      $ref: ' + yamlStr('#/components/schemas/' + tgt));
          } else {
            lines.push(i4 + '      type: string');
            if (tgt) lines.push(i4 + '      x-sn-reference: ' + yamlStr(tgt));
          }
        } else {
          const oaType = NODE_TYPE_OA[f.type] || 'string';
          const oaFmt = NODE_TYPE_OA_FMT[f.type];
          lines.push(i4 + '      type: ' + oaType);
          if (oaFmt) lines.push(i4 + '      format: ' + oaFmt);
        }
        lines.push(i4 + '      x-sn-type: ' + yamlStr(f.type || 'string'));
        if (f.label && f.label !== f.name) lines.push(i4 + '      title: ' + yamlStr(f.label));
        if (f.mandatory) lines.push(i4 + '      x-sn-mandatory: true');
      }
    }
    if (etSet.has('m2m')) {
      const seen = new Set();
      const m2ms = [];
      for (const e of eo.concat(ei)) {
        if (e.type !== 'm2m') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        if (seen.has(other)) continue;
        seen.add(other);
        m2ms.push({ table: other, junctionTable: e.m2mTable || null });
      }
      if (m2ms.length) {
        lines.push(i4 + '  x-sn-m2m:');
        for (const m of m2ms) {
          lines.push(i4 + '    - table: ' + yamlStr(m.table));
          if (m.junctionTable) lines.push(i4 + '      junctionTable: ' + yamlStr(m.junctionTable));
        }
      }
    }
    if (etSet.has('rel')) {
      const seen = new Set();
      const rels = [];
      for (const e of eo.concat(ei)) {
        if (e.type !== 'rel') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        const key = other + '\0' + (e.name || '');
        if (seen.has(key)) continue;
        seen.add(key);
        rels.push({ table: other, name: e.name || '' });
      }
      if (rels.length) {
        lines.push(i4 + '  x-sn-relationships:');
        for (const r of rels) {
          lines.push(i4 + '    - table: ' + yamlStr(r.table));
          if (r.name) lines.push(i4 + '      name: ' + yamlStr(r.name));
        }
      }
    }

    // CMDB CI topology as YAML extension list
    if (etSet.has('cmdb_rel')) {
      const seen = new Set();
      const ciRels = [];
      for (const e of eo.concat(ei)) {
        if (e.type !== 'cmdb_rel') continue;
        const other =
          ((e.source && e.source.id) || e.source) === node.id
            ? (e.target && e.target.id) || e.target
            : (e.source && e.source.id) || e.source;
        const key = other + '\0' + (e.label || '');
        if (seen.has(key)) continue;
        seen.add(key);
        ciRels.push({ table: other, label: e.label || '' });
      }
      if (ciRels.length) {
        lines.push(i4 + '  x-sn-ci-topology:');
        for (const r of ciRels) {
          lines.push(i4 + '    - table: ' + yamlStr(r.table));
          if (r.label) lines.push(i4 + '      label: ' + yamlStr(r.label));
        }
      }
    }

    // DB view membership as YAML extension lists
    if (etSet.has('view')) {
      if (node._isView) {
        const members = eo
          .filter(function (e) {
            return e.type === 'view';
          })
          .map(function (e) {
            return (e.target && e.target.id) || e.target;
          });
        if (members.length) {
          lines.push(i4 + '  x-sn-view-includes:');
          for (const m of members) lines.push(i4 + '    - ' + yamlStr(m));
        }
      } else {
        const views = ei
          .filter(function (e) {
            return e.type === 'view';
          })
          .map(function (e) {
            return (e.source && e.source.id) || e.source;
          });
        if (views.length) {
          lines.push(i4 + '  x-sn-member-of-view:');
          for (const v of views) lines.push(i4 + '    - ' + yamlStr(v));
        }
      }
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  buildAdj,
  serializeMarkdown,
  serializeJsonLd,
  serializeTurtle,
  serializeOpenApi,
};

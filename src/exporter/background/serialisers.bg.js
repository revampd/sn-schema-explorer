// ───────────────────────────────────────────────────────────────────────────
// SERIALISERS — bgBuildAdj · serializeMarkdownBg · serializeJsonLdBg
// Used when CONFIG.format is 'markdown' or 'jsonld'.
// All code here is strict ES5 — no const/let, no arrow functions, no template
// literals, no for…of, no destructuring, no optional chaining.  This is
// required because the ServiceNow Rhino engine does not support ES6+.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Safe node-ID extractor — handles both string IDs and {id:…} objects.
 * Defined at module level so bgBuildAdj and both serialisers can share it.
 */
function bgNid(val) {
  if (val == null) return '';
  if (typeof val === 'object') return String(val.id || '');
  return String(val);
}

/**
 * Build a plain-object adjacency map from a fully-built schema.
 * Returns: { [nodeId]: { out: Edge[], inb: Edge[] } }
 * Includes both schema.edges and CI topology from schema._ciRelationships.
 */
function bgBuildAdj(schema) {
  var adj = {};

  function slot(id) {
    if (!adj[id]) adj[id] = { out: [], inb: [] };
    return adj[id];
  }

  var i, e, src, tgt;
  var edges = schema.edges || [];
  for (i = 0; i < edges.length; i++) {
    e = edges[i];
    src = bgNid(e.source);
    tgt = bgNid(e.target);
    if (!src || !tgt) continue;
    slot(src).out.push(e);
    slot(tgt).inb.push(e);
  }

  var ciRels = schema._ciRelationships || [];
  for (i = 0; i < ciRels.length; i++) {
    var r = ciRels[i];
    var ciEdge = {
      type: 'cmdb_rel',
      source: r.source || r.baseClass || '',
      target: r.target || r.dependentClass || '',
      label: r.label || r.relTypeDisplay || '',
    };
    src = bgNid(ciEdge.source);
    tgt = bgNid(ciEdge.target);
    if (!src || !tgt) continue;
    slot(src).out.push(ciEdge);
    slot(tgt).inb.push(ciEdge);
  }

  return adj;
}

/** Human-readable labels for common ServiceNow field types (Markdown export). */
var BG_TYPE_LABELS = {
  string: 'String',
  integer: 'Integer',
  float: 'Decimal',
  currency: 'Currency',
  currency2: 'Currency (v2)',
  boolean: 'Boolean',
  glide_date_time: 'Date/Time',
  glide_date: 'Date',
  glide_duration: 'Duration',
  glide_time: 'Time',
  reference: 'Reference',
  list: 'List',
  glide_list: 'List',
  url: 'URL',
  email: 'Email',
  phone_number: 'Phone',
  html: 'HTML',
  script: 'Script',
  script_plain: 'Script (Plain)',
  conditions: 'Condition',
  translated_text: 'Translated Text',
  choice: 'Choice',
  GUID: 'GUID',
  sys_class_name: 'Table Name',
  domain_id: 'Domain',
  journal_input: 'Journal Input',
  journal_list: 'Journal List',
  workflow: 'Workflow',
  document_id: 'Document ID',
  password2: 'Password',
  composite_field: 'Composite Field',
};

function bgTypeLabel(t) {
  return BG_TYPE_LABELS[t] || t || '';
}

/**
 * Serialise a fully-built schema object to Markdown.
 * One ## block per table; field table; edge sections gated by CONFIG.edgeTypes.
 */
function serializeMarkdownBg(schema) {
  var edgeTypes = CONFIG.edgeTypes || ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel'];
  var adj = bgBuildAdj(schema);
  var nodes = schema.nodes || [];
  var inst = schema._instance || {};

  var lines = [];

  // ── Preamble ──
  lines.push('# ServiceNow Schema Export');
  lines.push('');
  if (inst.instance_name) lines.push('**Instance:** ' + inst.instance_name);
  if (inst.exported_at) lines.push('**Exported:** ' + inst.exported_at);
  var scopeSet = {},
    si;
  for (si = 0; si < nodes.length; si++) {
    if (nodes[si].scope) scopeSet[nodes[si].scope] = true;
  }
  var scopes = [];
  for (var sk in scopeSet) {
    if (Object.prototype.hasOwnProperty.call(scopeSet, sk)) scopes.push(sk);
  }
  scopes.sort();
  if (scopes.length) lines.push('**Scopes:** ' + scopes.join(', '));
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── One block per node ──
  var ni, fi, ei2;
  for (ni = 0; ni < nodes.length; ni++) {
    var n = nodes[ni];
    var nAdj = adj[n.id] || { out: [], inb: [] };
    var seen = {};

    // Heading
    var heading = '## ' + n.id;
    if (n.label && n.label !== n.id) heading += ' — ' + n.label;

    // Find parent (extends out)
    if (edgeTypes.indexOf('extends') !== -1) {
      for (ei2 = 0; ei2 < nAdj.out.length; ei2++) {
        var eExt = nAdj.out[ei2];
        if (eExt.type === 'extends' && bgNid(eExt.source) === n.id) {
          heading += ' *(extends: ' + bgNid(eExt.target) + ')*';
          break;
        }
      }
    }
    lines.push(heading);

    // Field table
    var fields = n.fields || [];
    if (fields.length) {
      lines.push('');
      lines.push('| Field | Type | Label |');
      lines.push('|---|---|---|');
      for (fi = 0; fi < fields.length; fi++) {
        var f = fields[fi];
        var fNm = f.name || f.element || '';
        var fTy = bgTypeLabel(f.type || '');
        var fLbl = f.label || fNm;
        lines.push('| ' + fNm + ' | ' + fTy + ' | ' + fLbl + ' |');
      }
    }

    // References (out)
    if (edgeTypes.indexOf('reference') !== -1) {
      var refOuts = [];
      for (ei2 = 0; ei2 < nAdj.out.length; ei2++) {
        var eRef = nAdj.out[ei2];
        if (eRef.type !== 'reference') continue;
        var tRef = bgNid(eRef.target);
        var kRef = 'ro\0' + (eRef.field || '') + '\0' + tRef;
        if (seen[kRef]) continue;
        seen[kRef] = true;
        refOuts.push((eRef.label || eRef.field || tRef) + ' → ' + tRef);
      }
      if (refOuts.length) {
        lines.push('');
        lines.push('**References (out):** ' + refOuts.join(', '));
      }
    }

    // Referenced by (in)
    if (edgeTypes.indexOf('reference') !== -1) {
      var refIns = [];
      for (ei2 = 0; ei2 < nAdj.inb.length; ei2++) {
        var eRefIn = nAdj.inb[ei2];
        if (eRefIn.type !== 'reference') continue;
        var sRefIn = bgNid(eRefIn.source);
        var kRefIn = 'ri\0' + sRefIn + '\0' + (eRefIn.field || '');
        if (seen[kRefIn]) continue;
        seen[kRefIn] = true;
        refIns.push(
          sRefIn +
            '.' +
            (eRefIn.field || '') +
            ' (' +
            (eRefIn.label || eRefIn.field || sRefIn) +
            ')'
        );
      }
      if (refIns.length) {
        lines.push('');
        lines.push('**Referenced by (in):** ' + refIns.join(', '));
      }
    }

    // Extended by (children — extends in)
    if (edgeTypes.indexOf('extends') !== -1) {
      var children = [];
      for (ei2 = 0; ei2 < nAdj.inb.length; ei2++) {
        var eChild = nAdj.inb[ei2];
        if (eChild.type !== 'extends') continue;
        var sChild = bgNid(eChild.source);
        var kChild = 'eb\0' + sChild;
        if (seen[kChild]) continue;
        seen[kChild] = true;
        children.push(sChild);
      }
      if (children.length) {
        lines.push('');
        lines.push('**Extended by:** ' + children.join(', '));
      }
    }

    // M2M
    if (edgeTypes.indexOf('m2m') !== -1) {
      var m2ms = [];
      var m2mAll = nAdj.out.concat(nAdj.inb);
      for (ei2 = 0; ei2 < m2mAll.length; ei2++) {
        var eM = m2mAll[ei2];
        if (eM.type !== 'm2m') continue;
        var sM = bgNid(eM.source),
          tM = bgNid(eM.target);
        var kM = 'm\0' + (sM < tM ? sM + '\0' + tM : tM + '\0' + sM);
        if (seen[kM]) continue;
        seen[kM] = true;
        var otherM = sM === n.id ? tM : sM;
        m2ms.push((eM.label || eM.junctionTable || otherM) + ' (↔ ' + otherM + ')');
      }
      if (m2ms.length) {
        lines.push('');
        lines.push('**M2M:** ' + m2ms.join(', '));
      }
    }

    // Named relationships
    if (edgeTypes.indexOf('rel') !== -1) {
      var rels = [];
      var relAll = nAdj.out.concat(nAdj.inb);
      for (ei2 = 0; ei2 < relAll.length; ei2++) {
        var eRl = relAll[ei2];
        if (eRl.type !== 'rel') continue;
        var sRl = bgNid(eRl.source),
          tRl = bgNid(eRl.target);
        var kRl = 'rl\0' + sRl + '\0' + tRl;
        if (seen[kRl]) continue;
        seen[kRl] = true;
        var otherRl = sRl === n.id ? tRl : sRl;
        rels.push((eRl.label ? eRl.label + ' → ' : '→ ') + otherRl);
      }
      if (rels.length) {
        lines.push('');
        lines.push('**Named relationships:** ' + rels.join(', '));
      }
    }

    // DB Views
    if (edgeTypes.indexOf('view') !== -1) {
      var views = [];
      var viewAll = nAdj.out.concat(nAdj.inb);
      for (ei2 = 0; ei2 < viewAll.length; ei2++) {
        var eVw = viewAll[ei2];
        if (eVw.type !== 'view') continue;
        var sVw = bgNid(eVw.source),
          tVw = bgNid(eVw.target);
        var kVw = 'vw\0' + (sVw < tVw ? sVw + '\0' + tVw : tVw + '\0' + sVw);
        if (seen[kVw]) continue;
        seen[kVw] = true;
        views.push(sVw === n.id ? tVw : sVw);
      }
      if (views.length) {
        lines.push('');
        lines.push('**DB Views:** ' + views.join(', '));
      }
    }

    // CI topology
    if (edgeTypes.indexOf('cmdb_rel') !== -1) {
      var ciTops = [];
      var ciAll = nAdj.out.concat(nAdj.inb);
      for (ei2 = 0; ei2 < ciAll.length; ei2++) {
        var eCi = ciAll[ei2];
        if (eCi.type !== 'cmdb_rel') continue;
        var sCi = bgNid(eCi.source),
          tCi = bgNid(eCi.target);
        var kCi = 'ci\0' + (sCi < tCi ? sCi + '\0' + tCi : tCi + '\0' + sCi);
        if (seen[kCi]) continue;
        seen[kCi] = true;
        var otherCi = sCi === n.id ? tCi : sCi;
        ciTops.push((eCi.label ? eCi.label + ' → ' : '→ ') + otherCi);
      }
      if (ciTops.length) {
        lines.push('');
        lines.push('**CI topology:** ' + ciTops.join(', '));
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/** SN field type to XSD datatype URI fragment (JSON-LD export). */
var BG_TYPE_XSD = {
  string: 'xsd:string',
  integer: 'xsd:integer',
  float: 'xsd:decimal',
  currency: 'xsd:decimal',
  currency2: 'xsd:decimal',
  boolean: 'xsd:boolean',
  glide_date_time: 'xsd:dateTime',
  glide_date: 'xsd:date',
  glide_duration: 'xsd:duration',
  glide_time: 'xsd:time',
  url: 'xsd:anyURI',
  email: 'xsd:string',
  html: 'xsd:string',
  script: 'xsd:string',
  script_plain: 'xsd:string',
  conditions: 'xsd:string',
  GUID: 'xsd:string',
  choice: 'xsd:string',
  sys_class_name: 'xsd:string',
  domain_id: 'xsd:string',
  journal_input: 'xsd:string',
  journal_list: 'xsd:string',
  workflow: 'xsd:string',
  document_id: 'xsd:string',
  password2: 'xsd:string',
};

function bgXsdType(t) {
  return BG_TYPE_XSD[t] || 'xsd:string';
}

/**
 * Serialise a fully-built schema object to JSON-LD.
 * Tables become owl:Class resources; fields become owl:DatatypeProperty or
 * owl:ObjectProperty resources linked via rdfs:domain / rdfs:range.
 */
function serializeJsonLdBg(schema) {
  var edgeTypes = CONFIG.edgeTypes || ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel'];
  var adj = bgBuildAdj(schema);
  var nodes = schema.nodes || [];
  var inst = schema._instance || {};
  var graph = [];

  var ni, fi, ei2;
  for (ni = 0; ni < nodes.length; ni++) {
    var n = nodes[ni];
    var nAdj = adj[n.id] || { out: [], inb: [] };
    var seen = {};
    var obj = {};

    obj['@id'] = 'snp:' + n.id;
    obj['@type'] = 'owl:Class';
    obj['rdfs:label'] = n.label || n.id;
    if (n.scope) obj['sn:scope'] = n.scope;
    if (n.ws_access === false) obj['sn:wsAccessible'] = false;

    // rdfs:subClassOf — first extends-out edge whose source is this node
    if (edgeTypes.indexOf('extends') !== -1) {
      for (ei2 = 0; ei2 < nAdj.out.length; ei2++) {
        var eEx = nAdj.out[ei2];
        if (eEx.type === 'extends' && bgNid(eEx.source) === n.id) {
          var tEx = bgNid(eEx.target);
          if (tEx) {
            obj['rdfs:subClassOf'] = { '@id': 'snp:' + tEx };
            break;
          }
        }
      }
    }

    // sn:extendedBy — extends-in edges
    if (edgeTypes.indexOf('extends') !== -1) {
      var extBy = [];
      for (ei2 = 0; ei2 < nAdj.inb.length; ei2++) {
        var eEb = nAdj.inb[ei2];
        if (eEb.type !== 'extends') continue;
        var sEb = bgNid(eEb.source);
        var kEb = 'eb\0' + sEb;
        if (seen[kEb]) continue;
        seen[kEb] = true;
        extBy.push({ '@id': 'snp:' + sEb });
      }
      if (extBy.length) obj['sn:extendedBy'] = extBy;
    }

    // sn:fields — property objects
    var fields = n.fields || [];
    if (fields.length) {
      var fObjs = [];
      for (fi = 0; fi < fields.length; fi++) {
        var fld = fields[fi];
        var fNm = fld.name || fld.element || '';
        if (!fNm) continue;
        var fTy = fld.type || 'string';
        var fObj = {};
        fObj['@id'] = 'sn:' + n.id + '_' + fNm;
        fObj['rdfs:label'] = fld.label || fNm;
        if (fTy === 'reference' && fld.reference) {
          fObj['@type'] = 'owl:ObjectProperty';
          fObj['rdfs:range'] = { '@id': 'snp:' + fld.reference };
        } else {
          fObj['@type'] = 'owl:DatatypeProperty';
          fObj['rdfs:range'] = { '@id': bgXsdType(fTy) };
        }
        if (fld.mandatory) fObj['sn:mandatory'] = true;
        fObjs.push(fObj);
      }
      if (fObjs.length) obj['sn:fields'] = fObjs;
    }

    // sn:references — reference-out edges
    if (edgeTypes.indexOf('reference') !== -1) {
      var refs = [];
      for (ei2 = 0; ei2 < nAdj.out.length; ei2++) {
        var eRo = nAdj.out[ei2];
        if (eRo.type !== 'reference') continue;
        var tRo = bgNid(eRo.target);
        var kRo = 'ro\0' + (eRo.field || '') + '\0' + tRo;
        if (seen[kRo]) continue;
        seen[kRo] = true;
        var roObj = { '@id': 'snp:' + tRo };
        if (eRo.field) roObj['sn:field'] = eRo.field;
        if (eRo.label) roObj['rdfs:label'] = eRo.label;
        refs.push(roObj);
      }
      if (refs.length) obj['sn:references'] = refs;
    }

    // sn:referencedBy — reference-in edges
    if (edgeTypes.indexOf('reference') !== -1) {
      var refBys = [];
      for (ei2 = 0; ei2 < nAdj.inb.length; ei2++) {
        var eRi = nAdj.inb[ei2];
        if (eRi.type !== 'reference') continue;
        var sRi = bgNid(eRi.source);
        var kRi = 'ri\0' + sRi + '\0' + (eRi.field || '');
        if (seen[kRi]) continue;
        seen[kRi] = true;
        var riObj = { '@id': 'snp:' + sRi };
        if (eRi.field) riObj['sn:field'] = eRi.field;
        refBys.push(riObj);
      }
      if (refBys.length) obj['sn:referencedBy'] = refBys;
    }

    // sn:m2m
    if (edgeTypes.indexOf('m2m') !== -1) {
      var m2ms = [];
      var m2mAll = nAdj.out.concat(nAdj.inb);
      for (ei2 = 0; ei2 < m2mAll.length; ei2++) {
        var eM = m2mAll[ei2];
        if (eM.type !== 'm2m') continue;
        var sM = bgNid(eM.source),
          tM = bgNid(eM.target);
        var kM = 'm\0' + (sM < tM ? sM + '\0' + tM : tM + '\0' + sM);
        if (seen[kM]) continue;
        seen[kM] = true;
        var otherM = sM === n.id ? tM : sM;
        var mObj = { '@id': 'snp:' + otherM };
        if (eM.label) mObj['rdfs:label'] = eM.label;
        if (eM.junctionTable) mObj['sn:junctionTable'] = eM.junctionTable;
        m2ms.push(mObj);
      }
      if (m2ms.length) obj['sn:m2m'] = m2ms;
    }

    // sn:namedRelationships
    if (edgeTypes.indexOf('rel') !== -1) {
      var rels = [];
      var relAll = nAdj.out.concat(nAdj.inb);
      for (ei2 = 0; ei2 < relAll.length; ei2++) {
        var eRl = relAll[ei2];
        if (eRl.type !== 'rel') continue;
        var sRl = bgNid(eRl.source),
          tRl = bgNid(eRl.target);
        var kRl = 'rl\0' + sRl + '\0' + tRl;
        if (seen[kRl]) continue;
        seen[kRl] = true;
        var otherRl = sRl === n.id ? tRl : sRl;
        var rlObj = { '@id': 'snp:' + otherRl };
        if (eRl.label) rlObj['rdfs:label'] = eRl.label;
        rels.push(rlObj);
      }
      if (rels.length) obj['sn:namedRelationships'] = rels;
    }

    // sn:dbViews
    if (edgeTypes.indexOf('view') !== -1) {
      var viewsJ = [];
      var viewAllJ = nAdj.out.concat(nAdj.inb);
      for (ei2 = 0; ei2 < viewAllJ.length; ei2++) {
        var eVw = viewAllJ[ei2];
        if (eVw.type !== 'view') continue;
        var sVw = bgNid(eVw.source),
          tVw = bgNid(eVw.target);
        var kVw = 'vw\0' + (sVw < tVw ? sVw + '\0' + tVw : tVw + '\0' + sVw);
        if (seen[kVw]) continue;
        seen[kVw] = true;
        var otherVw = sVw === n.id ? tVw : sVw;
        viewsJ.push({ '@id': 'snp:' + otherVw });
      }
      if (viewsJ.length) obj['sn:dbViews'] = viewsJ;
    }

    // sn:ciTopology
    if (edgeTypes.indexOf('cmdb_rel') !== -1) {
      var ciTops = [];
      var ciAllJ = nAdj.out.concat(nAdj.inb);
      for (ei2 = 0; ei2 < ciAllJ.length; ei2++) {
        var eCi = ciAllJ[ei2];
        if (eCi.type !== 'cmdb_rel') continue;
        var sCi = bgNid(eCi.source),
          tCi = bgNid(eCi.target);
        var kCi = 'ci\0' + (sCi < tCi ? sCi + '\0' + tCi : tCi + '\0' + sCi);
        if (seen[kCi]) continue;
        seen[kCi] = true;
        var otherCi = sCi === n.id ? tCi : sCi;
        var ciObj = { '@id': 'snp:' + otherCi };
        if (eCi.label) ciObj['rdfs:label'] = eCi.label;
        ciTops.push(ciObj);
      }
      if (ciTops.length) obj['sn:ciTopology'] = ciTops;
    }

    graph.push(obj);
  }

  var doc = {
    '@context': {
      owl: 'http://www.w3.org/2002/07/owl#',
      rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
      sn: 'https://servicenow.com/schema#',
      snp: 'https://servicenow.com/table/',
    },
    '@graph': graph,
  };

  if (inst.instance_name) doc['sn:instanceName'] = inst.instance_name;
  if (inst.exported_at) doc['sn:exportedAt'] = inst.exported_at;

  return JSON.stringify(doc, null, 2);
}

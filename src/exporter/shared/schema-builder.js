/* ============================================================================
 * SchemaBuilder — shared core for the ServiceNow schema exporter
 * ============================================================================
 *
 * Pure transformation function. Takes the seven source-table arrays (already
 * fetched from sys_db_object, sys_dictionary, sys_m2m, sys_db_view,
 * sys_db_view_table, sys_relationship, sys_glide_object) and returns the
 * viewer-ready JSON.
 *
 * Designed to run identically in:
 *   • ServiceNow Background Scripts (server-side Rhino/JS)
 *   • Node.js extractor (standard JS)
 *
 * Therefore: NO server-side dependencies (no GlideRecord, no gs.*), NO modern
 * Node-only APIs. Plain ES5-compatible JavaScript, callable as either a CommonJS
 * module (Node) or a global variable (background script).
 *
 * Performance characteristics
 * ---------------------------
 *   • Zero nested loops over the full edge/field sets. Everything works through
 *     pre-built Maps keyed by table name.
 *   • Single pass over each input array.
 *   • Total complexity: O(T + F + R + V + VT + M + G) where the inputs are
 *     tables, fields, relationships, views, view-table-members, m2m, glide-types.
 *
 * Input shape (each item is a plain object — what the source table's columns
 * look like after JSON conversion). All `*Ref` fields are { name, displayValue }
 * objects so display names survive even when the link is broken.
 *
 *   sysDbObject:    [{ sys_id, name, label, super_class:{name,displayValue},
 *                      sys_scope:{name,displayValue}, is_extendable, access,
 *                      ws_access, scriptable_table }]
 *   sysDictionary:  [{ sys_id, name (table), element (field), column_label,
 *                      internal_type:{value,displayValue},
 *                      reference:{name,displayValue}, max_length, mandatory,
 *                      primary,
 *                      virtual, active  ← carried through as-is for future use;
 *                                         build() does not currently consume them }]
 *   sysM2m:         [{ sys_id, from_table, to_table, m2m_table,
 *                      m2m_from_field, m2m_to_field,
 *                      m2m_from_label, m2m_to_label }]
 *   sysDbView:      [{ sys_id, name, label, description, plural }]
 *   sysDbViewTable: [{ sys_id, view:{name,displayValue}, table, order,
 *                      left_join, where_clause, variable_prefix, active }]
 *   sysRelationship:[{ sys_id, name, query_from, query_with, apply_to,
 *                      basic_query_from, basic_apply_to, advanced }]
 *   sysGlideObject: [{ sys_id, name, label, scalar_type, scalar_length,
 *                      class_name, visible, attributes }]
 *   cmdbRelTypeSuggest: [{ base_class, dependent_class,
 *                          parent (boolean — true means base_class is parent),
 *                          rel_type_display }]
 *     The class-level "suggested relationships" catalog from
 *     `cmdb_rel_type_suggest`. SchemaBuilder dedupes mirror entries (same
 *     logical relationship recorded from both sides) and emits a clean
 *     parent→child list as `_ciRelationships` in the output.
 *
 * Output shape — see the README for full schema. Backward compatible with the
 * existing viewer's `{nodes, edges}` model; new top-level fields are silently
 * ignored by older builds.
 * ============================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js / CommonJS
    module.exports = factory();
  } else {
    // Browser / Rhino / ServiceNow server-side: attach to whatever global
    // we can find. Rhino's top-level `this` is the global object when the
    // function is called without an explicit receiver, which is what
    // happens here (the IIFE is invoked as `(function(){})(root,fn)`).
    root.SchemaBuilder = factory();
  }
})(
  // Determine the global object across environments.
  // - Node:    `global`
  // - Browser: `self` (or `window`)
  // - Rhino:   the top-level `this` resolves to the global scope
  (typeof globalThis !== 'undefined') ? globalThis :
  (typeof self !== 'undefined')       ? self :
  (typeof global !== 'undefined')     ? global :
  this,
  function () {

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function ref(name, displayValue) {
    // Normalise the {name, displayValue} ref shape. Strips empties.
    if (!name && !displayValue) return null;
    return { name: name || '', displayValue: displayValue || name || '' };
  }

  /**
   * Try to extract a target-table name from a sys_relationship row whose
   * `query_from` is a script blob. We look for the common pattern:
   *   answer = "<table>";   answer = '<table>';   answer="<table>";
   * Returns the table name on a confident match, or null.
   * Anything more dynamic (concatenation, variable lookup, conditional)
   * is flagged as scripted and surfaced separately rather than guessed.
   */
  function parseRelationshipTargetTable(queryFrom) {
    if (!queryFrom || typeof queryFrom !== 'string') return null;
    // Strip CDATA wrappers if present (some sources include them)
    var q = queryFrom.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
    // Single line, simple assignment to a string literal — confident match
    var m = q.match(/^\s*answer\s*=\s*['"]([a-z_][a-z0-9_]*)['"]\s*;?\s*$/i);
    if (m) return m[1];
    // Allow whitespace + var/let declarations around it (still simple)
    m = q.match(/^\s*(?:var|let|const)?\s*answer\s*=\s*['"]([a-z_][a-z0-9_]*)['"]\s*;?\s*$/i);
    if (m) return m[1];
    return null; // dynamic — surface but don't pretend to know
  }

  /**
   * Best-effort parse of `basic_apply_to` to figure out which source tables
   * this scripted relationship applies to. Same conservative approach.
   */
  function parseRelationshipApplyTable(applyTo, basicApplyTo) {
    // basic_apply_to is often the plain table name when the script is simple
    if (basicApplyTo && /^[a-z_][a-z0-9_]*$/i.test(basicApplyTo)) return basicApplyTo;
    if (!applyTo || typeof applyTo !== 'string') return null;
    var a = applyTo.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
    var m = a.match(/^\s*answer\s*=\s*['"]([a-z_][a-z0-9_]*)['"]\s*;?\s*$/i);
    return m ? m[1] : null;
  }

  // ── Main build function ─────────────────────────────────────────────────────
  function build(input, options) {
    options = options || {};
    var startedAt = new Date();
    var t0 = Date.now();

    var sysDbObject    = input.sysDbObject    || [];
    var sysDictionary  = input.sysDictionary  || [];
    var sysM2m         = input.sysM2m         || [];
    var sysDbView      = input.sysDbView      || [];
    var sysDbViewTable = input.sysDbViewTable || [];
    var sysRelation    = input.sysRelationship || [];
    var sysGlideObject = input.sysGlideObject || [];
    var cmdbRelTypeSuggest = input.cmdbRelTypeSuggest || [];
    var recordCounts   = input.recordCounts   || null; // Map<tableName, integer|null> or null
    // Failures captured per-table during record-count collection. Allows the
    // exporter to distinguish "no count requested" from "count attempted and
    // failed", and to bucket failures by category (acl / unsupported / script
    // error). Map<tableName, {category, message}> or null.
    var recordCountFailures = input.recordCountFailures || null;

    // ── 1. Build the table index (sys_db_object) ────────────────────────────
    // Maps that downstream stages use to resolve table identity, label, scope.
    // Key is the technical name (column `name`), which is the natural join key
    // everywhere else in the schema.
    var tableByName = {};      // name -> node-in-progress
    var extendableSet = {};    // name -> true   (for cheap lookup in field stage)
    var packagePrivate = [];   // names of tables with access='package_private'
    for (var i = 0; i < sysDbObject.length; i++) {
      var t = sysDbObject[i];
      if (!t.name) continue;
      tableByName[t.name] = {
        id:     t.name,
        label:  t.label || t.name,
        scope:  (t.sys_scope && t.sys_scope.displayValue) || 'Global',
        access: t.access || null,
        // Note: super (parent) is set in the extends-edge stage below so that we
        // capture all extends edges in a single edge-emission spot.
        // Fields are populated in stage 2.
        fields: []
        // _isView, _isExtendable etc. are added on the fly.
      };
      if (t.is_extendable === true || t.is_extendable === 'true') {
        extendableSet[t.name] = true;
        tableByName[t.name]._isExtendable = true;
      }
      // ws_access=false means the table is not accessible via the Table API / REST.
      // Only flagged when explicitly false; absence means accessible (the default).
      if (t.ws_access === false) {
        tableByName[t.name].ws_access = false;
      }
      if (t.access === 'package_private') {
        packagePrivate.push(t.name);
      }
    }

    // Database views become nodes too, marked with _isView so the viewer can
    // style them differently from regular tables. View members are emitted as
    // edges in the view-edge stage below.
    for (var iv = 0; iv < sysDbView.length; iv++) {
      var v = sysDbView[iv];
      if (!v.name) continue;
      // It's legal for a view name to also exist as a regular table name; in
      // practice ServiceNow keeps these disjoint. If a collision happens, the
      // regular table wins (already in the map) and the view is annotated.
      if (tableByName[v.name]) {
        tableByName[v.name]._isView = true;
        continue;
      }
      tableByName[v.name] = {
        id:     v.name,
        label:  v.label || v.name,
        scope:  'Global',
        fields: [],
        _isView: true
      };
    }

    // ── 2. Build fields per table (sys_dictionary) ──────────────────────────
    // We iterate sys_dictionary ONCE. Rows where `element` is empty are the
    // table-level config rows (no field) and are skipped here — sys_db_object
    // gives us everything we need at that level. We also collect reference
    // edges as we go, since each one is uniquely derived from a dictionary row.
    // fieldSeen and refEdgeSeen guard against duplicate input rows (e.g. from
    // unstable Table API pagination returning a boundary row on two consecutive
    // pages, or GlideRecord returning a row twice under certain index conditions).
    var fieldSeen = {};    // tableName → { elementName: true }
    var refEdgeSeen = {};  // "table\x01field" → true
    var referenceEdges = []; // { source, target, type:'reference', field, label }
    for (var id = 0; id < sysDictionary.length; id++) {
      var d = sysDictionary[id];
      if (!d.name || !d.element) continue; // skip table-level rows
      var tableNode = tableByName[d.name];
      if (!tableNode) continue; // dictionary row for a table not in sys_db_object — skip

      // Deduplicate: skip if we've already processed this (table, element) pair
      if (!fieldSeen[d.name]) fieldSeen[d.name] = {};
      if (fieldSeen[d.name][d.element]) continue;
      fieldSeen[d.name][d.element] = true;

      var typeValue = (d.internal_type && d.internal_type.value) || 'string';
      var typeLabel = (d.internal_type && d.internal_type.displayValue) || typeValue;

      tableNode.fields.push({
        name:        d.element,
        label:       d.column_label || d.element,
        type:        typeValue,
        typeLabel:   typeLabel,
        mandatory:   d.mandatory === true || d.mandatory === 'true',
        maxLength:   d.max_length ? parseInt(d.max_length, 10) : null,
        primary:     d.primary === true || d.primary === 'true',
        // We don't ship `virtual`/`array`/`audit`/etc. by default — viewer
        // doesn't surface them. They can be added later via options.includeFlags.
        reference:   (d.reference && d.reference.name) || null
      });

      // Reference edges — only when there's a real target table
      if (d.internal_type && (typeValue === 'reference' || typeValue === 'glide_list')) {
        var refTarget = d.reference && d.reference.name;
        if (refTarget && tableByName[refTarget]) {
          var refKey = d.name + '\x01' + d.element;
          if (!refEdgeSeen[refKey]) {
            refEdgeSeen[refKey] = true;
            referenceEdges.push({
              source: d.name,
              target: refTarget,
              type:   'reference',
              field:  d.element,
              label:  d.column_label || d.element
            });
          }
        }
      }
    }

    // ── 3. Build extends edges (sys_db_object.super_class) ──────────────────
    var extendsEdges = [];
    var extendsSeen = {}; // tableName → true (each table can extend at most one parent)
    for (var ix = 0; ix < sysDbObject.length; ix++) {
      var tx = sysDbObject[ix];
      if (!tx.name) continue;
      var parent = tx.super_class && tx.super_class.name;
      if (!parent || !tableByName[parent]) continue;
      if (extendsSeen[tx.name]) continue; // duplicate sysDbObject row — skip
      extendsSeen[tx.name] = true;
      extendsEdges.push({
        source: tx.name,
        target: parent,
        type:   'extends',
        label:  'extends'
      });
    }

    // ── 4. Build m2m edges (sys_m2m) ────────────────────────────────────────
    // We emit one logical edge from→to per row, annotated with the junction
    // table name so the viewer (or downstream tooling) can drill in if needed.
    // The from_table / to_table fields can occasionally reference a table that
    // isn't in our index (orphaned m2m rows from uninstalled plugins) — we skip
    // those silently.
    var m2mEdges = [];
    for (var im = 0; im < sysM2m.length; im++) {
      var mm = sysM2m[im];
      if (!mm.from_table || !mm.to_table) continue;
      if (!tableByName[mm.from_table] || !tableByName[mm.to_table]) continue;
      m2mEdges.push({
        source:  mm.from_table,
        target:  mm.to_table,
        type:    'm2m',
        label:   mm.m2m_to_label || mm.m2m_from_label || mm.m2m_table || '',
        viaTable:    mm.m2m_table || null,
        fromField:   mm.m2m_from_field || null,
        toField:     mm.m2m_to_field || null
      });
    }

    // ── 5. Build view edges (sys_db_view_table → sys_db_view) ───────────────
    // Each view-table-member row becomes a "view" edge from the view node to
    // the member table. We carry order + where_clause + variable_prefix so the
    // viewer / downstream tools can reconstruct the join.
    var viewEdges = [];
    for (var iw = 0; iw < sysDbViewTable.length; iw++) {
      var vt = sysDbViewTable[iw];
      var viewName = vt.view && vt.view.displayValue ? vt.view.displayValue :
                     (vt.view && vt.view.name ? vt.view.name : null);
      // The view ref shows up as displayValue=name on view-table-member rows,
      // since the value in storage is the sys_id. We rely on viewName already
      // being the view's technical name in the data shape produced by the
      // fetchers.
      if (!viewName || !vt.table) continue;
      if (!tableByName[viewName] || !tableByName[vt.table]) continue;
      viewEdges.push({
        source:  viewName,
        target:  vt.table,
        type:    'view',
        label:   vt.variable_prefix ? ('as ' + vt.variable_prefix) : '',
        order:        vt.order != null ? parseInt(vt.order, 10) : null,
        leftJoin:     vt.left_join === true || vt.left_join === 'true',
        whereClause:  vt.where_clause || ''
      });
    }

    // ── 6. Build named-relationship edges (sys_relationship) ────────────────
    // sys_relationship is the dirtiest input. Many rows compute their target
    // table dynamically in a script. We do best-effort static parsing; when
    // we can't be confident we still emit the relationship as a "rel" edge
    // but mark _scripted=true and ship the script body so the viewer can
    // surface it informationally.
    var relEdges = [];
    for (var ir = 0; ir < sysRelation.length; ir++) {
      var rr = sysRelation[ir];
      if (!rr.name) continue;
      var fromTable = parseRelationshipApplyTable(rr.apply_to, rr.basic_apply_to);
      var toTable   = parseRelationshipTargetTable(rr.query_from) ||
                      (rr.basic_query_from && /^[a-z_][a-z0-9_]*$/i.test(rr.basic_query_from)
                         ? rr.basic_query_from : null);
      var scripted  = !(fromTable && toTable);

      // We only emit edges where BOTH endpoints resolve to known tables;
      // dangling endpoints aren't drawable. The script body is still kept
      // on the edge so a future viewer can surface the relationship even
      // if one side is dynamic.
      if (fromTable && toTable && tableByName[fromTable] && tableByName[toTable]) {
        relEdges.push({
          source:    fromTable,
          target:    toTable,
          type:      'rel',
          label:     rr.name,
          _scripted: scripted,
          _scriptQueryFrom: rr.query_from || '',
          _scriptQueryWith: rr.query_with || '',
          _scriptApplyTo:   rr.apply_to   || ''
        });
      }
    }

    // ── 7. Assemble final node and edge lists ───────────────────────────────
    var nodes = [];
    for (var key in tableByName) {
      if (!Object.prototype.hasOwnProperty.call(tableByName, key)) continue;
      var node = tableByName[key];
      // Attach record count if provided AND non-null. A null entry means the
      // exporter attempted a count but the table returned an error (ACL, vtable
      // bug, unsupported aggregate). We omit the field rather than write 0,
      // since 0 has a real meaning (table exists but is empty).
      if (recordCounts && Object.prototype.hasOwnProperty.call(recordCounts, key)) {
        var rc = recordCounts[key];
        if (rc !== null && rc !== undefined) node.recordCount = rc;
      }
      // If a count failure was recorded, surface its category on the node so
      // the viewer can render "unavailable (acl)" etc.
      if (recordCountFailures && Object.prototype.hasOwnProperty.call(recordCountFailures, key)) {
        node.recordCountStatus = recordCountFailures[key].category;
      }
      nodes.push(node);
    }

    var edges = []
      .concat(extendsEdges)
      .concat(referenceEdges)
      .concat(m2mEdges)
      .concat(viewEdges)
      .concat(relEdges);

    // ── 8. Type catalog (sys_glide_object) ──────────────────────────────────
    // Keyed by internal type name. The viewer hashes unknowns; this map lets
    // it look up the human label and base scalar type for known ones.
    var typeCatalog = {};
    for (var ig = 0; ig < sysGlideObject.length; ig++) {
      var go = sysGlideObject[ig];
      if (!go.name) continue;
      typeCatalog[go.name] = {
        label:        go.label || go.name,
        scalarType:   go.scalar_type || null,
        scalarLength: go.scalar_length ? parseInt(go.scalar_length, 10) : null,
        className:    go.class_name || null,
        visible:      go.visible === true || go.visible === 'true',
        attributes:   go.attributes || ''
      };
    }

    // ── 9. Compute summary stats ────────────────────────────────────────────
    var scopeCounts = {};
    var fieldTotal = 0;
    var tablesWithRefs = 0;
    var deepestChain = 0;
    var refSourceTables = {};
    for (var ie = 0; ie < referenceEdges.length; ie++) refSourceTables[referenceEdges[ie].source] = true;

    // Build a parent-lookup map and compute deepest extends chain by memoised DFS
    var parentMap = {};
    for (var iex = 0; iex < extendsEdges.length; iex++) parentMap[extendsEdges[iex].source] = extendsEdges[iex].target;
    var depthCache = {};
    function depthOf(name) {
      if (depthCache[name] != null) return depthCache[name];
      var parent = parentMap[name];
      var d = parent ? (1 + depthOf(parent)) : 0;
      depthCache[name] = d;
      return d;
    }

    var viewNodeCount = 0;
    for (var iz = 0; iz < nodes.length; iz++) {
      var n = nodes[iz];
      // All nodes (tables and views) contribute to scope counts.
      scopeCounts[n.scope] = (scopeCounts[n.scope] || 0) + 1;
      if (n._isView) { viewNodeCount++; continue; } // skip view-specific stats below
      fieldTotal += n.fields.length;
      if (refSourceTables[n.id]) tablesWithRefs++;
      var d = depthOf(n.id);
      if (d > deepestChain) deepestChain = d;
    }

    var pureTableCount = nodes.length - viewNodeCount; // sys_db_object tables only, excludes sys_db_view nodes

    var counts = {
      tables:                 pureTableCount,          // real tables only; DB views counted separately below
      fields:                 fieldTotal,
      references:             referenceEdges.length,
      m2m_relationships:      m2mEdges.length,
      db_views:               sysDbView.length,
      view_members:           viewEdges.length,
      named_relationships:    relEdges.length,
      extends_edges:          extendsEdges.length,
      unique_scopes:          Object.keys(scopeCounts).length,
      type_catalog_entries:   Object.keys(typeCatalog).length,
      package_private_tables: packagePrivate.length
    };
    var coverage = {
      tables_with_references:        tablesWithRefs,
      tables_with_references_pct:    pureTableCount ? +(100 * tablesWithRefs / pureTableCount).toFixed(1) : 0,
      avg_fields_per_table:          pureTableCount ? +(fieldTotal / pureTableCount).toFixed(1) : 0,
      deepest_inheritance_chain:     deepestChain
    };

    var elapsedMs = Date.now() - t0;

    // ── 10. Assemble final output ───────────────────────────────────────────
    // Build a structured _capabilities.recordCounts. The viewer reads this to
    // gate UI (e.g. show "—" instead of "0" for tables with status=acl).
    var recordCountsCap;
    if (!recordCounts) {
      recordCountsCap = { enabled: false };
    } else {
      var attempted = 0, succeeded = 0;
      for (var rcKey in recordCounts) {
        if (!Object.prototype.hasOwnProperty.call(recordCounts, rcKey)) continue;
        attempted++;
        if (recordCounts[rcKey] !== null && recordCounts[rcKey] !== undefined) succeeded++;
      }
      var failureBreakdown = { acl: 0, unsupported: 0, script_error: 0, other: 0 };
      var failedTables = [];
      if (recordCountFailures) {
        for (var fk in recordCountFailures) {
          if (!Object.prototype.hasOwnProperty.call(recordCountFailures, fk)) continue;
          var f = recordCountFailures[fk];
          var cat = f && f.category ? f.category : 'other';
          if (!Object.prototype.hasOwnProperty.call(failureBreakdown, cat)) cat = 'other';
          failureBreakdown[cat]++;
          failedTables.push(fk);
        }
      }
      recordCountsCap = {
        enabled:      true,
        partial:      failedTables.length > 0,
        attempted:    attempted,
        succeeded:    succeeded,
        failedCount:  failedTables.length,
        failuresByCategory: failureBreakdown
      };
    }

    // ── CI topology relationships from cmdb_rel_type_suggest ────────────
    // Each input row tells us: classes (base, dependent), the relationship
    // type ("Contains::Contained by"), and whether base_class plays the
    // parent role. The same logical relationship is often recorded twice
    // — once from each side's perspective — so we dedupe.
    //
    // Dedup key: sorted (parent, child, relTypeDisplay). The parent-direction
    // row is canonical; if only the child-direction row exists for some
    // pair we still capture it (and swap fields so parent is the parent).
    var ciRelMap = {};
    for (var iCr = 0; iCr < cmdbRelTypeSuggest.length; iCr++) {
      var cr = cmdbRelTypeSuggest[iCr];
      if (!cr || !cr.base_class || !cr.dependent_class || !cr.rel_type_display) continue;
      // Determine parent/child from the boolean
      var parentClass, childClass;
      if (cr.parent === true || cr.parent === 'true') {
        parentClass = cr.base_class;
        childClass  = cr.dependent_class;
      } else {
        parentClass = cr.dependent_class;
        childClass  = cr.base_class;
      }
      // Split "Contains::Contained by" into parent-verb / child-verb
      var verbs = String(cr.rel_type_display).split('::');
      var parentVerb = verbs[0] || cr.rel_type_display;
      var childVerb  = verbs[1] || verbs[0] || cr.rel_type_display;
      var key = parentClass + '\u0001' + childClass + '\u0001' + cr.rel_type_display;
      if (!ciRelMap[key]) {
        ciRelMap[key] = {
          parentClass: parentClass,
          childClass:  childClass,
          parentLabel: parentVerb,   // verb when parent is the focused CI ("Contains")
          childLabel:  childVerb,    // verb when child is the focused CI ("Contained by")
          relTypeDisplay: cr.rel_type_display
        };
      }
    }
    var ciRelationships = [];
    for (var crKey in ciRelMap) {
      if (Object.prototype.hasOwnProperty.call(ciRelMap, crKey)) {
        ciRelationships.push(ciRelMap[crKey]);
      }
    }
    // Sort for deterministic output: by parent class, then child class, then type
    ciRelationships.sort(function (a, b) {
      var pa = String(a.parentClass), pb = String(b.parentClass);
      if (pa !== pb) return pa < pb ? -1 : 1;
      var ca = String(a.childClass), cb = String(b.childClass);
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.relTypeDisplay) < String(b.relTypeDisplay) ? -1 : 1;
    });
    // Back-fill into counts — ciRelationships isn't available when counts is first built
    counts.ci_relationships = ciRelationships.length;

    var output = {
      _schema_version: 1,
      _instance: input.instance || {},
      _stats: { counts: counts, coverage: coverage, scopes: scopeCounts },
      _capabilities: {
        recordCounts:           recordCountsCap,
        namedRelationshipsParsed: 'static-with-script-fallback',
        scriptedRelationshipsIncluded: true,
        ciRelationshipsIncluded: ciRelationships.length > 0
      },
      _typeCatalog: typeCatalog,
      // Tables with sys_db_object.access='package_private' are only accessible
      // from within their own scope. Table API callers from other scopes will not
      // see these tables or their field definitions. Background-script exports
      // capture them because they run as admin; this list lets consumers
      // pre-identify expected gaps when comparing against a Table API export.
      _restrictedHints: { packagePrivateTables: packagePrivate },
      _ciRelationships: ciRelationships,
      _build: {
        startedAt: startedAt.toISOString ? startedAt.toISOString() : String(startedAt),
        elapsedMs: elapsedMs,
        builderVersion: '2.0.0'
      },
      nodes: nodes,
      edges: edges
    };
    return output;
  }

  /**
   * Streaming serialiser. Produces the SAME JSON shape that JSON.stringify(build(input))
   * would, but emits it as many small writes via writeFn(chunkString) so no single
   * intermediate string exceeds the runtime's string-size cap (Rhino: 32 MB).
   *
   * Behaviour matches build() exactly — same fields, same ordering, same nested
   * structures. Only the serialisation strategy differs. All future schema
   * additions automatically flow through because we delegate per-element to
   * JSON.stringify (each node/edge fits easily under the cap).
   *
   * @param {Object}   input    Same input shape as build()
   * @param {Function} writeFn  Called with each JSON chunk (string). Must not throw.
   * @return {Object}           Summary of what was emitted: { counts, sizeBytes, elapsedMs }
   *                            (no big strings — counts only — safe under cap)
   */
  function buildStreaming(input, writeFn) {
    // We reuse build() to construct the full in-memory object graph. The 32 MB
    // limit is on STRINGS in Rhino, not on heap object size, so this is fine.
    var schema = build(input);
    var totalBytes = 0;

    function emit(chunk) {
      writeFn(chunk);
      totalBytes += chunk.length;
    }

    // Helper: emit a JSON-stringified value as a single chunk. Used for the
    // small header sections (each fits comfortably under the cap on its own).
    function emitJSON(value) {
      emit(JSON.stringify(value));
    }

    // Helper: emit one element of an array, with comma prefix for all but first.
    function emitArrayItem(value, isFirst) {
      if (!isFirst) emit(',');
      emit(JSON.stringify(value));
    }

    // ── Stream the JSON document ────────────────────────────────────────────
    // Header — write the document opening and all small top-level objects.
    emit('{"_schema_version":');
    emitJSON(schema._schema_version);
    emit(',"_instance":');
    emitJSON(schema._instance);
    emit(',"_stats":');
    emitJSON(schema._stats);
    emit(',"_capabilities":');
    emitJSON(schema._capabilities);
    emit(',"_typeCatalog":');
    emitJSON(schema._typeCatalog);
    emit(',"_restrictedHints":');
    emitJSON(schema._restrictedHints);
    emit(',"_ciRelationships":');
    emitJSON(schema._ciRelationships);
    emit(',"_build":');
    emitJSON(schema._build);

    // Nodes — one per write. Even a 200-field table serialises to <100 KB,
    // well under the 32 MB cap. This is where the bulk of the payload lives.
    emit(',"nodes":[');
    for (var i = 0; i < schema.nodes.length; i++) {
      emitArrayItem(schema.nodes[i], i === 0);
    }
    emit(']');

    // Edges — same treatment. Per-edge payloads stay small even when scripted
    // sys_relationship bodies are attached.
    emit(',"edges":[');
    for (var j = 0; j < schema.edges.length; j++) {
      emitArrayItem(schema.edges[j], j === 0);
    }
    emit(']');

    emit('}');

    return {
      counts:    schema._stats.counts,
      sizeBytes: totalBytes,
      elapsedMs: schema._build.elapsedMs
    };
  }

  return {
    build:          build,
    buildStreaming: buildStreaming,
    _internal: {
      parseRelationshipTargetTable: parseRelationshipTargetTable,
      parseRelationshipApplyTable:  parseRelationshipApplyTable
    }
  };
});

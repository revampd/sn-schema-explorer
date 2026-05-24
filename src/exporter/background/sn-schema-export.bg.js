/* ============================================================================
 * ServiceNow Schema Exporter — Background Script
 * ============================================================================
 *
 * Run from System Definition → Scripts - Background.
 *
 * What it does (in order):
 *   1. Fetches the eight schema-source tables with flat, non-nested GlideRecord
 *      queries (no per-row drill-down anywhere).
 *   2. Optionally collects per-table record counts via GlideAggregate
 *      (config flag below).
 *   3. Hands the raw arrays to the embedded SchemaBuilder (same code as the
 *      Node.js extractor).
 *   4. Emits the resulting JSON two ways:
 *        • Prints a download URL for the sys_attachment record.
 *        • Optionally streams the full JSON to gs.print() in chunks (for
 *          smaller exports where you want to copy it directly).
 *
 * Performance notes
 * -----------------
 *   • Single GlideRecord pass per source table — no setLimit() call, so all rows
 *     are fetched. (setLimit(0) means "return 0 rows", not "unbounded".)
 *   • No nested queries. Joins happen in JS via Maps in SchemaBuilder.
 *   • Record-count pass is opt-in because it adds N GlideAggregate calls
 *     (about 5-15 minutes on a typical instance with ~7k tables).
 *
 * Expected runtime on a typical instance (~7k tables, ~150k dictionary rows):
 *   • Without record counts:   45-90 seconds
 *   • With record counts:      5-15 minutes
 *
 * Output size (without record counts): ~16-20 MB JSON.
 * ============================================================================ */

// ─── CONFIGURATION ─────────────────────────────────────────────────────────
var CONFIG = {
    // Output format: 'json' | 'markdown' | 'jsonld'
    //
    // • 'json'     — Viewer-ready JSON (default). Supports streaming for large
    //                schemas; all edge types included.
    // • 'markdown' — One ## heading per table with a field table, references,
    //                extended-by list, and M2M/CI-topology sections.
    //                Useful for pasting into wikis or feeding into an LLM.
    // • 'jsonld'   — JSON-LD (linked data) with tables as owl:Class and fields
    //                as owl:DatatypeProperty / owl:ObjectProperty.
    //                Suitable for triplestores, RAG pipelines, or ML datasets.
    //
    // ⚠ OWL/Turtle and OpenAPI are NOT supported in this Background Script
    //   because their serialisers are too complex for the ES5/Rhino engine.
    //   Export as JSON first, then convert in the viewer (Export → ↓ OWL/Turtle
    //   or ↓ OpenAPI) or via the Node.js extractor (--format=owl|openapi).
    format:                'json',   // 'json' | 'markdown' | 'jsonld'

    // Edge types to include in Markdown and JSON-LD exports.
    // Remove any type you don't need to keep the output focused.
    edgeTypes:             ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel'],

    // Print the full JSON to gs.print() in addition to writing the attachment?
    // WARNING: very large exports (>5MB) may truncate in the script output panel.
    printToScriptOutput:   false,

    // Add per-table record counts to each node? Expensive — opt in only when
    // you actually need them (e.g. for the executive view).
    includeRecordCounts:   false,

    // When includeRecordCounts is true, limit to these table-name patterns
    // (regex strings). Empty array = count every table. Skipping sys_* and
    // metadata tables typically saves 80% of the time.
    recordCountInclude:    [],      // e.g. ['^cmdb_', '^task$', '^incident$']
    recordCountExclude:    ['^sys_', '^var_', '^ts_'],

    // Attach the JSON to this target. Default uses the user's own sys_user
    // record so the attachment is easy to find.
    attachmentTargetTable: 'sys_user',
    attachmentTargetSysId: gs.getUserID(),
    attachmentFileName:    'sn_schema_' + (gs.getProperty('instance_name') || 'export')
                          + '_' + new GlideDateTime().getNumericValue() + '.json',

    // Cap fields per table when assembling. Mainly a safety valve; 0 = no cap.
    maxFieldsPerTable:     0
};

// ───────────────────────────────────────────────────────────────────────────
// FETCHERS — each returns a plain array of plain objects matching the input
// shape that SchemaBuilder.build() expects. No GlideRecord references leak.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Read a GlideRecord field as a normalised value:
 *   • For reference fields: { displayValue, name, value(=sys_id) }
 *   • For everything else: the raw string value
 *
 * `nameAttribute` is the column on the *referenced* table whose value should
 * be used as the joinable name. Defaults to `name`, which is correct for
 * sys_db_object, sys_db_view, and friends. For sys_package etc. we don't need
 * a name (we never join on it) so we can pass null and skip the extra lookup.
 */
function readRef(gr, fieldName, nameAttribute) {
    var value = gr.getValue(fieldName);
    var displayValue = gr.getDisplayValue(fieldName);
    if (value == null && (displayValue == null || displayValue === '')) return null;
    var refName = '';
    if (nameAttribute) {
        try {
            var refGr = gr.getElement(fieldName).getRefRecord();
            if (refGr && refGr.isValidRecord()) {
                refName = String(refGr.getValue(nameAttribute) || '');
            }
        } catch (e) { /* ignore — orphaned reference */ }
    }
    return {
        displayValue: String(displayValue || ''),
        name:         refName,
        value:        String(value || '')
    };
}

/**
 * Robust GlideRecord factory. In scoped applications, accessing global tables
 * like sys_db_object can silently return zero rows even though the user has
 * read permission, because the app's cross-scope access policy intercepts the
 * query. We work around this by:
 *   1. Disabling the workflow engine (setWorkflow(false)) — irrelevant for
 *      read-only queries but harmless and removes ambient side effects.
 *   2. Calling getRowCount() right after query() so we get a real count
 *      regardless of pagination state.
 * Returns the prepared GlideRecord. Caller still calls .next() in a loop.
 */
function newGR(tableName) {
    var gr = new GlideRecord(tableName);
    // (No setLimit — default is unbounded. setLimit(0) actually means "return 0 rows".)
    if (typeof gr.setWorkflow === 'function') gr.setWorkflow(false);
    return gr;
}

/**
 * GlideRecord.getValue() on boolean fields returns 'true'/'false' on some
 * ServiceNow versions and '1'/'0' on others (the raw DB value).  Always use
 * parseBool() instead of === 'true' so the exporter works on both.
 */
function parseBool(v) { return v === 'true' || v === '1'; }

/**
 * Pre-flight check: do we actually have read access to sys_db_object?
 * If this returns 0 rows, the script is almost certainly running in a
 * scoped app context that blocks reads on global metadata tables.
 */
function preflightCheck() {
    var gr = new GlideRecord('sys_db_object');
    gr.setLimit(5);
    gr.query();
    var rowCount = gr.getRowCount();
    var iteratedCount = 0;
    while (gr.next()) iteratedCount++;
    if (rowCount === 0 || iteratedCount === 0) {
        // Only the diagnosis is an error; the diagnostic detail and fix
        // instructions are informational. Splitting them visually (gs.error
        // vs gs.info) helps the user skim — one red line, then guidance.
        gs.error('PREFLIGHT FAILED: sys_db_object returned 0 rows. This is almost certainly a scope-access issue.');
        gs.info('  Current user:  ' + gs.getUserName() + '  (sys_id ' + gs.getUserID() + ')');
        gs.info('  Current scope: ' + (gs.getCurrentApplicationId ? gs.getCurrentApplicationId() : 'unknown'));
        gs.info('  User roles:    ' + gs.getUser().getRoles());
        gs.info('FIX OPTIONS:');
        gs.info('  1. Switch the app selector (top-right) to "Global" before running this script.');
        gs.info('  2. Or run from a user with the "admin" role.');
        gs.info('  3. Or grant your scope cross-scope read access to sys_db_object, sys_dictionary,');
        gs.info('     sys_m2m, sys_db_view, sys_db_view_table, sys_relationship, sys_glide_object.');
        return false;
    }
    gs.info('PREFLIGHT OK: sys_db_object accessible (sample of ' + iteratedCount + ' rows iterated, total reachable: ' + rowCount + ').');
    return true;
}

function fetchSysDbObject() {
    var out = [];
    var gr = new GlideRecord('sys_db_object');
    // (No setLimit — default is unbounded. setLimit(0) actually means "return 0 rows".)
    gr.query();
    while (gr.next()) {
        out.push({
            sys_id:         gr.getUniqueValue(),
            name:           gr.getValue('name'),
            label:          gr.getValue('label'),
            super_class:    readRef(gr, 'super_class', 'name'),
            sys_scope:      readRef(gr, 'sys_scope', null), // we only need displayValue
            is_extendable:  parseBool(gr.getValue('is_extendable')),
            access:         gr.getValue('access'),
            // ws_access: true = table reachable via Table API / REST; false = blocked.
            // Defaults to true when the field is absent (older instances, or plain null).
            ws_access:      gr.getValue('ws_access') !== '0' && gr.getValue('ws_access') !== 'false',
            scriptable_table: parseBool(gr.getValue('scriptable_table'))
        });
    }
    return out;
}

function fetchSysDictionary() {
    var out = [];
    var gr = new GlideRecord('sys_dictionary');
    // (No setLimit — default is unbounded. setLimit(0) actually means "return 0 rows".)
    // Only active rows. Empty `element` rows are kept here because the builder
    // skips them itself — keeping them keeps this fetcher source-agnostic.
    gr.addQuery('active', true);
    gr.query();
    while (gr.next()) {
        var element = gr.getValue('element');
        // Cheap optimization: skip table-level rows here (saves ~7k rows of
        // wire/parse cost). Builder skips them too but skipping in the
        // fetcher reduces payload size dramatically.
        if (!element) continue;
        var internalType = gr.getValue('internal_type');
        var internalTypeDisplay = gr.getDisplayValue('internal_type');
        var refValue = gr.getValue('reference');
        var refDisplay = gr.getDisplayValue('reference');
        var refName = '';
        if (refValue) {
            // reference column on sys_dictionary stores sys_id of a sys_db_object;
            // we need its .name. Use getRefRecord pattern.
            try {
                var refGr = gr.getElement('reference').getRefRecord();
                if (refGr && refGr.isValidRecord()) refName = String(refGr.getValue('name') || '');
            } catch (e) { /* ignore */ }
        }
        out.push({
            sys_id:        gr.getUniqueValue(),
            name:          gr.getValue('name'),
            element:       element,
            column_label:  gr.getValue('column_label'),
            internal_type: { value: internalType || 'string', displayValue: internalTypeDisplay || internalType || 'string' },
            reference:     refValue ? { value: refValue, displayValue: refDisplay || '', name: refName } : null,
            max_length:    gr.getValue('max_length'),
            mandatory:     parseBool(gr.getValue('mandatory')),
            primary:       parseBool(gr.getValue('primary')),
            virtual:       parseBool(gr.getValue('virtual')),
            active:        parseBool(gr.getValue('active'))
        });
    }
    return out;
}

function fetchSysM2m() {
    var out = [];
    var gr = new GlideRecord('sys_m2m');
    // (No setLimit — default is unbounded. setLimit(0) actually means "return 0 rows".)
    gr.query();
    while (gr.next()) {
        out.push({
            sys_id:          gr.getUniqueValue(),
            from_table:      gr.getValue('from_table'),
            to_table:        gr.getValue('to_table'),
            m2m_table:       gr.getValue('m2m_table'),
            m2m_from_field:  gr.getValue('m2m_from_field'),
            m2m_to_field:    gr.getValue('m2m_to_field'),
            m2m_from_label:  gr.getValue('m2m_from_label'),
            m2m_to_label:    gr.getValue('m2m_to_label')
        });
    }
    return out;
}

function fetchSysDbView() {
    var out = [];
    var gr = new GlideRecord('sys_db_view');
    // (No setLimit — default is unbounded. setLimit(0) actually means "return 0 rows".)
    gr.query();
    while (gr.next()) {
        out.push({
            sys_id:       gr.getUniqueValue(),
            name:         gr.getValue('name'),
            label:        gr.getValue('label'),
            description:  gr.getValue('description'),
            plural:       gr.getValue('plural')
        });
    }
    return out;
}

function fetchSysDbViewTable() {
    var out = [];
    var gr = new GlideRecord('sys_db_view_table');
    // (No setLimit — default is unbounded. setLimit(0) actually means "return 0 rows".)
    gr.query();
    while (gr.next()) {
        // The `view` field points to a sys_db_view row by sys_id. We need the
        // view's `name` for the join. Same getRefRecord pattern.
        var viewName = '';
        try {
            var refGr = gr.getElement('view').getRefRecord();
            if (refGr && refGr.isValidRecord()) viewName = String(refGr.getValue('name') || '');
        } catch (e) {}
        out.push({
            sys_id:          gr.getUniqueValue(),
            view:            { displayValue: viewName, name: viewName, value: gr.getValue('view') },
            table:           gr.getValue('table'),
            order:           gr.getValue('order'),
            left_join:       parseBool(gr.getValue('left_join')),
            where_clause:    gr.getValue('where_clause'),
            variable_prefix: gr.getValue('variable_prefix'),
            active:          parseBool(gr.getValue('active'))
        });
    }
    return out;
}

function fetchSysRelationship() {
    var out = [];
    var gr = new GlideRecord('sys_relationship');
    // (No setLimit — default is unbounded. setLimit(0) actually means "return 0 rows".)
    gr.query();
    while (gr.next()) {
        out.push({
            sys_id:            gr.getUniqueValue(),
            name:              gr.getValue('name'),
            query_from:        gr.getValue('query_from'),
            query_with:        gr.getValue('query_with'),
            apply_to:          gr.getValue('apply_to'),
            basic_query_from:  gr.getValue('basic_query_from'),
            basic_apply_to:    gr.getValue('basic_apply_to'),
            advanced:          parseBool(gr.getValue('advanced'))
        });
    }
    return out;
}

function fetchSysGlideObject() {
    var out = [];
    var gr = new GlideRecord('sys_glide_object');
    // (No setLimit — default is unbounded. setLimit(0) actually means "return 0 rows".)
    gr.query();
    while (gr.next()) {
        out.push({
            sys_id:        gr.getUniqueValue(),
            name:          gr.getValue('name'),
            label:         gr.getValue('label'),
            scalar_type:   gr.getValue('scalar_type'),
            scalar_length: gr.getValue('scalar_length'),
            class_name:    gr.getValue('class_name'),
            visible:       parseBool(gr.getValue('visible')),
            attributes:    gr.getValue('attributes')
        });
    }
    return out;
}

/**
 * Builds a sys_id → "parent_descriptor::child_descriptor" map from cmdb_rel_type.
 * Used by fetchCmdbRelTypeSuggest() to produce a consistent rel_type_display value.
 *
 * IMPORTANT: gr.getDisplayValue('cmdb_rel_type') on a cmdb_rel_type_suggest row
 * returns a CONTEXT-SENSITIVE value — it produces different strings for the two
 * mirror rows of the same logical relationship (parent=true vs parent=false), even
 * though both reference the same cmdb_rel_type record. This prevents SchemaBuilder
 * from deduplicating mirror pairs and inflates the CI topology count (~2×).
 *
 * Reading parent_descriptor and child_descriptor directly from cmdb_rel_type gives
 * a stable, context-independent label that is identical for both mirror rows, so
 * SchemaBuilder's dedup correctly collapses them to one canonical entry.
 */
function fetchCmdbRelTypeMap() {
    var map = {};
    var count = 0;
    try {
        var gr = new GlideRecord('cmdb_rel_type');
        gr.query();
        while (gr.next()) {
            var id = gr.getUniqueValue();
            var pd = gr.getValue('parent_descriptor') || '';
            var cd = gr.getValue('child_descriptor')  || '';
            if (id && pd) { map[id] = pd + (cd ? '::' + cd : ''); count++; }
        }
        gs.info('  cmdb_rel_type map: ' + count + ' of ' + Object.keys(map).length + ' records mapped (total rows iterated)');
    } catch (e) {
        gs.info('  cmdb_rel_type not accessible — falling back to getDisplayValue: ' + e.message);
    }
    return map;
}

/**
 * Class-level "suggested relationships" catalog used by ServiceNow's
 * CMDB / Service Mapping / Discovery features. Each row defines a
 * permitted runtime relationship between two CI classes — e.g.
 * "Computer Hosts Application", "Cluster has Members of type Computer".
 *
 * Schema-adjacent metadata (not instance data) — small (~hundreds of
 * rows) and safe to ship unconditionally. The viewer renders these as
 * class-to-class topology in the CI-context view AND as an optional
 * 'cmdb_rel' edge type in the schema-wide views.
 *
 * If the table doesn't exist (older instance) or returns zero rows,
 * we silently return [] — the downstream consumer treats it as absent.
 */
function fetchCmdbRelTypeSuggest() {
    var out = [];
    var relTypeMap = fetchCmdbRelTypeMap();
    var gr = new GlideRecord('cmdb_rel_type_suggest');
    // initialize() first so we can detect whether the table is even reachable
    // (in some scoped contexts the GlideRecord constructor succeeds but the
    // query yields zero rows due to scope restrictions).
    try {
        gr.initialize();
    } catch (e) {
        gs.info('  cmdb_rel_type_suggest not accessible: ' + e.message);
        return out;
    }
    gr.query();
    var mapHits = 0, fallbackUsed = 0;
    while (gr.next()) {
        var cmdbRelTypeId = gr.getValue('cmdb_rel_type');
        // Prefer the stable descriptor-based label from the map; fall back to
        // getDisplayValue only if the record wasn't in our pre-fetched map.
        var mapped = cmdbRelTypeId && relTypeMap[cmdbRelTypeId];
        if (mapped) { mapHits++; } else { fallbackUsed++; }
        var relTypeDisplay = mapped || gr.getDisplayValue('cmdb_rel_type');
        if (!relTypeDisplay) continue;
        out.push({
            base_class:        gr.getValue('base_class'),
            dependent_class:   gr.getValue('dependent_class'),
            parent:            parseBool(gr.getValue('parent')),
            rel_type_display:  relTypeDisplay
        });
    }
    gs.info('  cmdb_rel_type_suggest: ' + out.length + ' rows (' + mapHits + ' via map, ' + fallbackUsed + ' via getDisplayValue fallback)');
    return out;
}

/**
 * Per-table record counts via GlideAggregate. Expensive — one query per table.
 * Honours the include/exclude regex lists in CONFIG.
 *
 * Returns: { counts: {table:int|null}, failures: {table:{category,message}},
 *           elapsedMs: int }
 *
 * Failure categories:
 *   • acl          — cross-scope read denied (most common; expected on scoped apps)
 *   • unsupported  — virtual table refuses aggregate queries
 *   • script_error — virtual table's own script threw (RhinoEcmaError etc.)
 *   • other        — anything we couldn't classify
 *
 * IMPORTANT: failing counts are recorded as null in `counts`, NOT as 0.
 * A table that exists but errored during counting is meaningfully different
 * from a table that returned a count of 0. The downstream SchemaBuilder
 * omits the field when null so the viewer can render "unavailable" instead
 * of misleadingly showing "0 records".
 */
function fetchRecordCounts(tableNames) {
    var counts   = {};
    var failures = {};
    var include  = (CONFIG.recordCountInclude || []).map(function (p) { return new RegExp(p); });
    var exclude  = (CONFIG.recordCountExclude || []).map(function (p) { return new RegExp(p); });
    function shouldCount(name) {
        for (var i = 0; i < exclude.length; i++) if (exclude[i].test(name)) return false;
        if (!include.length) return true;
        for (var j = 0; j < include.length; j++) if (include[j].test(name)) return true;
        return false;
    }
    // Classify a thrown error into one of our buckets so the end-of-run
    // summary can group similar failures together. ServiceNow doesn't give
    // us structured error codes, so we string-sniff the message.
    function classify(err) {
        var msg = String((err && err.message) || err || '').toLowerCase();
        if (msg.indexOf('security restricted') !== -1 ||
            msg.indexOf('access') !== -1 && msg.indexOf('denied') !== -1 ||
            msg.indexOf('source descriptor is empty') !== -1 ||
            msg.indexOf('restricted caller access') !== -1) return 'acl';
        if (msg.indexOf('does not support aggregate') !== -1) return 'unsupported';
        if (msg.indexOf('rhinoecma') !== -1 ||
            msg.indexOf('undefined value has no properties') !== -1 ||
            msg.indexOf('typeerror') !== -1 ||
            msg.indexOf('referenceerror') !== -1) return 'script_error';
        return 'other';
    }
    var t0 = (new Date()).getTime();
    var lastLogged = -1;
    var total = tableNames.length;
    for (var i = 0; i < total; i++) {
        var name = tableNames[i];
        if (!shouldCount(name)) continue;
        try {
            var ga = new GlideAggregate(name);
            ga.addAggregate('COUNT');
            ga.query();
            if (ga.next()) {
                counts[name] = parseInt(ga.getAggregate('COUNT'), 10) || 0;
            } else {
                // Query ran but returned no aggregate row — treat as zero,
                // since this is a legitimately empty result, not a failure.
                counts[name] = 0;
            }
        } catch (e) {
            // Record the failure with its category so we can summarise at the
            // end. We deliberately do NOT set counts[name] = 0 here — null
            // signals "we tried and couldn't tell", which is different from
            // zero records.
            counts[name] = null;
            failures[name] = {
                category: classify(e),
                message:  String((e && e.message) || e || 'unknown error').substring(0, 200)
            };
        }
        // Progress logging with ETA. Every 500 rows on the slow step is enough
        // signal; more frequent than that just spams the log.
        if (i % 500 === 0 && i !== lastLogged) {
            lastLogged = i;
            var elapsed = ((new Date()).getTime() - t0) / 1000;
            if (i > 0 && elapsed > 1) {
                var rate = i / elapsed;
                var remaining = (total - i) / rate;
                gs.info('[record-counts] ' + i + ' / ' + total +
                        '  (' + rate.toFixed(0) + ' tables/s, ETA ' + Math.round(remaining) + 's)');
            } else {
                gs.info('[record-counts] ' + i + ' / ' + total);
            }
        }
    }
    return {
        counts:    counts,
        failures:  failures,
        elapsedMs: (new Date()).getTime() - t0
    };
}

// ───────────────────────────────────────────────────────────────────────────
// Instance metadata
// ───────────────────────────────────────────────────────────────────────────
function gatherInstanceInfo() {
    function prop(key) { return gs.getProperty(key) || null; }
    function safeAggregate(table, queryFn) {
        try {
            var ga = new GlideAggregate(table);
            if (queryFn) queryFn(ga);
            ga.addAggregate('COUNT');
            ga.query();
            return ga.next() ? parseInt(ga.getAggregate('COUNT'), 10) || 0 : 0;
        } catch (e) { return null; }
    }
    return {
        instance_name:    prop('instance_name'),
        instance_url:     gs.getProperty('glide.servlet.uri') || null,
        build_name:       prop('glide.buildname'),
        build_tag:        prop('glide.buildtag'),
        build_date:       prop('glide.builddate'),
        node_count:       safeAggregate('sys_cluster_state'),
        // v_plugin.active is a string column: active plugins carry the value 'active', not true
        active_plugins:   safeAggregate('v_plugin',    function (ga) { ga.addQuery('active', 'active'); }),
        // sys_package.active is a proper boolean (active apps/packages installed on the instance)
        active_packages:  safeAggregate('sys_package', function (ga) { ga.addQuery('active', true); }),
        active_languages: safeAggregate('sys_language', function (ga) { ga.addQuery('active', true); }),
        exported_at:      new GlideDateTime().toString(),
        exported_by:      gs.getUserName(),
        export_mode:      'background-script'
    };
}

// ───────────────────────────────────────────────────────────────────────────
// EMBEDDED SCHEMA BUILDER (kept inline so this file is self-contained for
// drop-in Background Script use. Identical to /shared/schema-builder.js.)
// ───────────────────────────────────────────────────────────────────────────
//<SCHEMA_BUILDER>
// vvvvv Paste contents of /shared/schema-builder.js between these markers vvvvv
// ^^^^^ (replaces this section in the final build) ^^^^^
//</SCHEMA_BUILDER>

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
        e   = edges[i];
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
            type:   'cmdb_rel',
            source: r.source || r.baseClass      || '',
            target: r.target || r.dependentClass || '',
            label:  r.label  || r.relTypeDisplay || ''
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
    'string': 'String', 'integer': 'Integer', 'float': 'Decimal',
    'currency': 'Currency', 'currency2': 'Currency (v2)',
    'boolean': 'Boolean',
    'glide_date_time': 'Date/Time', 'glide_date': 'Date',
    'glide_duration': 'Duration', 'glide_time': 'Time',
    'reference': 'Reference', 'list': 'List', 'glide_list': 'List',
    'url': 'URL', 'email': 'Email', 'phone_number': 'Phone',
    'html': 'HTML', 'script': 'Script', 'script_plain': 'Script (Plain)',
    'conditions': 'Condition', 'translated_text': 'Translated Text',
    'choice': 'Choice', 'GUID': 'GUID',
    'sys_class_name': 'Table Name', 'domain_id': 'Domain',
    'journal_input': 'Journal Input', 'journal_list': 'Journal List',
    'workflow': 'Workflow', 'document_id': 'Document ID',
    'password2': 'Password', 'composite_field': 'Composite Field'
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
    var adj   = bgBuildAdj(schema);
    var nodes = schema.nodes || [];
    var inst  = schema._instance || {};

    var lines = [];

    // ── Preamble ──
    lines.push('# ServiceNow Schema Export');
    lines.push('');
    if (inst.instance_name) lines.push('**Instance:** ' + inst.instance_name);
    if (inst.exported_at)   lines.push('**Exported:** ' + inst.exported_at);
    var scopeSet = {}, si;
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
        var n    = nodes[ni];
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
                var f    = fields[fi];
                var fNm  = f.name || f.element || '';
                var fTy  = bgTypeLabel(f.type || '');
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
                refIns.push(sRefIn + '.' + (eRefIn.field || '') +
                             ' (' + (eRefIn.label || eRefIn.field || sRefIn) + ')');
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
                var sM = bgNid(eM.source), tM = bgNid(eM.target);
                var kM = 'm\0' + (sM < tM ? sM + '\0' + tM : tM + '\0' + sM);
                if (seen[kM]) continue;
                seen[kM] = true;
                var otherM = (sM === n.id) ? tM : sM;
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
                var sRl = bgNid(eRl.source), tRl = bgNid(eRl.target);
                var kRl = 'rl\0' + sRl + '\0' + tRl;
                if (seen[kRl]) continue;
                seen[kRl] = true;
                var otherRl = (sRl === n.id) ? tRl : sRl;
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
                var sVw = bgNid(eVw.source), tVw = bgNid(eVw.target);
                var kVw = 'vw\0' + (sVw < tVw ? sVw + '\0' + tVw : tVw + '\0' + sVw);
                if (seen[kVw]) continue;
                seen[kVw] = true;
                views.push((sVw === n.id) ? tVw : sVw);
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
                var sCi = bgNid(eCi.source), tCi = bgNid(eCi.target);
                var kCi = 'ci\0' + (sCi < tCi ? sCi + '\0' + tCi : tCi + '\0' + sCi);
                if (seen[kCi]) continue;
                seen[kCi] = true;
                var otherCi = (sCi === n.id) ? tCi : sCi;
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
    'string':          'xsd:string',
    'integer':         'xsd:integer',
    'float':           'xsd:decimal',
    'currency':        'xsd:decimal',
    'currency2':       'xsd:decimal',
    'boolean':         'xsd:boolean',
    'glide_date_time': 'xsd:dateTime',
    'glide_date':      'xsd:date',
    'glide_duration':  'xsd:duration',
    'glide_time':      'xsd:time',
    'url':             'xsd:anyURI',
    'email':           'xsd:string',
    'html':            'xsd:string',
    'script':          'xsd:string',
    'script_plain':    'xsd:string',
    'conditions':      'xsd:string',
    'GUID':            'xsd:string',
    'choice':          'xsd:string',
    'sys_class_name':  'xsd:string',
    'domain_id':       'xsd:string',
    'journal_input':   'xsd:string',
    'journal_list':    'xsd:string',
    'workflow':        'xsd:string',
    'document_id':     'xsd:string',
    'password2':       'xsd:string'
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
    var adj   = bgBuildAdj(schema);
    var nodes = schema.nodes || [];
    var inst  = schema._instance || {};
    var graph = [];

    var ni, fi, ei2;
    for (ni = 0; ni < nodes.length; ni++) {
        var n    = nodes[ni];
        var nAdj = adj[n.id] || { out: [], inb: [] };
        var seen = {};
        var obj  = {};

        obj['@id']       = 'snp:' + n.id;
        obj['@type']     = 'owl:Class';
        obj['rdfs:label'] = n.label || n.id;
        if (n.scope)          obj['sn:scope']        = n.scope;
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
                var fld  = fields[fi];
                var fNm  = fld.name || fld.element || '';
                if (!fNm) continue;
                var fTy  = fld.type || 'string';
                var fObj = {};
                fObj['@id']       = 'sn:' + n.id + '_' + fNm;
                fObj['rdfs:label'] = fld.label || fNm;
                if (fTy === 'reference' && fld.reference) {
                    fObj['@type']      = 'owl:ObjectProperty';
                    fObj['rdfs:range'] = { '@id': 'snp:' + fld.reference };
                } else {
                    fObj['@type']      = 'owl:DatatypeProperty';
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
                if (eRo.field)  roObj['sn:field']   = eRo.field;
                if (eRo.label)  roObj['rdfs:label']  = eRo.label;
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
                var sM = bgNid(eM.source), tM = bgNid(eM.target);
                var kM = 'm\0' + (sM < tM ? sM + '\0' + tM : tM + '\0' + sM);
                if (seen[kM]) continue;
                seen[kM] = true;
                var otherM = (sM === n.id) ? tM : sM;
                var mObj = { '@id': 'snp:' + otherM };
                if (eM.label)        mObj['rdfs:label']      = eM.label;
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
                var sRl = bgNid(eRl.source), tRl = bgNid(eRl.target);
                var kRl = 'rl\0' + sRl + '\0' + tRl;
                if (seen[kRl]) continue;
                seen[kRl] = true;
                var otherRl = (sRl === n.id) ? tRl : sRl;
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
                var sVw = bgNid(eVw.source), tVw = bgNid(eVw.target);
                var kVw = 'vw\0' + (sVw < tVw ? sVw + '\0' + tVw : tVw + '\0' + sVw);
                if (seen[kVw]) continue;
                seen[kVw] = true;
                var otherVw = (sVw === n.id) ? tVw : sVw;
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
                var sCi = bgNid(eCi.source), tCi = bgNid(eCi.target);
                var kCi = 'ci\0' + (sCi < tCi ? sCi + '\0' + tCi : tCi + '\0' + sCi);
                if (seen[kCi]) continue;
                seen[kCi] = true;
                var otherCi = (sCi === n.id) ? tCi : sCi;
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
            'owl':  'http://www.w3.org/2002/07/owl#',
            'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
            'xsd':  'http://www.w3.org/2001/XMLSchema#',
            'sn':   'https://servicenow.com/schema#',
            'snp':  'https://servicenow.com/table/'
        },
        '@graph': graph
    };

    if (inst.instance_name) doc['sn:instanceName'] = inst.instance_name;
    if (inst.exported_at)   doc['sn:exportedAt']   = inst.exported_at;

    return JSON.stringify(doc, null, 2);
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────────────────────────────
(function main() {
    var t0 = Date.now();
    gs.info('=== Schema export started ===');
    gs.info('User: ' + gs.getUserName() + '  | Current scope: ' + (gs.getCurrentApplicationId ? gs.getCurrentApplicationId() : '(unknown)'));

    if (!preflightCheck()) {
        gs.error('Aborting export — see PREFLIGHT FAILED messages above for fix options.');
        return;
    }

    // Gather instance metadata up front so we can log it. The user often runs
    // this script with several tabs open across different instances; echoing
    // identity confirms which one they're actually pointed at.
    var instance = gatherInstanceInfo();
    var instanceLabel = (instance.instance_name || '?') +
                       (instance.build_name ? ' · ' + instance.build_name : '') +
                       (instance.build_tag  ? ' · build ' + instance.build_tag : '');
    gs.info('Instance: ' + instanceLabel);

    gs.info('[1/9] Fetching sys_db_object...');
    var sysDbObject = fetchSysDbObject();
    gs.info('  rows: ' + sysDbObject.length);

    gs.info('[2/9] Fetching sys_dictionary (active, with element)...');
    var sysDictionary = fetchSysDictionary();
    gs.info('  rows: ' + sysDictionary.length);

    gs.info('[3/9] Fetching sys_m2m...');
    var sysM2m = fetchSysM2m();
    gs.info('  rows: ' + sysM2m.length);

    gs.info('[4/9] Fetching sys_db_view...');
    var sysDbView = fetchSysDbView();
    gs.info('  rows: ' + sysDbView.length);

    gs.info('[5/9] Fetching sys_db_view_table...');
    var sysDbViewTable = fetchSysDbViewTable();
    gs.info('  rows: ' + sysDbViewTable.length);

    gs.info('[6/9] Fetching sys_relationship...');
    var sysRelationship = fetchSysRelationship();
    gs.info('  rows: ' + sysRelationship.length);

    gs.info('[7/9] Fetching sys_glide_object...');
    var sysGlideObject = fetchSysGlideObject();
    gs.info('  rows: ' + sysGlideObject.length);

    gs.info('[8/9] Fetching cmdb_rel_type_suggest (CI topology metadata)...');
    var cmdbRelTypeSuggest = fetchCmdbRelTypeSuggest();
    gs.info('  rows: ' + cmdbRelTypeSuggest.length);

    var recordCounts = null;
    var recordCountFailures = null;
    if (CONFIG.includeRecordCounts) {
        gs.info('[9/9] Collecting per-table record counts (this is the slow step)...');
        var tableNames = sysDbObject.map(function (t) { return t.name; }).filter(Boolean);
        var rcResult = fetchRecordCounts(tableNames);
        recordCounts        = rcResult.counts;
        recordCountFailures = rcResult.failures;
        // Tally successes vs failures for the user-visible summary.
        var succeeded = 0, failed = 0;
        for (var rcK in recordCounts) {
            if (!Object.prototype.hasOwnProperty.call(recordCounts, rcK)) continue;
            if (recordCounts[rcK] === null) failed++; else succeeded++;
        }
        gs.info('  record counts collected: ' + succeeded + ' tables in ' +
                (rcResult.elapsedMs / 1000).toFixed(1) + 's' +
                (failed > 0 ? '  (' + failed + ' tables could not be counted — see access notes below)' : ''));
    } else {
        // Deliberately not numbered "[9/9]" — when record counts are off,
        // there are only 8 actual steps. Numbering a skipped step is dishonest.
        gs.info('Skipping per-table record counts (not requested).');
    }

    // ── Format validation / non-JSON early exit ───────────────────────────────
    if (CONFIG.format === 'owl' || CONFIG.format === 'openapi') {
        gs.error('FORMAT NOT SUPPORTED: "' + CONFIG.format + '" cannot be generated in this Background Script.');
        gs.error('The OWL/Turtle and OpenAPI serialisers require modern JavaScript (ES6+) which is not available');
        gs.error('in the ServiceNow Rhino engine. To get this format:');
        gs.error('  1. Run this script with CONFIG.format = "json"  (the default)');
        gs.error('  2. Load the resulting JSON in the SN Schema Explorer viewer');
        gs.error('  3. Click Export → ↓ OWL/Turtle  or  ↓ OpenAPI');
        gs.error('  Alternatively: use the Node.js extractor with --format=' + CONFIG.format);
        return;
    }

    if (CONFIG.format === 'markdown' || CONFIG.format === 'jsonld') {
        gs.info('Building full schema object for ' + CONFIG.format + ' serialisation...');
        gs.info('(For very large instances (>25 MB JSON) this may time out. If it does,');
        gs.info(' switch to format="json" and convert in the viewer instead.)');
        var fmtInput = {
            sysDbObject:    sysDbObject,  sysDictionary:  sysDictionary,
            sysM2m:         sysM2m,       sysDbView:      sysDbView,
            sysDbViewTable: sysDbViewTable, sysRelationship: sysRelationship,
            sysGlideObject: sysGlideObject, cmdbRelTypeSuggest: cmdbRelTypeSuggest,
            recordCounts:   recordCounts, recordCountFailures: recordCountFailures,
            instance:       instance
        };
        var fmtSchema = SchemaBuilder.build(fmtInput);
        var fmtContent = CONFIG.format === 'markdown'
            ? serializeMarkdownBg(fmtSchema)
            : serializeJsonLdBg(fmtSchema);
        var fmtElapsed = (Date.now() - t0) / 1000;
        gs.info('─────────────────────────────────────────────');
        gs.info('Built ' + CONFIG.format + ' in ' + fmtElapsed.toFixed(1) + 's · ' +
                fmtContent.length + ' chars · ' +
                fmtSchema._stats.counts.tables + ' tables, ' + fmtSchema._stats.counts.fields + ' fields');
        gs.info('─────────────────────────────────────────────');
        var fmtTarget = new GlideRecord(CONFIG.attachmentTargetTable);
        fmtTarget.get(CONFIG.attachmentTargetSysId);
        if (!fmtTarget.isValidRecord()) {
            gs.error('Attachment target not found: ' + CONFIG.attachmentTargetTable + '/' + CONFIG.attachmentTargetSysId);
            return;
        }
        var fmtAttachment = new GlideSysAttachment();
        var fmtExt = CONFIG.format === 'markdown' ? '.md' : '.jsonld';
        var fmtFileName = CONFIG.attachmentFileName.replace(/\.json$/, fmtExt);
        var fmtSysId = fmtAttachment.write(fmtTarget, fmtFileName, 'text/plain', fmtContent);
        if (fmtSysId) {
            var fmtBase = gs.getProperty('glide.servlet.uri') || '';
            gs.info('=== EXPORT COMPLETE (' + CONFIG.format.toUpperCase() + ') ===');
            gs.info('Attachment sys_id: ' + fmtSysId);
            gs.info('Download URL: ' + fmtBase + 'sys_attachment.do?sys_id=' + fmtSysId);
        } else {
            gs.error('Failed to write ' + CONFIG.format + ' attachment.');
        }
        return;
    }

    gs.info('Building schema and accumulating chunks (sandbox-safe, no Java I/O)...');

    // ── Build JSON as a chunk array ────────────────────────────────────────
    // ServiceNow's Rhino sandbox blocks direct Java I/O methods like
    // java.io.OutputStream.write(byte[]), so we can't stream into a
    // ByteArrayOutputStream. Instead we collect chunks into a JS array.
    // The array itself isn't bounded; the 32 MB cap applies to individual
    // String concatenations. Each chunk is small (one node/edge per chunk)
    // so we never trip the cap during the build phase.
    //
    // The cap DOES bite when we eventually `array.join('')` to produce the
    // single string for attachment.write(). If the total size would exceed
    // ~25 MB we fall through to a "split attachments" strategy that writes
    // the schema across N sys_attachment rows, each safely under the cap.
    // A small manifest record points the viewer at the parts so they can
    // be reassembled client-side.
    var STRING_CAP_BYTES = 25 * 1024 * 1024; // safe margin under Rhino's 32 MB

    var chunks = [];
    var totalBytes = 0;
    var summary = SchemaBuilder.buildStreaming({
        sysDbObject:    sysDbObject,
        sysDictionary:  sysDictionary,
        sysM2m:         sysM2m,
        sysDbView:      sysDbView,
        sysDbViewTable: sysDbViewTable,
        sysRelationship:sysRelationship,
        sysGlideObject: sysGlideObject,
        cmdbRelTypeSuggest: cmdbRelTypeSuggest,
        recordCounts:   recordCounts,
        recordCountFailures: recordCountFailures,
        instance:       instance
    }, function (chunk) {
        chunks.push(chunk);
        totalBytes += chunk.length;
    });

    var elapsed = (Date.now() - t0) / 1000;
    // Visually separate the build summary — this is the single most useful
    // sizing-decision line in the whole log.
    gs.info('─────────────────────────────────────────────');
    gs.info('Built schema in ' + elapsed.toFixed(1) + 's · ' +
            (totalBytes / 1048576).toFixed(2) + ' MB · ' +
            chunks.length + ' chunks · ' +
            summary.counts.tables + ' tables, ' +
            summary.counts.fields + ' fields, ' +
            (summary.counts.references + summary.counts.m2m_relationships + summary.counts.named_relationships) + ' relationships');
    gs.info('Counts: ' + JSON.stringify(summary.counts));
    gs.info('─────────────────────────────────────────────');

    // ── Resolve attachment target record ───────────────────────────────────
    var target = new GlideRecord(CONFIG.attachmentTargetTable);
    target.get(CONFIG.attachmentTargetSysId);
    if (!target.isValidRecord()) {
        gs.error('Attachment target record not found: ' +
                 CONFIG.attachmentTargetTable + '/' + CONFIG.attachmentTargetSysId);
        gs.info('  Configure attachmentTargetTable and attachmentTargetSysId at the top of this script.');
        gs.info('  Default target is the running user record (sys_user / your sys_id).');
        return;
    }

    var attachment = new GlideSysAttachment();

    if (totalBytes <= STRING_CAP_BYTES) {
        // ── Path A: small enough — single attachment ──────────────────────
        // Join the chunks into one string. Each chunk is small; the join is
        // a single sandbox-safe operation. Total stays under the 32 MB cap.
        var json = chunks.join('');
        chunks = null; // free memory before the write
        var attSysId = attachment.write(target, CONFIG.attachmentFileName, 'application/json', json);
        if (attSysId) {
            var base = gs.getProperty('glide.servlet.uri') || '';
            gs.info('=== EXPORT COMPLETE (single attachment) ===');
            gs.info('Attachment sys_id: ' + attSysId);
            gs.info('Download URL: ' + base + 'sys_attachment.do?sys_id=' + attSysId);
        } else {
            gs.error('Failed to write attachment to ' + CONFIG.attachmentTargetTable + '/' +
                     CONFIG.attachmentTargetSysId + ' (' + (json.length / 1048576).toFixed(2) + ' MB).');
            gs.info('  GlideSysAttachment.write returned null/empty — common causes:');
            gs.info('    • Target record was deleted or is locked');
            gs.info('    • Attachment quota exceeded for the instance');
            gs.info('    • ACL denies write on sys_attachment for the running user');
            gs.info('  Inspect the system log around this timestamp for the underlying cause.');
        }
    } else {
        // ── Path B: too large for a single string — split across parts ────
        // Multi-part is a *supported* path, not a degraded one. The viewer
        // auto-stitches when the user drops the manifest + parts together.
        // We mention the Node CLI as an alternative for users who want a
        // single physical file (e.g. for archival or external diffing).
        gs.info('Schema is ' + (totalBytes / 1048576).toFixed(1) + ' MB — using multi-part attachment format ' +
                '(one manifest + N parts). The viewer will auto-stitch on load.');
        gs.info('For a single-file export of this size, consider the Node.js CLI (writes one file locally).');

        // Pack chunks into parts. Each part stays well under the string cap.
        var PART_TARGET_BYTES = 20 * 1024 * 1024; // 20 MB per part (very safe)
        var parts = [];          // [ { idx, sysId, fileName, bytes } ]
        var partBuffer = [];
        var partBytes = 0;
        var partIdx = 0;
        var fileBase = CONFIG.attachmentFileName.replace(/\.json$/i, '');

        function flushPart() {
            if (partBytes === 0) return;
            var partJson = partBuffer.join('');
            partBuffer = [];
            var thisBytes = partBytes;
            partBytes = 0;
            var partName = fileBase + '.part' + (partIdx + 1) + '.json';
            var sid = attachment.write(target, partName, 'application/json', partJson);
            parts.push({ idx: partIdx, sysId: String(sid || ''), fileName: partName, bytes: thisBytes });
            partIdx++;
            gs.info('  wrote ' + partName + ' (' + (thisBytes / 1048576).toFixed(2) + ' MB) — sys_id ' + sid);
        }

        for (var ci = 0; ci < chunks.length; ci++) {
            var c = chunks[ci];
            // If adding this chunk would overflow the part, flush first
            if (partBytes + c.length > PART_TARGET_BYTES && partBytes > 0) flushPart();
            partBuffer.push(c);
            partBytes += c.length;
        }
        flushPart();
        chunks = null;

        // Write a small manifest attachment that the viewer can use to
        // discover and reassemble the parts.
        var manifest = {
            _manifest_version: '1.0',
            _schema_version:   1,
            instance:          instance,
            totalBytes:        totalBytes,
            counts:            summary.counts,
            parts:             parts.map(function (p) { return { idx: p.idx, fileName: p.fileName, sysId: p.sysId, bytes: p.bytes }; })
        };
        var manifestName = fileBase + '.manifest.json';
        var manifestSysId = attachment.write(target, manifestName, 'application/json', JSON.stringify(manifest, null, 2));

        var base2 = gs.getProperty('glide.servlet.uri') || '';
        gs.info('=== EXPORT COMPLETE (' + parts.length + ' parts + manifest) ===');
        gs.info('Manifest sys_id: ' + manifestSysId);
        gs.info('Manifest URL:    ' + base2 + 'sys_attachment.do?sys_id=' + manifestSysId);
        gs.info('To load in the viewer: download the manifest + all .part*.json files, ' +
                'then drop them together on the viewer\'s file zone — auto-stitch happens client-side.');
        gs.info('For non-viewer use: cat ' + fileBase + '.part1.json ' + fileBase + '.part2.json ... > schema.json');
    }

    // ── Access notes ──────────────────────────────────────────────────────
    // Summarise tables we couldn't read, bucketed by failure category. The
    // raw error stream from ServiceNow is hundreds of lines of red — this
    // condenses it into a single actionable block. Without this, the user
    // can't tell which of those red lines were expected (ACL denials for
    // scoped apps) and which were genuine bugs (vtable scripts erroring).
    if (recordCountFailures) {
        var buckets = { acl: [], unsupported: [], script_error: [], other: [] };
        for (var fName in recordCountFailures) {
            if (!Object.prototype.hasOwnProperty.call(recordCountFailures, fName)) continue;
            var cat = recordCountFailures[fName].category;
            if (!buckets[cat]) cat = 'other';
            buckets[cat].push(fName);
        }
        var totalFailed = buckets.acl.length + buckets.unsupported.length +
                          buckets.script_error.length + buckets.other.length;
        if (totalFailed > 0) {
            gs.info('─────────────────────────────────────────────');
            gs.info('Access notes — ' + totalFailed + ' tables could not be counted:');
            // Helper to print a bucket compactly. Long lists are truncated
            // (full list is in _capabilities anyway).
            function printBucket(label, names, hint) {
                if (!names.length) return;
                var preview = names.slice(0, 8).join(', ');
                var more = names.length > 8 ? ' … and ' + (names.length - 8) + ' more' : '';
                gs.info('  ' + label + ' (' + names.length + '):  ' + preview + more);
                if (hint) gs.info('    → ' + hint);
            }
            printBucket('cross-scope ACL denials', buckets.acl,
                'Expected for scoped apps. To count these: run the script from each owning scope, ' +
                'or grant Global cross-scope read access on the affected tables.');
            printBucket('aggregate not supported', buckets.unsupported,
                'These are virtual tables that refuse COUNT queries. There is no workaround — ' +
                'their row count is unknowable via GlideAggregate.');
            printBucket('script errors in vtable handlers', buckets.script_error,
                'A third-party vtable handler threw an exception during COUNT. ' +
                'These are bugs in the plugin owning the table, not in this script.');
            printBucket('other / unclassified', buckets.other,
                'See the system log around this timestamp for the underlying exception.');
            gs.info('The full failure list is also captured in _capabilities.recordCounts in the schema JSON.');
            gs.info('─────────────────────────────────────────────');
        }
    }

    if (CONFIG.printToScriptOutput) {
        // For diagnostic use only — runs a second pass, chunked to gs.print's cap.
        gs.info('--- begin JSON (chunked to gs.print) ---');
        SchemaBuilder.buildStreaming({
            sysDbObject:    sysDbObject,  sysDictionary:  sysDictionary,
            sysM2m:         sysM2m,       sysDbView:      sysDbView,
            sysDbViewTable: sysDbViewTable, sysRelationship: sysRelationship,
            sysGlideObject: sysGlideObject, recordCounts:  recordCounts,
            cmdbRelTypeSuggest: cmdbRelTypeSuggest,
            recordCountFailures: recordCountFailures,
            instance:       instance
        }, function (chunk) {
            var CAP = 4000;
            for (var i = 0; i < chunk.length; i += CAP) gs.print(chunk.substring(i, i + CAP));
        });
        gs.info('--- end JSON ---');
    }
})();

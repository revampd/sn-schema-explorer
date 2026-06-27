#!/usr/bin/env node
/* ============================================================================
 * ServiceNow Schema Exporter — Node.js Extractor
 * ============================================================================
 *
 * Pulls the seven schema-source tables from a ServiceNow instance via the
 * standard Table API (Basic auth or API key) and feeds them through SchemaBuilder to
 * produce viewer-ready JSON (or an alternative ML-friendly format).
 *
 * Usage:
 *   node sn-schema-export.node.js \
 *     --instance=https://your-instance.service-now.com \
 *     --user=admin --password=***             (Basic Auth)
 *     --apikey=<sn_api_key>                   (API key — alternative to user/password)
 *     --output=schema.json \
 *     [--format=json|markdown|jsonld|owl|openapi]  (default: json)
 *     [--edge-types=reference,extends,m2m,rel,view,cmdb_rel]  (default: all six)
 *     [--include-record-counts] \
 *     [--metadata=plugins,storeApps,customApps,properties]  (opt-in; JSON only)
 *     [--include-property-values]  (sys_properties values — OFF by default, denylist-redacted)
 *     [--property-query=<encoded query>]  (narrow which sys_properties rows export)
 *     [--page-size=N] \
 *     [--pretty] [--verbose]
 *
 * Environment variable alternatives:
 *   SN_INSTANCE, SN_USER, SN_PASSWORD, SN_APIKEY, SN_OUTPUT, SN_PAGE_SIZE,
 *   SN_FORMAT, SN_EDGE_TYPES, SN_METADATA, SN_PROPERTY_QUERY
 *
 * Performance
 * -----------
 *   Paginates with sysparm_limit=1000 (default; override with --page-size or
 *   SN_PAGE_SIZE) and parallelises the eight table fetches.
 *   On a typical instance: 60-120 seconds.
 * ============================================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const SchemaBuilder = require('../shared/schema-builder.js');
const Serialisers = require('./serialisers.js');

// ─── CLI parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv);

// Classify a failed record-count request into one of four buckets, used for the
// end-of-run access-notes summary. Pure function — exported for unit tests.
function classifyCountError(errMsgRaw, status) {
  const msg = String(errMsgRaw || '').toLowerCase();
  if (status === 401 || status === 403) return 'acl';
  if (
    msg.includes('security restricted') ||
    msg.includes('access denied') ||
    msg.includes('source descriptor is empty') ||
    msg.includes('restricted caller access')
  )
    return 'acl';
  if (msg.includes('does not support aggregate')) return 'unsupported';
  if (
    msg.includes('rhinoecma') ||
    msg.includes('undefined value has no properties') ||
    msg.includes('typeerror') ||
    msg.includes('referenceerror')
  )
    return 'script_error';
  return 'other';
}

const ALL_EDGE_TYPES = ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel'];
const VALID_FORMATS = ['json', 'markdown', 'jsonld', 'owl', 'openapi'];
// Opt-in cross-instance metadata sections (see schema-builder.js). Each maps to
// one ServiceNow table fetched only when requested via --metadata / SN_METADATA.
const VALID_METADATA_SECTIONS = ['plugins', 'storeApps', 'customApps', 'properties'];

const config = {
  instance: args.instance || process.env.SN_INSTANCE,
  user: args.user || process.env.SN_USER,
  // Secrets are read from the environment only — never from argv. Command-line
  // arguments leak into shell history and `ps`/process listings.
  password: process.env.SN_PASSWORD,
  apikey: process.env.SN_APIKEY,
  output: args.output || process.env.SN_OUTPUT || null, // default depends on format
  // Keep pages small so each HTTP response stays well under ServiceNow's
  // server-side response-size limit (~5 MB). At ~600 bytes/row for
  // sys_dictionary, 1000 rows ≈ 600 KB — safe on any instance.
  pageSize: parseInt(args['page-size'] || process.env.SN_PAGE_SIZE || '1000', 10),
  format: (args.format || process.env.SN_FORMAT || 'json').toLowerCase(),
  edgeTypes: (args['edge-types'] || process.env.SN_EDGE_TYPES || ALL_EDGE_TYPES.join(','))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  includeRecordCounts: !!args['include-record-counts'],
  // Opt-in metadata sections (comma-separated). Validated in validateCliConfig.
  metadata: (args.metadata || process.env.SN_METADATA || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  // sys_properties values can hold secrets — OFF by default. When on, the shared
  // builder still redacts values whose property name matches its denylist.
  includePropertyValues: !!args['include-property-values'],
  // Optional encoded query to narrow which sys_properties rows are exported.
  propertyQuery: args['property-query'] || process.env.SN_PROPERTY_QUERY || '',
  pretty: !!args.pretty,
  verbose: !!args.verbose,
};

function die(msg, code) {
  console.error('ERROR: ' + msg);
  process.exit(code || 1);
}

// Validate and normalise config from CLI args / env. Pulled into a function so
// the module can be imported (e.g. by unit tests) without exiting the process —
// it only runs when this file is executed directly as a CLI (see bottom).
function validateCliConfig() {
  // Refuse secrets on the command line — they leak into shell history and `ps`.
  if (args.password !== undefined || args.apikey !== undefined) {
    die(
      'Secrets must not be passed as command-line arguments (they leak into\n' +
        '  shell history and process listings). Use environment variables instead:\n' +
        '    SN_PASSWORD=*** (Basic auth)  or  SN_APIKEY=*** (API key auth)'
    );
  }

  if (!config.instance) {
    die('Required: --instance (or SN_INSTANCE env var)');
  }
  if (!config.apikey && (!config.user || !config.password)) {
    die(
      'Required: --apikey (API key auth) or --user + --password (Basic auth)\n' +
        '  Env-var equivalents: SN_APIKEY  or  SN_USER + SN_PASSWORD'
    );
  }
  if (!VALID_FORMATS.includes(config.format)) {
    die('Unknown --format "' + config.format + '". Valid options: ' + VALID_FORMATS.join(', '));
  }
  // Validate requested metadata sections against the known set.
  const badSections = config.metadata.filter(s => !VALID_METADATA_SECTIONS.includes(s));
  if (badSections.length) {
    die(
      'Unknown --metadata section(s): ' +
        badSections.join(', ') +
        '. Valid options: ' +
        VALID_METADATA_SECTIONS.join(', ')
    );
  }
  // Default output path depends on format
  if (!config.output) {
    const exts = {
      json: '.json',
      markdown: '.md',
      jsonld: '.jsonld',
      owl: '.ttl',
      openapi: '.yaml',
    };
    config.output = 'sn_schema_export' + (exts[config.format] || '.json');
  }
  if (!/^https?:\/\//.test(config.instance)) config.instance = 'https://' + config.instance;
  config.instance = config.instance.replace(/\/+$/, '');
}

// ─── Progress bar (TTY only, no external deps) ────────────────────────────
const Progress = (() => {
  const isTTY = !!process.stdout.isTTY;
  const st = new Map(); // tableName → { n: rows fetched, total: total rows | null }
  let t0 = 0;
  let _len = 0; // character length of the last drawn line (for erasure)

  function clearLine() {
    if (!isTTY || !_len) return;
    process.stdout.write('\r' + ' '.repeat(_len) + '\r');
    _len = 0;
  }

  // Locale-independent thousands separator (avoids "6.660" on European locales)
  function fmtN(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function draw() {
    if (!isTTY) return;
    let sumN = 0,
      sumTotal = 0,
      hasTot = false;
    let bigName = '',
      bigN = 0,
      bigTotal = null,
      bigInProg = false;
    for (const [name, s] of st) {
      sumN += s.n;
      if (s.total != null) {
        sumTotal += s.total;
        hasTot = true;
      }
      // Prefer tables still in progress over completed ones so the label
      // shows the active fetch rather than the largest completed table.
      const inProg = s.total == null || s.n < s.total;
      if (inProg && !bigInProg) {
        bigName = name;
        bigN = s.n;
        bigTotal = s.total;
        bigInProg = true;
      } else if (inProg === bigInProg && s.n >= bigN) {
        bigName = name;
        bigN = s.n;
        bigTotal = s.total;
      }
    }
    const elapsedS = (Date.now() - t0) / 1000;
    const pct = hasTot && sumTotal > 0 ? Math.round((100 * sumN) / sumTotal) : null;
    const rate = elapsedS > 3 ? sumN / elapsedS : 0;
    const eta =
      pct != null && rate > 0 && sumN < sumTotal
        ? '~' + Math.round((sumTotal - sumN) / rate) + 's'
        : '';

    // Stage counter: N/total tables complete
    const totalTables = st.size;
    const doneTables =
      totalTables > 0 ? [...st.values()].filter(s => s.total != null && s.n >= s.total).length : 0;
    const stageS = totalTables > 0 ? doneTables + '/' + totalTables + '  ' : '';

    const W = 25;
    const fill = pct != null ? Math.round((W * Math.min(pct, 100)) / 100) : 0;
    const bar = '█'.repeat(fill) + '░'.repeat(W - fill);
    const pctS = pct != null ? (pct + '%').padStart(4) : '   …';
    const tblS = bigName
      ? '  ' + bigName + ' ' + fmtN(bigN) + (bigTotal != null ? '/' + fmtN(bigTotal) : '')
      : '';
    const etaS = eta ? '  ' + eta : '';

    const line = '  ' + stageS + '[' + bar + '] ' + pctS + tblS + etaS;
    const cols = Math.max(40, (process.stdout.columns || 120) - 1);
    const out = line.length > cols ? line.slice(0, cols) : line;
    process.stdout.write('\r' + out);
    _len = out.length;
  }

  return {
    start: () => {
      t0 = Date.now();
      st.clear();
    },
    // Pre-register a table so it is counted in the N/total denominator from the start.
    // Must be called AFTER start() (which clears the map).
    register: name => {
      if (!st.has(name)) st.set(name, { n: 0, total: null });
    },
    update: (name, n, total) => {
      st.set(name, { n, total: total ?? null });
      draw();
    },
    clearLine: clearLine,
    clear: () => {
      clearLine();
      st.clear();
    },
  };
})();

const log = (...a) => {
  Progress.clearLine();
  console.log('[' + new Date().toISOString() + ']', ...a);
};
const vlog = (...a) => {
  if (config.verbose) log(...a);
};

// Hard ceiling on a single HTTP response. Pages are kept small (see pageSize
// comment, ~600 KB each), so any response approaching this cap signals a
// misbehaving or hostile endpoint — fail fast rather than exhaust the heap.
const MAX_RESPONSE_BYTES = 200 * 1024 * 1024; // 200 MB

// ─── HTTP helper (basic auth, JSON responses) ─────────────────────────────
function httpGet(urlString) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        ...(config.apikey
          ? { 'x-sn-apikey': config.apikey }
          : {
              Authorization:
                'Basic ' + Buffer.from(config.user + ':' + config.password).toString('base64'),
            }),
        Accept: 'application/json',
        'User-Agent': 'sn-schema-exporter/2.0',
      },
    };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(opts, res => {
      const chunks = [];
      let received = 0;
      res.on('data', c => {
        received += c.length;
        if (received > MAX_RESPONSE_BYTES) {
          req.destroy(
            new Error(
              'Response exceeded ' +
                MAX_RESPONSE_BYTES +
                ' bytes on ' +
                urlString +
                ' — aborting. Lower --page-size or check the instance.'
            )
          );
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(
              'HTTP ' +
                res.statusCode +
                ' on ' +
                urlString +
                ': ' +
                body.toString('utf8').slice(0, 500)
            )
          );
        }
        resolve({ body, headers: res.headers });
      });
    });
    req.on('error', reject);
    // Generous timeout — large pages can take a while
    req.setTimeout(300000, () => req.destroy(new Error('Request timeout: ' + urlString)));
    req.end();
  });
}

async function fetchJson(urlString) {
  const { body } = await httpGet(urlString);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch (e) {
    throw new Error('Invalid JSON from ' + urlString + ': ' + e.message);
  }
}

// ─── Instance metadata (Table API + Stats API) ────────────────────────────
async function fetchInstanceInfo() {
  const info = {
    instance_name: (() => {
      try {
        return new URL(config.instance).hostname.split('.')[0];
      } catch (e) {
        return '';
      }
    })(),
    instance_url: config.instance,
    exported_at: new Date().toISOString(),
    exported_by: config.user || null,
    export_mode: 'table-api',
  };

  // Build properties — use the *.last variants which reflect the current build
  // accurately on patched instances. build_name comes from the embedded-help version
  // property (always lowercase, e.g. "vancouver patch 3") — capitalise the first letter.
  try {
    const data = await fetchJson(
      config.instance +
        '/api/now/table/sys_properties' +
        '?sysparm_fields=name,value' +
        '&sysparm_query=nameINcom.glide.embedded_help.version,glide.buildtag.last,glide.builddate.last' +
        '&sysparm_limit=10'
    );
    for (const row of data.result || []) {
      const val =
        row.value && typeof row.value === 'object' ? row.value.value || null : row.value || null;
      const key = row.name && typeof row.name === 'object' ? row.name.value : row.name;
      if (key === 'com.glide.embedded_help.version')
        info.build_name = val ? val.charAt(0).toUpperCase() + val.slice(1) : val;
      if (key === 'glide.buildtag.last') info.build_tag = val;
      if (key === 'glide.builddate.last') info.build_date = val;
    }
  } catch (e) {
    vlog('Could not fetch build properties:', e.message);
  }

  // Aggregate counts — run all four in parallel via Stats API
  async function statsCount(table, query) {
    try {
      const url =
        config.instance +
        '/api/now/stats/' +
        table +
        '?sysparm_count=true' +
        (query ? '&sysparm_query=' + encodeURIComponent(query) : '');
      const data = await fetchJson(url);
      const c = data.result && data.result.stats && data.result.stats.count;
      return c != null ? parseInt(c, 10) || 0 : null;
    } catch (e) {
      return null;
    }
  }
  const [nodeCount, activePlugins, activePackages, activeLanguages] = await Promise.all([
    statsCount('sys_cluster_state', null),
    statsCount('sys_plugins', 'active=true'),
    statsCount('sys_package', 'active=true'),
    statsCount('sys_language', 'active=true'),
  ]);
  info.node_count = nodeCount;
  info.active_plugins = activePlugins;
  info.active_packages = activePackages;
  info.active_languages = activeLanguages;
  return info;
}

// ─── Table API mode ───────────────────────────────────────────────────────
async function fetchTableAll(table, queryString, fields, _onProgress) {
  // Use sysparm_query for filters, sysparm_fields to whitelist what we need.
  const all = [];
  let offset = 0;
  let knownTotal = null; // populated from X-Total-Count response header on the first page
  const params = new URLSearchParams();
  params.set('sysparm_limit', String(config.pageSize));
  params.set('sysparm_display_value', 'all'); // returns {display_value, value} for refs
  params.set('sysparm_exclude_reference_link', 'true');
  // Stable sort by sys_id ensures page boundaries are consistent across all
  // requests. Without this, ServiceNow may return rows in a different order on
  // each page fetch (index scans, shard differences, background writes), causing
  // boundary rows to appear on two consecutive pages and producing duplicates.
  params.set('sysparm_orderby', 'sys_id');
  if (fields) params.set('sysparm_fields', fields.join(','));
  if (queryString) params.set('sysparm_query', queryString);
  // Absolute backstop when the row total is unknown (no X-Total-Count header).
  const HARD_PAGE_CAP = 1000000;
  let pages = 0;
  // Stop only when the API returns an empty page. Do NOT break on
  // rows.length < pageSize: some instances cap the effective page size
  // below our requested limit, which would cause early termination after
  // the very first page and silently drop the remaining rows.
  while (true) {
    params.set('sysparm_offset', String(offset));
    const url = config.instance + '/api/now/table/' + table + '?' + params.toString();
    vlog('GET', url);
    const { body, headers } = await httpGet(url);
    let data;
    try {
      data = JSON.parse(body.toString('utf8'));
    } catch (e) {
      throw new Error('Invalid JSON from ' + url + ': ' + e.message);
    }
    const rows = data.result || [];
    if (rows.length === 0) break;
    // X-Total-Count is returned by the Table API and gives the full record count
    // for the query — read it once on the first page to enable % progress display.
    if (offset === 0 && headers['x-total-count']) {
      const tc = parseInt(headers['x-total-count'], 10);
      if (tc > 0) knownTotal = tc;
    }
    // Safety cap: if a misbehaving instance keeps returning non-empty pages
    // (e.g. repeating the same page), bail rather than loop forever. When the
    // total is known we allow a small buffer beyond the expected page count.
    pages++;
    const maxPages = knownTotal ? Math.ceil(knownTotal / config.pageSize) + 5 : HARD_PAGE_CAP;
    if (pages > maxPages) {
      throw new Error(
        'Pagination for ' +
          table +
          ' exceeded ' +
          maxPages +
          ' pages' +
          (knownTotal ? ' (X-Total-Count=' + knownTotal + ')' : '') +
          ' — aborting to avoid an infinite loop. The instance may be returning ' +
          'inconsistent or duplicate pages.'
      );
    }
    all.push(...rows);
    offset += rows.length;
    if (_onProgress) _onProgress(all.length, knownTotal);
  }
  return all;
}

/**
 * Normalise a Table API row (with sysparm_display_value=all) into the shape
 * the SchemaBuilder expects: reference fields become { value, displayValue, name? }
 * where `name` is what we need for joins.
 *
 * Quirk: with sysparm_display_value=all, the API returns ref fields as
 *   { display_value: "User Label", value: "sys_id_text" }
 * It does NOT include the linked record's `name` column. We can't generally
 * fetch it without a second query. For our purposes:
 *   - super_class: we need the parent table's .name. Workaround: fetch
 *     sys_db_object FIRST, then build a sys_id -> name map, then resolve
 *     super_class references on the second pass.
 *   - reference (sys_dictionary): the column is of type table_name, so its
 *     value IS already the table name — no map lookup needed.
 *   - view (sys_db_view_table): uses a sys_id -> name map built from sys_db_view.
 */
function refFromTableApi(val) {
  if (val == null) return null;
  if (typeof val === 'object') {
    return { displayValue: val.display_value || '', value: val.value || '', name: '' };
  }
  return { displayValue: String(val), value: String(val), name: '' };
}

async function fetchAllViaTableApi() {
  log('Fetching via Table API (parallel)…');
  Progress.start();
  // Pre-register all tables so the N/total stage counter is correct from the first page.
  [
    'sys_db_object',
    'sys_db_view',
    'sys_glide_object',
    'sys_dictionary',
    'sys_m2m',
    'sys_db_view_table',
    'sys_relationship',
    'cmdb_rel_type_suggest',
    'cmdb_rel_type',
  ].forEach(t => Progress.register(t));
  const prog = name => (n, t) => Progress.update(name, n, t);

  // First wave: data we need to build sys_id → name lookups
  const [sysDbObjectRaw, sysDbViewRaw, sysGlideObjectRaw] = await Promise.all([
    fetchTableAll(
      'sys_db_object',
      null,
      [
        'sys_id',
        'name',
        'label',
        'super_class',
        'sys_scope',
        'is_extendable',
        'access',
        'ws_access',
        'scriptable_table',
      ],
      prog('sys_db_object')
    ),
    fetchTableAll(
      'sys_db_view',
      null,
      ['sys_id', 'name', 'label', 'description', 'plural'],
      prog('sys_db_view')
    ),
    fetchTableAll(
      'sys_glide_object',
      null,
      [
        'sys_id',
        'name',
        'label',
        'scalar_type',
        'scalar_length',
        'class_name',
        'visible',
        'attributes',
      ],
      prog('sys_glide_object')
    ),
  ]);
  log('  sys_db_object: ' + sysDbObjectRaw.length);
  log('  sys_db_view:   ' + sysDbViewRaw.length);
  log('  sys_glide_object: ' + sysGlideObjectRaw.length);

  // Build sys_id → table-name map (used to resolve super_class, reference, view refs)
  // Helper to unwrap simple display_value/value cells from sysparm_display_value=all.
  // MUST be defined before the sys_id→name maps below — with sysparm_display_value=all
  // every field (including sys_id) comes back as { value, display_value }, so using
  // t.sys_id directly as a map key coerces to '[object Object]' and collapses all
  // entries onto the same slot.
  const cell = (row, field) => {
    const v = row[field];
    if (v == null) return '';
    if (typeof v === 'object') return v.value || '';
    return String(v);
  };
  const cellBool = (row, field) => cell(row, field) === 'true';
  const refField = (row, field, sysIdToName) => {
    const v = row[field];
    if (v == null) return null;
    const sid = typeof v === 'object' ? v.value || '' : String(v);
    const dv = typeof v === 'object' ? v.display_value || '' : '';
    if (!sid && !dv) return null;
    return { value: sid, displayValue: dv, name: (sysIdToName && sysIdToName[sid]) || '' };
  };

  // Build sys_id → table-name map (used to resolve super_class, reference, view refs)
  const tableSysIdToName = {};
  for (const t of sysDbObjectRaw) tableSysIdToName[cell(t, 'sys_id')] = cell(t, 'name');
  const viewSysIdToName = {};
  for (const v of sysDbViewRaw) viewSysIdToName[cell(v, 'sys_id')] = cell(v, 'name');

  // Second wave: dictionary, m2m, db_view_table, relationship, cmdb topology, and instance info (all in parallel)
  const [
    sysDictionaryRaw,
    sysM2mRaw,
    sysDbViewTableRaw,
    sysRelationshipRaw,
    cmdbRelTypeSuggestRaw,
    cmdbRelTypeRaw,
    instanceInfo,
  ] = await Promise.all([
    // active!=false is the correct Table API equivalent of GlideRecord's
    // addQuery('active', true): it matches active=1 (explicit true) AND
    // active=NULL (unset, the default for most rows), mirroring GlideRecord's
    // "truthy null" behaviour.  Do NOT use active=true — that only matches
    // rows where the boolean is explicitly stored as 1, silently cutting ~93%
    // of field definitions (the majority of sys_dictionary rows never have
    // active written at all and therefore have active=NULL).
    fetchTableAll(
      'sys_dictionary',
      'elementISNOTEMPTY^active!=false',
      [
        'name',
        'element',
        'column_label',
        'internal_type',
        'reference',
        'max_length',
        'mandatory',
        'primary',
        'virtual',
        'active',
      ],
      prog('sys_dictionary')
    ),
    fetchTableAll(
      'sys_m2m',
      null,
      [
        'from_table',
        'to_table',
        'm2m_table',
        'm2m_from_field',
        'm2m_to_field',
        'm2m_from_label',
        'm2m_to_label',
      ],
      prog('sys_m2m')
    ),
    fetchTableAll(
      'sys_db_view_table',
      null,
      ['view', 'table', 'order', 'left_join', 'where_clause', 'variable_prefix', 'active'],
      prog('sys_db_view_table')
    ),
    fetchTableAll(
      'sys_relationship',
      null,
      [
        'name',
        'query_from',
        'query_with',
        'apply_to',
        'basic_query_from',
        'basic_apply_to',
        'advanced',
      ],
      prog('sys_relationship')
    ),
    // cmdb_rel_type_suggest may not exist on older / non-CMDB instances; catch and fall back to []
    fetchTableAll(
      'cmdb_rel_type_suggest',
      null,
      ['base_class', 'dependent_class', 'parent', 'cmdb_rel_type'],
      prog('cmdb_rel_type_suggest')
    ).catch(() => {
      Progress.update('cmdb_rel_type_suggest', 0, 0);
      return [];
    }),
    // cmdb_rel_type: small table (~50–100 rows) — fetch to build sys_id → display map.
    // We resolve display names here rather than relying on dot-walking or display_value
    // of the reference field in cmdb_rel_type_suggest, both of which are unreliable.
    fetchTableAll(
      'cmdb_rel_type',
      null,
      ['sys_id', 'parent_descriptor', 'child_descriptor'],
      prog('cmdb_rel_type')
    ).catch(() => {
      Progress.update('cmdb_rel_type', 0, 0);
      return [];
    }),
    fetchInstanceInfo(),
  ]);
  Progress.clear();
  log('  sys_dictionary: ' + sysDictionaryRaw.length);
  log('  sys_m2m: ' + sysM2mRaw.length);
  log('  sys_db_view_table: ' + sysDbViewTableRaw.length);
  log('  sys_relationship: ' + sysRelationshipRaw.length);
  log('  cmdb_rel_type_suggest: ' + cmdbRelTypeSuggestRaw.length);
  log('  cmdb_rel_type: ' + cmdbRelTypeRaw.length);

  // Now normalise into the builder's input shape
  const sysDbObject = sysDbObjectRaw.map(r => ({
    sys_id: cell(r, 'sys_id'),
    name: cell(r, 'name'),
    label: cell(r, 'label'),
    super_class: refField(r, 'super_class', tableSysIdToName),
    sys_scope: refField(r, 'sys_scope', null),
    is_extendable: cellBool(r, 'is_extendable'),
    access: cell(r, 'access'),
    // ws_access: true = table reachable via Table API / REST; false = blocked.
    // Defaults to true when the field is absent or empty (older instances).
    ws_access: cell(r, 'ws_access') !== 'false',
    scriptable_table: cellBool(r, 'scriptable_table'),
  }));
  const sysDictionary = sysDictionaryRaw.map(r => ({
    name: cell(r, 'name'),
    element: cell(r, 'element'),
    column_label: cell(r, 'column_label'),
    internal_type: (function () {
      const v = r.internal_type;
      if (!v) return { value: 'string', displayValue: 'String' };
      if (typeof v === 'object')
        return { value: v.value || 'string', displayValue: v.display_value || v.value || 'string' };
      return { value: String(v), displayValue: String(v) };
    })(),
    // sys_dictionary.reference stores the table NAME directly (type=table_name),
    // not a sys_id — so value IS the name; no map lookup needed.
    reference: (function () {
      const v = r.reference;
      if (!v) return null;
      const val = typeof v === 'object' ? v.value || '' : String(v || '');
      const dv = typeof v === 'object' ? v.display_value || '' : '';
      if (!val && !dv) return null;
      return { value: val, displayValue: dv, name: val };
    })(),
    max_length: cell(r, 'max_length'),
    mandatory: cellBool(r, 'mandatory'),
    primary: cellBool(r, 'primary'),
    virtual: cellBool(r, 'virtual'),
    active: cellBool(r, 'active'),
  }));
  const sysM2m = sysM2mRaw.map(r => ({
    from_table: cell(r, 'from_table'),
    to_table: cell(r, 'to_table'),
    m2m_table: cell(r, 'm2m_table'),
    m2m_from_field: cell(r, 'm2m_from_field'),
    m2m_to_field: cell(r, 'm2m_to_field'),
    m2m_from_label: cell(r, 'm2m_from_label'),
    m2m_to_label: cell(r, 'm2m_to_label'),
  }));
  const sysDbView = sysDbViewRaw.map(r => ({
    name: cell(r, 'name'),
    label: cell(r, 'label'),
    description: cell(r, 'description'),
    plural: cell(r, 'plural'),
  }));
  const sysDbViewTable = sysDbViewTableRaw.map(r => ({
    view: refField(r, 'view', viewSysIdToName),
    table: cell(r, 'table'),
    order: cell(r, 'order'),
    left_join: cellBool(r, 'left_join'),
    where_clause: cell(r, 'where_clause'),
    variable_prefix: cell(r, 'variable_prefix'),
    active: cellBool(r, 'active'),
  }));
  const sysRelationship = sysRelationshipRaw.map(r => ({
    name: cell(r, 'name'),
    query_from: cell(r, 'query_from'),
    query_with: cell(r, 'query_with'),
    apply_to: cell(r, 'apply_to'),
    basic_query_from: cell(r, 'basic_query_from'),
    basic_apply_to: cell(r, 'basic_apply_to'),
    advanced: cellBool(r, 'advanced'),
  }));
  const sysGlideObject = sysGlideObjectRaw.map(r => ({
    name: cell(r, 'name'),
    label: cell(r, 'label'),
    scalar_type: cell(r, 'scalar_type'),
    scalar_length: cell(r, 'scalar_length'),
    class_name: cell(r, 'class_name'),
    visible: cellBool(r, 'visible'),
    attributes: cell(r, 'attributes'),
  }));
  // Build sys_id → "parent_descriptor::child_descriptor" map from the cmdb_rel_type table.
  // This is more reliable than dot-walking or display_value on the reference field in
  // cmdb_rel_type_suggest: sysparm_display_value=all returns empty display_value for ~half
  // the rows, and dot-walked descriptor fields come back with an empty value (only
  // display_value is populated for these label-type fields), which cell() would miss.
  const relTypeById = new Map();
  for (const rt of cmdbRelTypeRaw) {
    const id = cell(rt, 'sys_id');
    const pd =
      cell(rt, 'parent_descriptor') ||
      (rt.parent_descriptor && typeof rt.parent_descriptor === 'object'
        ? rt.parent_descriptor.display_value || ''
        : '');
    const cd =
      cell(rt, 'child_descriptor') ||
      (rt.child_descriptor && typeof rt.child_descriptor === 'object'
        ? rt.child_descriptor.display_value || ''
        : '');
    if (id && pd) relTypeById.set(id, pd + (cd ? '::' + cd : ''));
  }
  log('  cmdb_rel_type (map entries): ' + relTypeById.size);

  // cmdb_rel_type_suggest — class-to-class topology metadata.
  let cmdbRelTypeSuggestNoMatch = 0;
  const cmdbRelTypeSuggest = cmdbRelTypeSuggestRaw
    .map(r => {
      const rt = r.cmdb_rel_type;
      const sysId = rt && typeof rt === 'object' ? rt.value || '' : String(rt || '');
      const mapped = relTypeById.get(sysId);
      if (!mapped) cmdbRelTypeSuggestNoMatch++;
      const disp = mapped || (rt && typeof rt === 'object' ? rt.display_value || '' : '');
      return {
        base_class: cell(r, 'base_class'),
        dependent_class: cell(r, 'dependent_class'),
        parent: cellBool(r, 'parent'),
        rel_type_display: disp,
      };
    })
    .filter(r => r.base_class && r.dependent_class && r.rel_type_display);
  log(
    '  cmdb_rel_type_suggest (after filter): ' +
      cmdbRelTypeSuggest.length +
      (cmdbRelTypeSuggestNoMatch
        ? '  (' +
          cmdbRelTypeSuggestNoMatch +
          ' rows had no map match — used display_value fallback)'
        : '')
  );

  // ── Optional metadata sections ────────────────────────────────────────────
  // Fetched only when requested via --metadata. Each fetch is best-effort:
  // older instances may lack a table, so we .catch(() => []) and let the section
  // degrade to empty rather than aborting the whole export. The shared builder
  // decides the emitted shape; we hand it normalised flat rows.
  const want = section => config.metadata.includes(section);
  const [pluginsRaw, storeAppsRaw, customAppsRaw, propertiesRaw] = await Promise.all([
    want('plugins')
      ? fetchTableAll('sys_plugins', null, [
          'id',
          'name',
          'active',
          'version',
          'install_date',
        ]).catch(() => [])
      : Promise.resolve(null),
    want('storeApps')
      ? fetchTableAll('sys_store_app', null, [
          'scope',
          'name',
          'version',
          'vendor',
          'active',
          'latest_version',
          'update_available',
          'install_date',
          'update_date',
        ]).catch(() => [])
      : Promise.resolve(null),
    want('customApps')
      ? fetchTableAll('sys_app', null, [
          'scope',
          'name',
          'version',
          'active',
          'sys_created_on',
          'sys_updated_on',
        ]).catch(() => [])
      : Promise.resolve(null),
    want('properties')
      ? fetchTableAll('sys_properties', config.propertyQuery || null, [
          'name',
          'value',
          'type',
          'description',
        ]).catch(() => [])
      : Promise.resolve(null),
  ]);
  // Normalise to flat rows so the builder input is consistent across exporters.
  // null means "section not requested" → builder omits it entirely.
  const plugins = pluginsRaw
    ? pluginsRaw.map(r => ({
        id: cell(r, 'id'),
        name: cell(r, 'name'),
        active: cellBool(r, 'active'),
        version: cell(r, 'version'),
        install_date: cell(r, 'install_date'),
      }))
    : null;
  const storeApps = storeAppsRaw
    ? storeAppsRaw.map(r => ({
        scope: cell(r, 'scope'),
        name: cell(r, 'name'),
        version: cell(r, 'version'),
        vendor: cell(r, 'vendor'),
        active: cellBool(r, 'active'),
        latest_version: cell(r, 'latest_version'),
        update_available: cellBool(r, 'update_available'),
        install_date: cell(r, 'install_date'),
        update_date: cell(r, 'update_date'),
      }))
    : null;
  const customApps = customAppsRaw
    ? customAppsRaw.map(r => ({
        scope: cell(r, 'scope'),
        name: cell(r, 'name'),
        version: cell(r, 'version'),
        active: cellBool(r, 'active'),
        // sys_app has no store-style dates; use the record's create/update stamps.
        install_date: cell(r, 'sys_created_on'),
        update_date: cell(r, 'sys_updated_on'),
      }))
    : null;
  const properties = propertiesRaw
    ? propertiesRaw.map(r => ({
        name: cell(r, 'name'),
        value: cell(r, 'value'),
        type: cell(r, 'type'),
        description: cell(r, 'description'),
      }))
    : null;
  if (config.metadata.length) {
    log(
      '  metadata sections: ' +
        config.metadata
          .map(s => {
            const n = { plugins, storeApps, customApps, properties }[s];
            return s + '=' + (n ? n.length : 0);
          })
          .join(', ')
    );
  }

  // Per-table record counts via Stats API — opt-in. Failure classification
  // mirrors the BG script: ACL denials, unsupported
  // aggregates, and underlying-script errors are recorded with category
  // metadata so the viewer can render "unavailable (acl)" etc. rather than
  // misleadingly showing 0.
  let recordCounts = null;
  let recordCountFailures = null;
  if (config.includeRecordCounts) {
    log('Collecting record counts (this is the slow step)…');
    recordCounts = {};
    recordCountFailures = {};
    const names = sysDbObject.map(t => t.name).filter(Boolean);
    let done = 0;
    // Cheap parallelism with a worker pool to keep the instance happy
    const CONCURRENCY = 8;
    async function worker() {
      while (true) {
        const idx = done++;
        if (idx >= names.length) return;
        const name = names[idx];
        if (/^sys_|^var_|^ts_/.test(name)) continue;
        try {
          const url = config.instance + '/api/now/stats/' + name + '?sysparm_count=true';
          const data = await fetchJson(url);
          const c = data.result && data.result.stats && data.result.stats.count;
          if (c != null) {
            recordCounts[name] = parseInt(c, 10) || 0;
          } else {
            recordCounts[name] = null;
            recordCountFailures[name] = { category: 'other', message: 'no count in response' };
          }
        } catch (e) {
          recordCounts[name] = null;
          recordCountFailures[name] = {
            category: classifyCountError(e && e.message, e && e.status),
            message: String((e && e.message) || e || 'unknown').substring(0, 200),
          };
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    const succeeded = Object.values(recordCounts).filter(v => v !== null).length;
    const failed = Object.values(recordCounts).filter(v => v === null).length;
    log(`  record counts collected: ${succeeded} tables (${failed} could not be counted)`);
  }

  return {
    sysDbObject,
    sysDictionary,
    sysM2m,
    sysDbView,
    sysDbViewTable,
    sysRelationship,
    sysGlideObject,
    cmdbRelTypeSuggest,
    recordCounts,
    recordCountFailures,
    instance: instanceInfo,
    // Optional metadata sections — null when not requested (builder omits them).
    plugins,
    storeApps,
    customApps,
    properties,
  };
}

// ─── Format serialisers (non-JSON output) ────────────────────────────────────
// Extracted to ./serialisers.js (#73). buildAdj + serialize{Markdown,JsonLd,
// Turtle,OpenApi} are required as `Serialisers` at the top of this file.

// ─── MAIN ─────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  log('Schema export — instance=' + config.instance);
  try {
    const input = await fetchAllViaTableApi();
    log('Building schema…');

    // Non-JSON formats and --pretty all need the full schema object in memory.
    // JSON streaming mode avoids materialising the full string (V8 ~512 MB cap).
    const needFullBuild = config.format !== 'json' || config.pretty;

    const buildOptions = { includePropertyValues: config.includePropertyValues };

    if (needFullBuild) {
      const schema = SchemaBuilder.build(input, buildOptions);
      // Attach adjacency map for serialisers that traverse edges
      schema._adj = Serialisers.buildAdj(schema);
      let content;
      if (config.format === 'json') {
        content = JSON.stringify(schema, null, 2);
      } else if (config.format === 'markdown') {
        log('Serialising as Markdown…');
        content = Serialisers.serializeMarkdown(schema, config);
      } else if (config.format === 'jsonld') {
        log('Serialising as JSON-LD…');
        content = Serialisers.serializeJsonLd(schema, config);
      } else if (config.format === 'owl') {
        log('Serialising as OWL/Turtle…');
        content = Serialisers.serializeTurtle(schema, config);
      } else if (config.format === 'openapi') {
        log('Serialising as OpenAPI YAML…');
        content = Serialisers.serializeOpenApi(schema, config);
      }
      log('Writing to ' + config.output + '…');
      fs.writeFileSync(config.output, content, 'utf8');
      const elapsed = (Date.now() - t0) / 1000;
      log('=== EXPORT COMPLETE ===');
      log('Output:  ' + path.resolve(config.output));
      log('Format:  ' + config.format);
      log('Counts:  ' + JSON.stringify(schema._stats.counts));
      log('Elapsed: ' + elapsed.toFixed(1) + 's');
      return;
    }

    // JSON streaming path (default — keeps memory usage low for large schemas)
    log('Streaming JSON to ' + config.output + '…');
    const out = fs.createWriteStream(config.output, { encoding: 'utf8' });
    let bytes = 0;
    const summary = SchemaBuilder.buildStreaming(
      input,
      chunk => {
        out.write(chunk);
        bytes += Buffer.byteLength(chunk, 'utf8');
      },
      buildOptions
    );
    await new Promise((resolve, reject) => {
      out.end(err => (err ? reject(err) : resolve()));
    });
    const elapsed = (Date.now() - t0) / 1000;
    log('=== EXPORT COMPLETE ===');
    log('Output:  ' + path.resolve(config.output));
    log('Format:  json');
    log('Size:    ' + (bytes / 1048576).toFixed(2) + ' MB');
    log('Counts:  ' + JSON.stringify(summary.counts));
    log('Elapsed: ' + elapsed.toFixed(1) + 's');

    // Access-notes summary (mirrors BG-script behaviour). Skipped if there
    // were no count failures, since the section would otherwise be empty.
    if (input.recordCountFailures && Object.keys(input.recordCountFailures).length) {
      const buckets = { acl: [], unsupported: [], script_error: [], other: [] };
      for (const [name, info] of Object.entries(input.recordCountFailures)) {
        const cat = buckets[info.category] ? info.category : 'other';
        buckets[cat].push(name);
      }
      const total =
        buckets.acl.length +
        buckets.unsupported.length +
        buckets.script_error.length +
        buckets.other.length;
      log('─────────────────────────────────────────────');
      log(`Access notes — ${total} tables could not be counted:`);
      const printBucket = (label, names, hint) => {
        if (!names.length) return;
        const preview = names.slice(0, 8).join(', ');
        const more = names.length > 8 ? ` … and ${names.length - 8} more` : '';
        log(`  ${label} (${names.length}):  ${preview}${more}`);
        if (hint) log(`    → ${hint}`);
      };
      printBucket(
        'cross-scope ACL denials',
        buckets.acl,
        'Expected for scoped apps. Authenticate as a user with cross-scope read access to count these.'
      );
      printBucket(
        'aggregate not supported',
        buckets.unsupported,
        'Virtual tables that refuse COUNT queries; row count is unknowable via Stats API.'
      );
      printBucket(
        'script errors in vtable handlers',
        buckets.script_error,
        'Third-party vtable handlers threw exceptions during COUNT.'
      );
      printBucket(
        'other / unclassified',
        buckets.other,
        'See the instance system log around this timestamp for the underlying cause.'
      );
      log('The full failure list is captured in _capabilities.recordCounts in the output JSON.');
    }
  } catch (err) {
    die(err.message || String(err), 2);
  }
}

// Run only when executed directly as a CLI. When this file is imported (e.g. by
// unit tests, via readFileSync + new Function), neither validation nor main()
// runs, so the process is never exited and helpers can be tested in isolation.
if (require.main === module) {
  validateCliConfig();
  main();
}

// Exported for unit tests. Harmless in the bundled standalone (CommonJS context).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseArgs,
    classifyCountError,
    validateCliConfig,
    httpGet,
    fetchTableAll,
    fetchAllViaTableApi,
    config,
    MAX_RESPONSE_BYTES,
  };
}

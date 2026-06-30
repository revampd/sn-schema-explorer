/* ============================================================================
 * config-data/reconcile.js — N-way metadata reconciliation (v1.0.3)
 * ============================================================================
 *
 * Pure logic (no DOM) adapted from the standalone cross-instance reconciler
 * prototype, reading the registry's `_metadata` sections instead of CSV files.
 *
 * Given a metadata section and a list of registered instances, it produces the
 * union of entries keyed per section, a per-instance cell for each, and a
 * status that classifies how the instances differ for that entry:
 *
 *   missing   — the entry is absent from at least one instance
 *   drift     — present everywhere but the version (or property value) differs
 *   active    — present everywhere, same version, but active state differs
 *   inactive  — present everywhere, same version, and inactive in all
 *   sync      — present everywhere, same version, consistently active
 *
 * Sections come from the exporter contract (schema-builder.js):
 *   plugins    [{ id, name, active, version }]
 *   storeApps  [{ scope, name, version, vendor, active }]
 *   customApps [{ scope, name, version, active }]
 *   properties [{ name, type, description, value? }]
 * ============================================================================ */

// Per-section configuration: which field keys an entry, which carries its
// display name, and which comparable fields it has.
// `fields` are the comparable/serialised columns. Only `version`, `value`, and
// `active` drive status (see classify); `latestVersion`/`updateAvailable` are
// carried for the store-app "update available" signal, and the *Date fields are
// display-only context (they always differ across instances, so they must NOT
// trigger drift).
export const SECTION_CONFIG = {
  plugins: {
    // Key on `name`, NOT `id`: the exporter's plugin `id` falls back to the
    // record sys_id, which differs across instances, so keying on it makes the
    // same plugin reconcile as two "missing" rows. The plugin name (the
    // `@scope/plugin` source id from sys_plugins) is stable across instances.
    key: 'name',
    name: 'name',
    showKey: false,
    fields: ['version', 'active', 'installDate'],
  },
  storeApps: {
    key: 'scope',
    name: 'name',
    showKey: false,
    fields: [
      'version',
      'active',
      'vendor',
      'latestVersion',
      'updateAvailable',
      'installDate',
      'updateDate',
    ],
  },
  customApps: {
    key: 'scope',
    name: 'name',
    showKey: false,
    fields: ['version', 'active', 'installDate', 'updateDate'],
  },
  properties: { key: 'name', name: 'name', fields: ['value', 'type'] },
};

export const SECTION_LABELS = {
  plugins: 'Plugins',
  storeApps: 'Store apps',
  customApps: 'Custom apps',
  properties: 'Properties',
};

export const STATUS_LABELS = {
  sync: 'In sync',
  drift: 'Drift',
  missing: 'Missing',
  active: 'State mismatch',
  inactive: 'Inactive',
};

// Read a section array off a registry entry, or null when absent.
function sectionRows(entry, section) {
  const md = entry && entry.data && entry.data._metadata;
  const arr = md && md[section];
  return Array.isArray(arr) ? arr : null;
}

function classify(cfg, cells, loaded) {
  const present = loaded.filter(i => cells[i.id]);
  if (present.length < loaded.length) return 'missing';

  if (cfg.fields.includes('version')) {
    const vers = new Set(present.map(i => (cells[i.id].version || '').trim() || '(blank)'));
    if (vers.size > 1) return 'drift';
  }
  // Property value drift (only meaningful when values were exported).
  if (cfg.fields.includes('value')) {
    const haveValues = present.some(i => cells[i.id].value != null);
    if (haveValues) {
      const vals = new Set(
        present.map(i => (cells[i.id].value == null ? '«none»' : String(cells[i.id].value)))
      );
      if (vals.size > 1) return 'drift';
    }
  }
  if (cfg.fields.includes('active')) {
    const acts = present.map(i => cells[i.id].active);
    if (acts.includes(true) && acts.includes(false)) return 'active';
    if (acts.length && acts.every(a => a === false)) return 'inactive';
  }
  return 'sync';
}

/**
 * Classify how an application entry differs across instances, using the same
 * rules as the Config Data table — only `version` and `active` drive an app's
 * status. Used by the config-drift map overlay (#133) so the overlay and the
 * Config lens agree on what "drift" means.
 *
 * @param {Object} cells     { [instanceId]: appRecord | null }
 * @param {Array}  instances the instances being compared ([{ id }, …])
 * @returns {'sync'|'drift'|'missing'|'active'|'inactive'}
 */
export function classifyAppDrift(cells, instances) {
  return classify({ fields: ['version', 'active'] }, cells, instances);
}

/**
 * Reconcile one metadata section across instances.
 * @param {string} section   one of SECTION_CONFIG's keys
 * @param {Array}  instances registry entries ({ id, label, data })
 * @returns {{ section, instances, rows, counts }}
 *   instances — only those that carry this section (the "loaded" set)
 *   rows      — [{ key, name, cells:{[instId]: record|null}, status }] sorted by name
 *   counts    — { sync, drift, missing, active, inactive }
 */
export function reconcile(section, instances) {
  const cfg = SECTION_CONFIG[section];
  const empty = { section, instances: [], rows: [], counts: countsZero() };
  if (!cfg || !Array.isArray(instances)) return empty;

  // Only instances that actually carry this section participate.
  const loaded = [];
  const maps = new Map(); // instId -> Map(key -> record)
  for (const inst of instances) {
    const rows = sectionRows(inst, section);
    if (!rows) continue;
    const m = new Map();
    for (const rec of rows) {
      const key = String((rec && rec[cfg.key]) || (rec && rec[cfg.name]) || '').trim();
      if (!key) continue;
      if (!m.has(key)) m.set(key, rec); // first wins on duplicate keys
    }
    loaded.push(inst);
    maps.set(inst.id, m);
  }
  if (!loaded.length) return empty;

  const keys = new Set();
  loaded.forEach(i => maps.get(i.id).forEach((_v, k) => keys.add(k)));

  const rows = [];
  keys.forEach(key => {
    const cells = {};
    let name = key;
    loaded.forEach(i => {
      const rec = maps.get(i.id).get(key) || null;
      cells[i.id] = rec;
      if (rec && rec[cfg.name]) name = String(rec[cfg.name]);
    });
    rows.push({ key, name, cells, status: classify(cfg, cells, loaded) });
  });
  rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const counts = countsZero();
  rows.forEach(r => counts[r.status]++);

  return { section, instances: loaded, rows, counts };
}

function countsZero() {
  return { sync: 0, drift: 0, missing: 0, active: 0, inactive: 0 };
}

// -- CSV export ------------------------------------------------------------

function csvField(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function boolText(v) {
  return v === true ? 'active' : v === false ? 'inactive' : 'unknown';
}

/**
 * Serialise a reconcile() result to CSV: name, key, per-instance columns for
 * each comparable field, then status. Column order follows the loaded
 * instances. Returns a string with a trailing newline-free body.
 */
export function reconcileToCsv(result) {
  const cfg = SECTION_CONFIG[result.section];
  if (!cfg) return '';
  const loaded = result.instances;
  const perInstanceCols = i => cfg.fields.map(f => i.label + '_' + f);
  const header = ['name', 'key', ...loaded.flatMap(perInstanceCols), 'status'];
  const lines = [header.map(csvField).join(',')];

  for (const row of result.rows) {
    const out = [row.name, row.key];
    for (const i of loaded) {
      const rec = row.cells[i.id];
      for (const f of cfg.fields) {
        if (!rec) {
          out.push('');
        } else if (f === 'active') {
          out.push(boolText(rec.active));
        } else {
          out.push(rec[f] == null ? '' : rec[f]);
        }
      }
    }
    out.push(STATUS_LABELS[row.status] || row.status);
    lines.push(out.map(csvField).join(','));
  }
  return lines.join('\n');
}

/**
 * Serialise a reconcile() result to a JSON-ready object: the section, the
 * instances that participated (id + label), the per-instance comparable fields,
 * counts, and one entry per row carrying its key/name/status and a per-instance
 * cell (only the section's comparable fields, plus `present`). Pretty-print at
 * the call site with JSON.stringify(obj, null, 2).
 */
export function reconcileToJson(result) {
  const cfg = SECTION_CONFIG[result.section];
  if (!cfg) return { section: result.section, instances: [], fields: [], counts: {}, entries: [] };
  const loaded = result.instances;
  const cellOf = rec => {
    if (!rec) return { present: false };
    const out = { present: true };
    for (const f of cfg.fields) out[f] = rec[f] == null ? null : rec[f];
    return out;
  };
  return {
    section: result.section,
    instances: loaded.map(i => ({ id: i.id, label: i.label })),
    fields: cfg.fields,
    counts: result.counts,
    entries: result.rows.map(row => ({
      key: row.key,
      name: row.name,
      status: row.status,
      cells: Object.fromEntries(loaded.map(i => [i.label, cellOf(row.cells[i.id])])),
    })),
  };
}

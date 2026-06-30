/* ============================================================================
 * instances-state.js — multi-instance registry (v1.0.3)
 * ============================================================================
 *
 * The registry holds every schema export the user has registered on the landing
 * page. Future tools (Schema Explorer, Schema Diff, Configuration Data) read
 * from it instead of owning their own file upload.
 *
 * Design constraints (see the v1.0.3 plan / #99):
 *   • Heavy `data` (the multi-MB export) lives ONLY in memory. localStorage is
 *     ~5 MB and already shared with other `snse:*` keys, so we persist a
 *     LIST-ONLY snapshot (id/label/source/fileName/capabilities/meta/addedAt) —
 *     never `data`. Full-data rehydration (IndexedDB) is a later milestone.
 *   • Capability detection is PRESENCE-BASED: we trust the actual arrays in the
 *     loaded data, treating `_capabilities` only as a hint. Older exports that
 *     predate metadata sections therefore report `schema:true` and every
 *     metadata capability `false`, with no special-casing.
 *
 * This module is pure state + helpers. It performs NO rendering and has no DOM
 * dependency beyond `localStorage` (guarded), so it is fully unit-testable.
 * ============================================================================ */

const STORAGE_KEY = 'snse:instances:v1';

// Metadata sections, aligned with the exporter contract (schema-builder.js).
export const METADATA_SECTIONS = ['plugins', 'storeApps', 'customApps', 'properties'];

/**
 * The registry singleton. Mirrors the mutable-singleton pattern used by
 * graphState / uiState / diffState.
 *   instances  — ordered array of entries (see addInstance for the shape)
 *   selectedId — id of the instance currently driving the graph, or null
 *   _byId      — id → entry index map, kept in sync by the mutators
 */
export const instancesState = {
  instances: [],
  selectedId: null,
  _byId: new Map(),
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function genId() {
  // Mirror saved-views' id scheme; `i_` namespace for instances.
  return 'i_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function reindex() {
  instancesState._byId.clear();
  for (let i = 0; i < instancesState.instances.length; i++) {
    instancesState._byId.set(instancesState.instances[i].id, i);
  }
}

// ── Capability detection ───────────────────────────────────────────────────

/**
 * Presence-based capability detection. Returns a flat object:
 *   { schema, plugins, storeApps, customApps, properties }  (all boolean)
 *
 * `schema` is true when the export carries at least one node AND one edge.
 * Each metadata capability is true only when `data._metadata.<section>` is a
 * non-empty array — `_capabilities` is ignored as authoritative here (it can be
 * stale or absent), matching the exporter's own `enabled = count > 0` rule.
 */
export function detectCapabilities(data) {
  const caps = { schema: false };
  for (const s of METADATA_SECTIONS) caps[s] = false;
  if (!data || typeof data !== 'object') return caps;

  caps.schema = Array.isArray(data.nodes) && data.nodes.length > 0 && Array.isArray(data.edges);
  // Require edges to exist as an array but allow length 0 (a single-table export
  // legitimately has nodes and no edges). nodes>0 is the meaningful signal.
  const md = data._metadata;
  if (md && typeof md === 'object') {
    for (const s of METADATA_SECTIONS) {
      caps[s] = Array.isArray(md[s]) && md[s].length > 0;
    }
  }
  return caps;
}

/**
 * Union of capabilities across all registered instances, plus the count of
 * instances carrying each. Used by the landing page to gate tools (e.g. plugin
 * comparison needs ≥2 instances with `plugins:true`).
 *   → { schema:{any,count}, plugins:{any,count}, ... }
 */
export function aggregateCapabilities() {
  const keys = ['schema', ...METADATA_SECTIONS];
  const out = {};
  for (const k of keys) out[k] = { any: false, count: 0 };
  for (const entry of instancesState.instances) {
    const caps = entry.capabilities || {};
    for (const k of keys) {
      if (caps[k]) {
        out[k].any = true;
        out[k].count++;
      }
    }
  }
  return out;
}

// ── Mutators ─────────────────────────────────────────────────────────────────

/**
 * Register an instance. Capabilities are derived from `data` unless explicitly
 * provided. Returns the created entry.
 *   { id, label, source, fileName, data, capabilities, meta, addedAt }
 *     source   — 'file' | 'demo' | 'restored' (free-form provenance tag)
 *     meta      — `data._instance` (instance_name, build_name, etc.), or {}
 *     addedAt   — epoch ms
 */
export function addInstance({
  label,
  source = 'file',
  fileName = null,
  data = null,
  capabilities = null,
  meta = null,
  addedAt = null,
} = {}) {
  const id = genId();
  const entry = {
    id,
    label: label || fileName || 'Instance',
    source,
    fileName,
    data,
    capabilities: capabilities || detectCapabilities(data),
    meta: meta || (data && data._instance) || {},
    addedAt: addedAt || Date.now(),
  };
  instancesState.instances.push(entry);
  reindex();
  persist();
  return entry;
}

export function getInstance(id) {
  const idx = instancesState._byId.get(id);
  return idx === undefined ? null : instancesState.instances[idx];
}

export function removeInstance(id) {
  const idx = instancesState._byId.get(id);
  if (idx === undefined) return false;
  instancesState.instances.splice(idx, 1);
  if (instancesState.selectedId === id) instancesState.selectedId = null;
  reindex();
  persist();
  return true;
}

export function renameInstance(id, label) {
  const entry = getInstance(id);
  if (!entry) return false;
  entry.label = label || entry.label;
  persist();
  return true;
}

/**
 * Mark an instance as selected (the one driving the graph). Selecting null
 * clears the selection. Returns true on success. Does NOT load the graph —
 * that is the caller's job (selectInstanceForGraph in the load module, PR5).
 */
export function selectInstance(id) {
  if (id === null) {
    instancesState.selectedId = null;
    persist();
    return true;
  }
  if (!instancesState._byId.has(id)) return false;
  instancesState.selectedId = id;
  persist();
  return true;
}

// ── Persistence (list-only) ────────────────────────────────────────────────

/**
 * Persist a LIST-ONLY snapshot — never the heavy `data`. Guarded so a
 * private-mode / quota-exceeded localStorage never breaks the app.
 */
export function persist() {
  try {
    if (typeof localStorage === 'undefined') return;
    const snapshot = {
      selectedId: instancesState.selectedId,
      instances: instancesState.instances.map(e => ({
        id: e.id,
        label: e.label,
        source: e.source,
        fileName: e.fileName,
        capabilities: e.capabilities,
        meta: e.meta,
        addedAt: e.addedAt,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('instances-state: localStorage write failed', e);
  }
}

/**
 * Load the persisted list snapshot into the registry. Entries are rehydrated
 * WITHOUT `data` (`data:null`) — heavy data is not persisted, so a restored
 * entry is a placeholder until the user re-drops its file (PR9). Returns the
 * number of entries loaded. Selection is only restored if the id still exists.
 */
export function loadPersisted() {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const snapshot = JSON.parse(raw);
    if (!snapshot || !Array.isArray(snapshot.instances)) return 0;
    instancesState.instances = snapshot.instances.map(e => ({
      id: e.id,
      label: e.label,
      source: e.source || 'restored',
      fileName: e.fileName || null,
      data: null,
      capabilities: e.capabilities || { schema: false },
      meta: e.meta || {},
      addedAt: e.addedAt || null,
    }));
    reindex();
    instancesState.selectedId = instancesState._byId.has(snapshot.selectedId)
      ? snapshot.selectedId
      : null;
    return instancesState.instances.length;
  } catch (e) {
    console.warn('instances-state: localStorage read failed', e);
    return 0;
  }
}

/** Test/teardown helper — clears in-memory state (does not touch localStorage). */
export function _resetInstances() {
  instancesState.instances = [];
  instancesState.selectedId = null;
  instancesState._byId.clear();
}

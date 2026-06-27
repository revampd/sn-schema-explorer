/* ============================================================================
 * config-overlay — config drift projected onto the Schema Map (#133)
 * ============================================================================
 *
 * The first true cross-lens overlay of the integrated-lenses epic (#130): the
 * Config lens's signal drawn as a LAYER on the Structure surface. When ≥2
 * app-capable instances are registered, this tints each schema node by the drift
 * status of the application that owns its scope — using the SAME classification
 * as the Configuration Data table (reconcile.classifyAppDrift), so the map and
 * the table always agree.
 *
 * It is a layer, not a mode: off by default, toggled from a small canvas control,
 * and only meaningful in the Schema Map (force) view. The scope→app join is the
 * shared entity spine (#132); the bridge covers store + custom apps only.
 *
 * Self-registering (no central edits): adds a render hook that toggles `cfg-*`
 * classes on node-groups (mirroring schema-diff's diff-* approach), and builds
 * its own toggle/legend control in JS so it touches no Prettier-ignored partial.
 * ============================================================================ */

import { graphState, uiState, buildSpine } from '../../core/state.js';
import { instancesState } from '../../core/instances-state.js';
import { onFocusChange } from '../../core/focus-state.js';
import { render, addRenderHook } from '../../core/render.js';
import { root } from '../../core/canvas.js';
import { onViewModeChange } from '../../core/view-mode.js';
import { Settings } from '../settings/index.js';
import { classifyAppDrift, STATUS_LABELS } from '../config-data/reconcile.js';

// Map-overlay status buckets. 'inactive' (inactive everywhere) is deliberately
// left neutral — it isn't a problem to flag on the map.
const STATUSES = ['sync', 'drift', 'missing', 'active'];
const STATUS_CLASS = {
  sync: 'cfg-sync',
  drift: 'cfg-drift',
  missing: 'cfg-missing',
  active: 'cfg-state',
};
const ALL_CLASSES = 'cfg-sync cfg-drift cfg-missing cfg-state';

let _active = false;
let _driftMap = new Map(); // tableId -> status

// Instances that can participate in a drift comparison: in-memory data carrying a
// store/custom app section. Restored placeholders (data:null) are excluded.
function appCapableInstances() {
  return instancesState.instances.filter(e => {
    const md = e.data && e.data._metadata;
    return md && ((md.storeApps && md.storeApps.length) || (md.customApps && md.customApps.length));
  });
}

function eligible() {
  return (
    !!graphState.graphData &&
    Settings.isEnabled('configData') &&
    uiState.viewMode === 'force' &&
    appCapableInstances().length >= 2
  );
}

// Recompute the per-table drift status against the app-capable instance set.
function recompute() {
  _driftMap = new Map();
  if (!graphState.graphData) return;
  const compareSet = appCapableInstances();
  if (compareSet.length < 2) return;
  const spine = buildSpine(graphState.graphData, compareSet);
  for (const n of graphState.graphData.nodes) {
    const { apps } = spine.resolveTable(n.id);
    const present = compareSet.filter(i => apps[i.id]);
    if (!present.length) continue; // scope owns no app anywhere — neutral
    _driftMap.set(n.id, classifyAppDrift(apps, compareSet));
  }
}

// ── Render hook: paint (or clear) node classes after every render ────────────
addRenderHook(() => {
  const sel = root.selectAll('g.node-group');
  if (!_active || !eligible()) {
    sel.classed(ALL_CLASSES, false);
    return;
  }
  sel.each(function (d) {
    const status = _driftMap.get(d.id) || null;
    const sd = d3.select(this);
    for (const s of STATUSES) sd.classed(STATUS_CLASS[s], status === s);
  });
});

// ── Canvas control (toggle + legend), built in JS ───────────────────────────
let _control = null;

function buildControl() {
  if (_control) return _control;
  const host = document.getElementById('edge-legend')?.parentNode;
  if (!host) return null;

  const box = document.createElement('div');
  box.className = 'field-legend';
  box.id = 'cfg-drift-layer';
  box.style.display = 'none';

  const toggle = document.createElement('button');
  toggle.id = 'cfg-drift-toggle';
  toggle.type = 'button';
  toggle.className = 'cfg-drift-toggle';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.title = 'Tint tables by configuration drift across your app-capable instances';
  toggle.textContent = 'Config drift';
  toggle.addEventListener('click', () => setActive(!_active));

  const legend = document.createElement('div');
  legend.id = 'cfg-drift-legend';
  legend.className = 'cfg-drift-legend';
  for (const s of STATUSES) {
    const row = document.createElement('div');
    row.className = 'fl-row';
    row.innerHTML =
      `<span class="cfg-swatch ${STATUS_CLASS[s]}"></span>` +
      `<span>${STATUS_LABELS[s] || s}</span>`;
    legend.appendChild(row);
  }

  box.appendChild(toggle);
  box.appendChild(legend);
  host.appendChild(box);
  _control = box;
  return box;
}

function syncControl() {
  const box = buildControl();
  if (!box) return;
  box.style.display = eligible() ? '' : 'none';
  box.classList.toggle('active', _active);
  const toggle = box.querySelector('#cfg-drift-toggle');
  if (toggle) toggle.setAttribute('aria-pressed', String(_active));
}

function setActive(on) {
  _active = !!on && eligible();
  if (_active) recompute();
  syncControl();
  render();
}

// ── Wiring ───────────────────────────────────────────────────────────────────
// Recompute when the focus (instance/selection) changes while the layer is on,
// and keep the control's visibility in sync with eligibility and view mode.
onFocusChange(() => {
  if (_active && eligible()) recompute();
  syncControl();
});
onViewModeChange(() => {
  if (uiState.viewMode !== 'force') _active = false;
  syncControl();
});
Settings.onChange('configData', syncControl);

// Build the control once the DOM/canvas overlays exist.
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncControl, { once: true });
  } else {
    syncControl();
  }
}

export { setActive as setConfigDriftActive };

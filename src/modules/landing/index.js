/* ============================================================================
 * landing/index.js — the front door (v1.0.3)
 * ============================================================================
 *
 * The landing workspace is where the user registers one or more instance
 * exports and opens a tool. It owns the file-drop / demo / manifest-stitching
 * UI (relocated from modules/load) and turns each load into a registry entry
 * (core/instances-state).
 *
 * Layout: a grid of instance CARDS plus an "Add instance" card. Each card shows
 * the sections present in that instance's single JSON export (read-only status)
 * and a row of per-instance TOOL ICONS. A tool launches with that instance as
 * its primary; multi-instance tools (e.g. Configuration Data) let the user add
 * more instances from inside the tool — the same base/compare flow as Schema
 * Diff. Tools self-register via registerTool(...) — the same plug-in spirit as
 * Settings.registerFeature / registerWorkspace.
 * ============================================================================ */

import {
  instancesState,
  addInstance,
  removeInstance,
  renameInstance,
  selectInstance,
} from '../../core/state.js';
import { DEMO_DATA } from '../../core/constants.js';
import { h } from '../../core/template.js';
import { setWorkspace, onWorkspaceChange } from '../../core/workspace.js';
import { selectInstanceForGraph } from '../load/index.js';
import { createDropdown } from '../../core/dropdown.js';

// The background-script "Output format" picker (custom dropdown), created lazily
// in initBgConfig and read by readBgConfigForm.
let bgFormatDD = null;

// ── Per-instance tool registry ───────────────────────────────────────────────
// { key, label, icon, requires:[capKey], minInstances, enabled?, enter(instanceId) }
//   requires      — capability keys an instance must carry for the icon to enable
//                   on that card
//   minInstances  — how many registered instances must carry ALL `requires` caps
//                   for the icon to enable (e.g. Schema Diff needs 2)
//   enabled()     — optional extra predicate (e.g. a Settings feature must be on)
//   enter(id)     — launch the tool with this instance as its primary/base; a
//                   multi-instance tool then lets the user add others from within
const _tools = [];

export function registerTool(def) {
  if (!def || !def.key) return;
  if (_tools.some(t => t.key === def.key)) return; // idempotent
  _tools.push({ requires: [], minInstances: 1, label: def.key, icon: '•', ...def });
  if (document.getElementById('landing-instances')) renderInstances();
}

/** Test helper — clears the tool registry so suites start from a clean slate. */
export function _resetTools() {
  _tools.length = 0;
}

// Sections shown on each card, derived from the instance's single JSON export.
const SECTION_DEFS = [
  {
    key: 'schema',
    label: 'Nodes',
    short: 'Nodes',
    count: e => e.data?._stats?.counts?.tables ?? e.data?.nodes?.length,
  },
  {
    key: 'plugins',
    label: 'Plugins',
    short: 'Plugins',
    count: e => e.data?._metadata?.plugins?.length,
  },
  {
    key: 'storeApps',
    label: 'Store apps',
    short: 'Store',
    count: e => e.data?._metadata?.storeApps?.length,
  },
  {
    key: 'customApps',
    label: 'Custom apps',
    short: 'Custom',
    count: e => e.data?._metadata?.customApps?.length,
  },
  {
    key: 'properties',
    label: 'Properties',
    short: 'Props',
    count: e => e.data?._metadata?.properties?.length,
  },
];

function formatExportDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

function instanceEligible(entry, requires) {
  return (requires || []).every(cap => entry.capabilities && entry.capabilities[cap]);
}

// Count registered instances carrying ALL the given capability keys.
function eligibleCount(requires) {
  return instancesState.instances.filter(e => instanceEligible(e, requires)).length;
}

// Whether a tool's icon is enabled on a given instance card, plus a reason when
// it is not (for the tooltip).
function toolState(tool, entry) {
  if (!instanceEligible(entry, tool.requires)) {
    return { ok: false, reason: `needs ${tool.requires.join(', ')}` };
  }
  if (eligibleCount(tool.requires) < tool.minInstances) {
    return {
      ok: false,
      reason: `needs ${tool.minInstances} instances with ${tool.requires.join(', ') || 'data'}`,
    };
  }
  if (tool.enabled && !tool.enabled()) {
    return { ok: false, reason: tool.disabledHint || `${tool.label} is unavailable` };
  }
  return { ok: true, reason: tool.label };
}

// ── Registration from files / demo ─────────────────────────────────────────

function deriveLabel(parsed, fileName) {
  const inst = parsed && parsed._instance;
  if (inst && typeof inst === 'object') {
    if (inst.instance_name) return inst.instance_name;
    if (inst.instance_url) return inst.instance_url;
  }
  if (typeof inst === 'string' && inst) return inst;
  return (fileName || 'Instance').replace(/\.json$/i, '');
}

// A short, human-readable disambiguator for an instance card. The instance name
// alone is not unique — the same instance can be exported multiple times (e.g.
// pre/post upgrade), so we surface the build + export timestamp to tell them
// apart. Returns '' when no useful metadata is present (older exports).
export function instanceSubtitle(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const parts = [];
  if (meta.build_name) parts.push(meta.build_name);
  if (meta.exported_at) {
    // Node emits ISO; the background script emits a GlideDateTime string
    // ('YYYY-MM-DD HH:MM:SS'). Both parse; fall back to the raw string.
    const d = new Date(meta.exported_at);
    parts.push(isNaN(d.getTime()) ? String(meta.exported_at) : d.toLocaleString());
  }
  return parts.join(' · ');
}

// Register parsed schema data as an instance and select it. Stays on landing.
function registerFromData(parsed, fileName, source) {
  const entry = addInstance({
    label: deriveLabel(parsed, fileName),
    source,
    fileName: fileName || null,
    data: parsed,
  });
  selectInstance(entry.id);
  refreshLanding();
  return entry;
}

function promptMultiPartLoad(manifest) {
  const expected = manifest.parts.map(p => p.fileName).sort();
  const msg =
    `This is a multi-part schema export (${manifest.parts.length} parts, ${(manifest.totalBytes / 1048576).toFixed(1)} MB total).\n\n` +
    `Select all of these part files in the next dialog:\n  ${expected.join('\n  ')}\n\n` +
    `Tip: in the file picker you can multi-select with Ctrl+click (Cmd+click on Mac).`;
  if (!confirm(msg + '\n\nOK to pick the part files now?')) return;
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.multiple = true;
  picker.addEventListener('change', ev => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    const byName = new Map(files.map(f => [f.name, f]));
    const missing = expected.filter(name => !byName.has(name));
    if (missing.length) {
      alert('Missing part files:\n' + missing.join('\n'));
      return;
    }
    (async () => {
      try {
        const ordered = manifest.parts.slice().sort((a, b) => a.idx - b.idx);
        const texts = [];
        for (const p of ordered) texts.push(await byName.get(p.fileName).text());
        const parsed = JSON.parse(texts.join(''));
        texts.length = 0;
        registerFromData(
          parsed,
          manifest.parts[0].fileName.replace(/\.part1\.json$/i, '.json'),
          'file'
        );
      } catch (err) {
        alert('Failed to stitch parts: ' + (err.message || err));
      }
    })();
  });
  picker.click();
}

async function loadFileList(files) {
  if (!files || !files.length) return;

  if (files.length === 1) {
    const f = files[0];
    const r = new FileReader();
    r.onload = ev => {
      const raw = ev.target.result;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed._manifest_version && Array.isArray(parsed.parts)) {
          promptMultiPartLoad(parsed);
          return;
        }
        registerFromData(parsed, f.name, 'file');
      } catch (err) {
        const msg = err.message || String(err);
        const posMatch = msg.match(/position (\d+)/i);
        let detail = msg;
        if (posMatch) {
          const pos = parseInt(posMatch[1]);
          const start = Math.max(0, pos - 40);
          const snippet = raw.slice(start, pos + 40).replace(/\n/g, '↵');
          const arrow = ' '.repeat(Math.min(pos - start, 40)) + '▲';
          detail = `${msg}\n\nNear position ${pos}:\n"…${snippet}…"\n  ${arrow}`;
        }
        alert('Could not load JSON file:\n\n' + detail);
      }
    };
    r.readAsText(f);
    return;
  }

  try {
    const byName = new Map(Array.from(files).map(f => [f.name, f]));
    const manifestFile = Array.from(files).find(f => /\.manifest\.json$/i.test(f.name));
    if (!manifestFile) {
      alert('Multiple files selected but none look like a schema manifest (*.manifest.json).');
      return;
    }
    const manifest = JSON.parse(await manifestFile.text());
    if (!manifest._manifest_version || !Array.isArray(manifest.parts)) {
      alert('Manifest is missing _manifest_version or parts.');
      return;
    }
    const missing = manifest.parts.map(p => p.fileName).filter(n => !byName.has(n));
    if (missing.length) {
      alert('Missing part files:\n' + missing.join('\n'));
      return;
    }
    const ordered = manifest.parts.slice().sort((a, b) => a.idx - b.idx);
    const texts = [];
    for (const p of ordered) texts.push(await byName.get(p.fileName).text());
    const parsed = JSON.parse(texts.join(''));
    texts.length = 0;
    registerFromData(parsed, manifestFile.name.replace(/\.manifest\.json$/i, '.json'), 'file');
  } catch (err) {
    alert('Failed to load multi-part schema:\n\n' + (err.message || err));
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function toolIcon(tool, entry) {
  const { ok, reason } = toolState(tool, entry);
  return h(
    'button',
    {
      class: 'ic-tool' + (ok ? '' : ' disabled'),
      dataTool: tool.key,
      disabled: !ok,
      title: ok ? tool.label : `${tool.label} — ${reason}`,
      onclick: ev => {
        ev.stopPropagation();
        if (ok) tool.enter(entry.id);
      },
    },
    tool.icon
  );
}

function sectionCountCells(entry) {
  return SECTION_DEFS.map(def => {
    const has = !!(entry.capabilities && entry.capabilities[def.key]);
    const c = has && entry.data ? def.count(entry) : null;
    const val = c != null ? String(c) : has ? '✓' : '—';
    return { def, has, val };
  });
}

// Swap an instance card's title for an inline text input (no popup). Commits on
// Enter or blur, cancels on Escape; either way the card is re-rendered.
function startInlineRename(entry, titleEl) {
  const input = h('input', {
    class: 'ic-title-edit',
    type: 'text',
    value: entry.label,
    onclick: ev => ev.stopPropagation(),
  });
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    if (save) {
      const name = input.value.trim();
      if (name) renameInstance(entry.id, name);
    }
    refreshLanding();
  };
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

function instanceCard(entry) {
  const restored = !entry.data; // persisted placeholder — needs a re-drop
  const meta = entry.meta || {};
  const titleEl = h('div', { class: 'ic-title', title: entry.label }, entry.label);

  const displayUrl = meta.instance_url ? meta.instance_url.replace(/^https?:\/\//, '') : null;
  const exportDate = formatExportDate(meta.exported_at);
  const cells = sectionCountCells(entry);

  return h(
    'div',
    { class: 'inst-card' + (restored ? ' restored' : ''), dataInstance: entry.id },
    // Header: title + rename/delete
    h(
      'div',
      { class: 'ic-head' },
      titleEl,
      h(
        'button',
        {
          class: 'ic-act ic-rename',
          title: 'Rename',
          onclick: ev => {
            ev.stopPropagation();
            startInlineRename(entry, titleEl);
          },
        },
        '✎'
      ),
      h(
        'button',
        {
          class: 'ic-act ic-remove',
          title: 'Remove',
          onclick: ev => {
            ev.stopPropagation();
            removeInstance(entry.id);
            refreshLanding();
          },
        },
        '×'
      )
    ),
    // URL row
    displayUrl ? h('div', { class: 'ic-url', title: meta.instance_url }, displayUrl) : null,
    // Release badge + export date
    meta.build_name || exportDate
      ? h(
          'div',
          { class: 'ic-release-row' },
          meta.build_name ? h('span', { class: 'ic-release-badge' }, meta.build_name) : null,
          exportDate ? h('span', { class: 'ic-export-date' }, exportDate) : null
        )
      : null,
    // Count grid: labels row + values row
    h(
      'div',
      { class: 'ic-count-grid' },
      cells.map(({ def, has }) =>
        h('span', { class: 'ic-count-label' + (has ? '' : ' absent'), title: def.label }, def.short)
      ),
      cells.map(({ def, has, val }) =>
        h('span', { class: 'ic-count-val' + (has ? '' : ' absent'), title: def.label }, val)
      )
    ),
    // Footer
    restored
      ? h('div', { class: 'ic-note' }, 'remembered — re-drop file to restore')
      : h(
          'div',
          { class: 'ic-tools' },
          _tools.map(t => toolIcon(t, entry))
        )
  );
}

function addCard() {
  return h(
    'div',
    {
      class: 'inst-card add-card',
      id: 'add-instance',
      role: 'button',
      tabindex: '0',
      title: 'Add an instance export',
      onclick: () => document.getElementById('file-input')?.click(),
    },
    h('div', { class: 'add-plus' }, '+'),
    h('div', { class: 'add-label' }, 'Add instance'),
    h(
      'button',
      {
        class: 'add-demo',
        id: 'btn-demo',
        onclick: ev => {
          ev.stopPropagation();
          registerFromData(DEMO_DATA, null, 'demo');
        },
      },
      'or load demo'
    )
  );
}

export function renderInstances() {
  const host = document.getElementById('landing-instances');
  if (!host) return;
  host.textContent = '';
  instancesState.instances.forEach(e => host.appendChild(instanceCard(e)));
  host.appendChild(addCard());
}

// Footer chip on the landing page: a roster of every registered instance, since
// nothing is "selected" here. Reuses #footer-instance (the tool views repopulate
// it with the active / base→compare instance). Informational, not clickable.
function updateLandingFooterRoster() {
  const pill = document.getElementById('footer-instance');
  const nameEl = document.getElementById('footer-instance-name');
  const buildEl = document.getElementById('footer-instance-build');
  if (!pill || !nameEl || !buildEl) return;
  const insts = instancesState.instances;
  if (!insts.length) {
    pill.classList.remove('is-visible', 'footer-instance--roster');
    return;
  }
  const names = insts.map(e => e.label);
  nameEl.textContent = insts.length + (insts.length === 1 ? ' instance' : ' instances');
  // All names in one chip — the text ellipsis-truncates when there are many; the
  // full list is in the tooltip. (No fixed cap, so it scales to any count.)
  buildEl.textContent = '· ' + names.join(' · ');
  pill.title = 'Registered instances: ' + names.join(', ');
  pill.classList.add('is-visible', 'footer-instance--roster');
}

export function refreshLanding() {
  renderInstances();
  updateLandingFooterRoster();
}

// ── Setup-instructions UI (relocated from load) ─────────────────────────────

function copyCode(btn) {
  const pre = btn.closest('.code-block').querySelector('pre');
  navigator.clipboard
    .writeText(pre.textContent.trim())
    .then(() => {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      btn.style.color = 'var(--sn-wasabi)';
      btn.style.borderColor = 'var(--sn-wasabi)';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 1800);
    })
    .catch(() => {
      btn.textContent = 'Error';
      setTimeout(() => {
        btn.textContent = 'Copy';
      }, 1500);
    });
}

// ── Background-script config UI ──────────────────────────────────────────────
//
// The setup section lets the user tweak the most common CONFIG fields of the
// background exporter before copying it. We keep the bg script itself the single
// source of truth: rather than templating a CONFIG block, we rewrite only the
// known field lines INSIDE the `var CONFIG = { … }` block of the displayed
// source. Always derived from the pristine original so edits are idempotent.

/**
 * Return the bg script source with the given config applied. Pure + exported
 * for unit testing. Unknown/absent fields are left untouched; if the CONFIG
 * block can't be located the source is returned unchanged.
 */
export function applyBgConfig(source, cfg) {
  const start = source.indexOf('var CONFIG = {');
  if (start === -1) return source;
  const end = source.indexOf('\n};', start);
  if (end === -1) return source;
  let block = source.slice(start, end);

  const setStr = (field, val) =>
    (block = block.replace(new RegExp(`(\\n\\s*${field}:\\s*)'[^']*'`), `$1'${val}'`));
  const setBool = (field, val) =>
    (block = block.replace(new RegExp(`(\\n\\s*${field}:\\s*)(?:true|false)`), `$1${val}`));
  const setArr = (field, arr) => {
    const list = arr.map(v => `'${v}'`).join(', ');
    block = block.replace(
      new RegExp(`(\\n\\s*${field}:\\s*)\\[[^\\]]*\\]`),
      (_, prefix) => `${prefix}[${list}]`
    );
  };

  if (cfg.format) setStr('format', cfg.format);
  if (typeof cfg.includeRecordCounts === 'boolean')
    setBool('includeRecordCounts', cfg.includeRecordCounts);
  if (typeof cfg.includePropertyValues === 'boolean')
    setBool('includePropertyValues', cfg.includePropertyValues);
  if (Array.isArray(cfg.metadataSections)) setArr('metadataSections', cfg.metadataSections);
  if (Array.isArray(cfg.edgeTypes)) setArr('edgeTypes', cfg.edgeTypes);
  if (Array.isArray(cfg.recordCountExclude)) setArr('recordCountExclude', cfg.recordCountExclude);
  if (cfg.propertyValueDenylist != null) {
    // Stored in source as a regex literal — replace the pattern between the slashes.
    block = block.replace(
      /([\n\s]*propertyValueDenylist:\s*)\/[^/]*\/i/,
      `$1/${cfg.propertyValueDenylist}/i`
    );
  }
  if (cfg.propertyEncodedQuery != null) setStr('propertyEncodedQuery', cfg.propertyEncodedQuery);

  return source.slice(0, start) + block + source.slice(end);
}

// Read the current form state out of the #bg-config panel.
function readBgConfigForm(root) {
  const checked = field => {
    const el = root.querySelector(`[data-bg="${field}"]`);
    return el ? el.checked : false;
  };
  const textVal = field => {
    const el = root.querySelector(`[data-bg="${field}"]`);
    return el ? el.value.trim() : null;
  };
  const groupValues = group =>
    [...root.querySelectorAll(`[data-bg-group="${group}"] input:checked`)].map(i => i.value);
  const rawExclude = textVal('recordCountExclude');
  const recordCountExclude = rawExclude
    ? rawExclude
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : [];
  return {
    format: bgFormatDD ? bgFormatDD.getValue() : 'json',
    includeRecordCounts: checked('includeRecordCounts'),
    includePropertyValues: checked('includePropertyValues'),
    metadataSections: groupValues('metadataSections'),
    edgeTypes: groupValues('edgeTypes'),
    recordCountExclude,
    propertyValueDenylist: textVal('propertyValueDenylist'),
    propertyEncodedQuery: textVal('propertyEncodedQuery'),
  };
}

let _bgConfigInited = false;
function initBgConfig() {
  const panel = document.getElementById('bg-config');
  const pre = document.getElementById('code-bg');
  if (!panel || !pre) return;
  if (_bgConfigInited) return;
  _bgConfigInited = true;
  const original = pre.textContent;

  // Update visibility of rows that have a data-bg-show dependency.
  // data-bg-show="includeRecordCounts" → show when that checkbox is checked.
  // data-bg-show="properties" → show when the "properties" metadata section toggle is checked.
  const updateVisibility = () => {
    panel.querySelectorAll('[data-bg-show]').forEach(el => {
      const key = el.dataset.bgShow;
      let visible;
      const directCb = panel.querySelector(`[data-bg="${key}"]`);
      if (directCb) {
        visible = directCb.checked;
      } else {
        // treat as a metadataSections value
        const sectionCb = panel.querySelector(
          `[data-bg-group="metadataSections"] input[value="${key}"]`
        );
        visible = sectionCb ? sectionCb.checked : false;
      }
      el.style.display = visible ? '' : 'none';
    });
  };

  const rerender = () => {
    updateVisibility();
    pre.textContent = applyBgConfig(original, readBgConfigForm(panel));
  };

  // Output-format picker is a custom dropdown (app-themed); the rest of the
  // panel (toggles) still rerenders via change-event delegation.
  const fmtMount = panel.querySelector('[data-bg-mount="format"]');
  if (fmtMount && !bgFormatDD) {
    bgFormatDD = createDropdown({ ariaLabel: 'Output format', onChange: rerender });
    bgFormatDD.setOptions(
      [
        { value: 'json', label: 'JSON (viewer-ready)' },
        { value: 'markdown', label: 'Markdown' },
        { value: 'jsonld', label: 'JSON-LD' },
      ],
      'json'
    );
    fmtMount.appendChild(bgFormatDD.el);
  }
  panel.addEventListener('change', rerender);
  // Set initial visibility and render with the checked defaults.
  rerender();
}

// ── Export wizard ────────────────────────────────────────────────────────────

// Custom dropdown for the Node.js output-format picker, created lazily.
let nodeFormatDD = null;
let _nodeConfigInited = false;

function showWizStep(id) {
  document.querySelectorAll('.wiz-step').forEach(el => {
    el.hidden = el.id !== id;
  });
}

const ALL_NODE_EDGE_TYPES = ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel'];

function buildNodeCommand() {
  const instance = (document.getElementById('node-instance')?.value || '').trim();
  const user = (document.getElementById('node-user')?.value || '').trim();
  const authEl = document.querySelector('input[name="node-auth"]:checked');
  const auth = authEl ? authEl.value : 'basic';
  const format = nodeFormatDD ? nodeFormatDD.getValue() : 'json';
  const recordCounts = document.getElementById('node-record-counts')?.checked;
  const meta = [...document.querySelectorAll('.node-meta:checked')].map(i => i.value);
  const propValues = document.getElementById('node-prop-values')?.checked;
  const propDenylist = (document.getElementById('node-prop-denylist')?.value || '').trim();
  const propQuery = (document.getElementById('node-prop-query')?.value || '').trim();
  const edgeTypes = [...document.querySelectorAll('.node-edge:checked')].map(i => i.value);

  const lines = [];
  if (auth === 'basic') {
    lines.push('# Set your password — never pass it on the command line');
    lines.push('export SN_PASSWORD=<your-password>');
  } else {
    lines.push('# Set your API key — never pass it on the command line');
    lines.push('export SN_APIKEY=<your-api-key>');
  }
  lines.push('');

  const cmd = ['node sn-schema-export.js'];
  if (instance) cmd.push(`  --instance=${instance}`);
  else cmd.push('  --instance=https://your-instance.service-now.com');
  if (auth === 'basic') cmd.push(`  --user=${user || 'admin'}`);
  if (format !== 'json') cmd.push(`  --format=${format}`);
  if (recordCounts) cmd.push('  --include-record-counts');
  if (meta.length && meta.length < 4) cmd.push(`  --metadata=${meta.join(',')}`);
  if (propValues) cmd.push('  --include-property-values');
  const defaultDenylist = 'password|secret|key|token|cred|private|passwd';
  if (propValues && propDenylist && propDenylist !== defaultDenylist)
    cmd.push(`  --property-value-denylist=${propDenylist}`);
  if (propQuery) cmd.push(`  --property-query=${propQuery}`);
  if (edgeTypes.length && edgeTypes.length < ALL_NODE_EDGE_TYPES.length)
    cmd.push(`  --edge-types=${edgeTypes.join(',')}`);

  lines.push(cmd.join(' \\\n'));
  return lines.join('\n');
}

function updateNodeCommand() {
  const pre = document.getElementById('node-cmd-preview');
  if (pre) pre.textContent = buildNodeCommand();

  const auth = document.querySelector('input[name="node-auth"]:checked')?.value;
  const userRow = document.getElementById('node-user-row');
  if (userRow) userRow.style.display = auth === 'apikey' ? 'none' : '';

  const hasProps = document.querySelector('.node-meta[value="properties"]')?.checked;
  const hasPropValues = document.getElementById('node-prop-values')?.checked;
  const propValRow = document.getElementById('node-prop-values-row');
  if (propValRow) propValRow.style.display = hasProps ? '' : 'none';
  const propDenylistRow = document.getElementById('node-prop-denylist-row');
  if (propDenylistRow) propDenylistRow.style.display = hasProps && hasPropValues ? '' : 'none';
  const propQueryRow = document.getElementById('node-prop-query-row');
  if (propQueryRow) propQueryRow.style.display = hasProps ? '' : 'none';

  // Edge types only relevant for non-JSON output formats
  const format = nodeFormatDD ? nodeFormatDD.getValue() : 'json';
  const edgeSet = document.getElementById('node-edge-types-set');
  if (edgeSet) edgeSet.style.display = format === 'json' ? 'none' : '';
}

function initNodeConfig() {
  const panel = document.getElementById('node-config');
  if (!panel) return;
  if (_nodeConfigInited) return;
  _nodeConfigInited = true;

  const fmtMount = panel.querySelector('[data-node-mount="format"]');
  if (fmtMount && !nodeFormatDD) {
    nodeFormatDD = createDropdown({ ariaLabel: 'Output format', onChange: updateNodeCommand });
    nodeFormatDD.setOptions(
      [
        { value: 'json', label: 'JSON (Schema Explorer format)' },
        { value: 'markdown', label: 'Markdown (standalone)' },
        { value: 'jsonld', label: 'JSON-LD (standalone)' },
        { value: 'owl', label: 'OWL/Turtle (standalone)' },
        { value: 'openapi', label: 'OpenAPI YAML (standalone)' },
      ],
      'json'
    );
    fmtMount.appendChild(nodeFormatDD.el);
  }

  panel.addEventListener('change', updateNodeCommand);
  panel.addEventListener('input', updateNodeCommand);
  updateNodeCommand();
}

function openExportWizard() {
  const overlay = document.getElementById('export-wizard-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  showWizStep('wiz-1');
  // Initialise configs lazily on first open (DOM is present after first open)
  initBgConfig();
  initNodeConfig();
}

function closeExportWizard() {
  const overlay = document.getElementById('export-wizard-overlay');
  if (overlay) overlay.hidden = true;
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initLanding() {
  // Built-in tool: Schema Explorer — visualise a single instance's schema.
  registerTool({
    key: 'schemaExplorer',
    label: 'Open in Schema Explorer',
    icon: '◎',
    requires: ['schema'],
    enter: id => {
      if (selectInstanceForGraph(id)) setWorkspace('schema-explorer');
    },
  });

  const fileInput = document.getElementById('file-input');
  if (fileInput)
    fileInput.addEventListener('change', e => {
      loadFileList(e.target.files);
      // Reset so re-selecting the SAME file fires `change` again — otherwise the
      // value is unchanged and the event never fires, silently blocking re-import
      // (e.g. drop a file, delete the instance, then pick the same file again).
      e.target.value = '';
    });

  // Drag & drop anywhere on the instance grid registers an instance.
  const grid = document.getElementById('landing-instances');
  if (grid) {
    grid.addEventListener('dragover', e => {
      e.preventDefault();
      grid.classList.add('dragover');
    });
    grid.addEventListener('dragleave', () => grid.classList.remove('dragover'));
    grid.addEventListener('drop', e => {
      e.preventDefault();
      grid.classList.remove('dragover');
      loadFileList(e.dataTransfer.files);
    });
  }

  // Home button — return to the landing page from any tool.
  const home = document.getElementById('btn-home');
  if (home) home.addEventListener('click', () => setWorkspace('landing'));

  // Export wizard: open button
  document.getElementById('btn-export-wizard')?.addEventListener('click', openExportWizard);

  // Export wizard: close button + overlay backdrop click + Escape key
  document.getElementById('export-wizard-close')?.addEventListener('click', closeExportWizard);
  document.getElementById('export-wizard-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeExportWizard();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('export-wizard-overlay')?.hidden) {
      closeExportWizard();
    }
  });

  // Export wizard: step navigation (back/next buttons + method cards)
  document.addEventListener('click', e => {
    const goto = e.target.closest('[data-wiz-goto]');
    if (goto) {
      showWizStep(goto.dataset.wizGoto);
      // When navigating to the Node step 3, refresh the command preview
      if (goto.dataset.wizGoto === 'wiz-3-node') updateNodeCommand();
      return;
    }
    const method = e.target.closest('[data-wiz-method]');
    if (method) {
      showWizStep(method.dataset.wizMethod === 'bg' ? 'wiz-2-bg' : 'wiz-2-node');
    }
  });

  // Code copy buttons (wizard steps)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.code-copy-btn');
    if (btn) copyCode(btn);
  });

  // Node command copy button
  document.getElementById('node-cmd-copy')?.addEventListener('click', () => {
    const pre = document.getElementById('node-cmd-preview');
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent.trim()).then(() => {
      const btn = document.getElementById('node-cmd-copy');
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      btn.style.color = 'var(--sn-wasabi)';
      setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1800);
    });
  });

  onWorkspaceChange(ws => {
    if (ws === 'landing') refreshLanding();
  });

  refreshLanding();
}

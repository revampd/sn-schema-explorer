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
    label: 'Schema',
    short: 'Schema',
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

export function refreshLanding() {
  renderInstances();
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
    block = block.replace(new RegExp(`(\\n\\s*${field}:\\s*)\\[[^\\]]*\\]`), `$1[${list}]`);
  };

  if (cfg.format) setStr('format', cfg.format);
  if (typeof cfg.includeRecordCounts === 'boolean')
    setBool('includeRecordCounts', cfg.includeRecordCounts);
  if (typeof cfg.printToScriptOutput === 'boolean')
    setBool('printToScriptOutput', cfg.printToScriptOutput);
  if (typeof cfg.includePropertyValues === 'boolean')
    setBool('includePropertyValues', cfg.includePropertyValues);
  if (Array.isArray(cfg.metadataSections)) setArr('metadataSections', cfg.metadataSections);
  if (Array.isArray(cfg.edgeTypes)) setArr('edgeTypes', cfg.edgeTypes);

  return source.slice(0, start) + block + source.slice(end);
}

// Read the current form state out of the #bg-config panel.
function readBgConfigForm(root) {
  const checked = field => {
    const el = root.querySelector(`[data-bg="${field}"]`);
    return el ? el.checked : false;
  };
  const groupValues = group =>
    [...root.querySelectorAll(`[data-bg-group="${group}"] input:checked`)].map(i => i.value);
  const fmtEl = root.querySelector('[data-bg="format"]');
  return {
    format: fmtEl ? fmtEl.value : 'json',
    includeRecordCounts: checked('includeRecordCounts'),
    printToScriptOutput: checked('printToScriptOutput'),
    includePropertyValues: checked('includePropertyValues'),
    metadataSections: groupValues('metadataSections'),
    edgeTypes: groupValues('edgeTypes'),
  };
}

function initBgConfig() {
  const panel = document.getElementById('bg-config');
  const pre = document.getElementById('code-bg');
  if (!panel || !pre) return;
  const original = pre.textContent;
  const rerender = () => {
    pre.textContent = applyBgConfig(original, readBgConfigForm(panel));
  };
  panel.addEventListener('change', rerender);
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

  // Setup-instructions code copy (the accordion is the outer <details>).
  document
    .querySelectorAll('.code-copy-btn')
    .forEach(btn => btn.addEventListener('click', e => copyCode(e.currentTarget)));

  // Background-script CONFIG editor — rewrites the displayed bg source on change.
  initBgConfig();

  onWorkspaceChange(ws => {
    if (ws === 'landing') refreshLanding();
  });

  refreshLanding();
}

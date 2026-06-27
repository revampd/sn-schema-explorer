/* ============================================================================
 * landing/index.js — the front door (v1.0.3)
 * ============================================================================
 *
 * The landing workspace is where the user registers one or more instance
 * exports and picks a tool. It owns the file-drop / demo / manifest-stitching
 * UI (relocated from modules/load) and turns each load into a registry entry
 * (core/instances-state). Tools register a tile here and are gated by the
 * aggregate capabilities of the registered instances.
 *
 * Loading a file always REGISTERS and stays on the landing page (the user
 * explicitly enters a tool via its tile), so the multi-instance flow is
 * uniform: drop several exports, then pick a tool that has enough data to run.
 *
 * Tool tiles self-register via registerTool(...) — the same plug-in spirit as
 * Settings.registerFeature / registerWorkspace — so future tools light up here
 * without the landing module knowing about them.
 * ============================================================================ */

import {
  instancesState,
  addInstance,
  removeInstance,
  renameInstance,
  selectInstance,
  aggregateCapabilities,
  METADATA_SECTIONS,
} from '../../core/state.js';
import { DEMO_DATA } from '../../core/constants.js';
import { h } from '../../core/template.js';
import { setWorkspace, onWorkspaceChange } from '../../engine/workspace.js';
import { selectInstanceForGraph } from '../load/index.js';

// ── Tool-tile registry ───────────────────────────────────────────────────────
// { key, label, description, requires:[capKey], minInstances, workspace, enter }
//   requires      — capability keys an instance must carry to count toward this tool
//   minInstances  — how many registered instances must carry ALL `requires` caps
//   enter(targetId) — invoked on click; targetId is the resolved eligible
//                     instance (selected, else first eligible) for single-instance
//                     tools, or null for tools that read the whole registry.
const _tools = [];

export function registerTool(def) {
  if (!def || !def.key) return;
  if (_tools.some(t => t.key === def.key)) return; // idempotent
  _tools.push({
    requires: [],
    minInstances: 1,
    description: '',
    ...def,
  });
  // If the landing page is already rendered, reflect the new tile immediately.
  if (document.getElementById('landing-tools')) renderTools();
}

/** Test helper — clears the tool registry so suites start from a clean slate. */
export function _resetTools() {
  _tools.length = 0;
}

// Capability labels for instance-row badges.
const CAP_LABELS = {
  schema: 'Schema',
  plugins: 'Plugins',
  storeApps: 'Store',
  customApps: 'Custom',
  properties: 'Properties',
};

// Count registered instances carrying ALL the given capability keys.
function eligibleCount(requires) {
  if (!requires || !requires.length) return instancesState.instances.length;
  return instancesState.instances.filter(e =>
    requires.every(cap => e.capabilities && e.capabilities[cap])
  ).length;
}

// Resolve the instance a single-instance tool should act on: the selected one
// if it qualifies, otherwise the first eligible instance.
function resolveTarget(requires) {
  const qualifies = e => requires.every(cap => e.capabilities && e.capabilities[cap]);
  const sel = instancesState.selectedId
    ? instancesState.instances.find(e => e.id === instancesState.selectedId)
    : null;
  if (sel && qualifies(sel)) return sel.id;
  const first = instancesState.instances.find(qualifies);
  return first ? first.id : null;
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

// Register parsed schema data as an instance and select it (so a single-file
// load is one click from entering a tool). Stays on the landing page.
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

function badgeRow(caps) {
  const keys = ['schema', ...METADATA_SECTIONS].filter(k => caps && caps[k]);
  if (!keys.length) return h('span', { class: 'li-badge li-badge-empty' }, 'no data');
  return keys.map(k => h('span', { class: 'li-badge li-badge-' + k }, CAP_LABELS[k] || k));
}

function instanceRow(entry) {
  const selected = entry.id === instancesState.selectedId;
  const restored = !entry.data; // persisted placeholder — needs a re-drop
  return h(
    'div',
    {
      class: 'landing-instance' + (selected ? ' selected' : '') + (restored ? ' restored' : ''),
      dataInstance: entry.id,
      role: 'button',
      tabindex: '0',
      title: restored ? 'Re-drop this export to restore it' : 'Select this instance',
      onclick: () => {
        if (restored) return;
        selectInstance(entry.id);
        refreshLanding();
      },
    },
    h(
      'div',
      { class: 'li-main' },
      h('div', { class: 'li-label' }, entry.label),
      h('div', { class: 'li-badges' }, badgeRow(entry.capabilities)),
      restored ? h('div', { class: 'li-note' }, 'remembered — re-drop file to restore') : null
    ),
    h(
      'div',
      { class: 'li-actions' },
      h(
        'button',
        {
          class: 'li-btn li-rename',
          title: 'Rename',
          onclick: ev => {
            ev.stopPropagation();
            const name = prompt('Rename instance:', entry.label);
            if (name != null) {
              renameInstance(entry.id, name.trim());
              refreshLanding();
            }
          },
        },
        '✎'
      ),
      h(
        'button',
        {
          class: 'li-btn li-remove',
          title: 'Remove',
          onclick: ev => {
            ev.stopPropagation();
            removeInstance(entry.id);
            refreshLanding();
          },
        },
        '×'
      )
    )
  );
}

export function renderInstances() {
  const host = document.getElementById('landing-instances');
  if (!host) return;
  host.textContent = '';
  if (!instancesState.instances.length) {
    host.appendChild(
      h(
        'div',
        { class: 'landing-empty' },
        'No instances yet — drop a schema export above to begin.'
      )
    );
    return;
  }
  instancesState.instances.forEach(e => host.appendChild(instanceRow(e)));
}

function toolTile(tool) {
  const eligible = eligibleCount(tool.requires);
  const enabled = eligible >= tool.minInstances;
  const need =
    tool.minInstances > 1
      ? `needs ${tool.minInstances} instances with ${tool.requires.join(', ') || 'data'}`
      : `needs an instance with ${tool.requires.join(', ') || 'data'}`;
  return h(
    'button',
    {
      class: 'landing-tool' + (enabled ? '' : ' disabled'),
      dataTool: tool.key,
      disabled: !enabled,
      title: enabled ? tool.description : need,
      onclick: () => {
        if (!enabled) return;
        const target = resolveTarget(tool.requires);
        tool.enter(target);
      },
    },
    h('div', { class: 'lt-label' }, tool.label),
    h('div', { class: 'lt-desc' }, enabled ? tool.description : need)
  );
}

export function renderTools() {
  const host = document.getElementById('landing-tools');
  if (!host) return;
  host.textContent = '';
  _tools.forEach(t => host.appendChild(toolTile(t)));
}

export function refreshLanding() {
  renderInstances();
  renderTools();
}

// ── Setup-instructions UI (relocated from load) ─────────────────────────────

function toggleSetupGuide(btn) {
  const bodyId = btn.id.replace('sg-toggle-', 'sg-body-');
  const body = document.getElementById(bodyId);
  const open = btn.classList.toggle('open');
  if (body) body.classList.toggle('open', open);
}

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

// ── Init ─────────────────────────────────────────────────────────────────────

export function initLanding() {
  // Built-in tool: Schema Explorer — visualise a single instance's schema.
  registerTool({
    key: 'schemaExplorer',
    label: 'Schema Explorer',
    description: "Visualise a single instance's table schema, references & CMDB topology.",
    requires: ['schema'],
    minInstances: 1,
    workspace: 'schema-explorer',
    enter: targetId => {
      if (!targetId) return;
      if (selectInstanceForGraph(targetId)) setWorkspace('schema-explorer');
    },
  });

  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.addEventListener('change', e => loadFileList(e.target.files));

  const btnDemo = document.getElementById('btn-demo');
  if (btnDemo) btnDemo.addEventListener('click', () => registerFromData(DEMO_DATA, null, 'demo'));

  const dz = document.getElementById('drop-zone');
  if (dz) {
    dz.addEventListener('dragover', e => {
      e.preventDefault();
      dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('dragover');
      loadFileList(e.dataTransfer.files);
    });
  }

  // Home button — return to the landing page from any tool.
  const home = document.getElementById('btn-home');
  if (home) home.addEventListener('click', () => setWorkspace('landing'));

  // Setup-instructions toggle + code copy (relocated from the load overlay).
  document
    .getElementById('sg-toggle-file')
    ?.addEventListener('click', e => toggleSetupGuide(e.currentTarget));
  document
    .querySelectorAll('.code-copy-btn')
    .forEach(btn => btn.addEventListener('click', e => copyCode(e.currentTarget)));

  // Keep the list/tiles fresh whenever the user returns to the landing page.
  onWorkspaceChange(ws => {
    if (ws === 'landing') refreshLanding();
  });

  refreshLanding();
}

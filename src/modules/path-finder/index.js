import { graphState, uiState, focusState } from '../../core/state.js';
import { Settings } from '../settings/index.js';
import { Dom } from '../../core/dom.js';
import { h } from '../../core/template.js';
import { Config } from '../../core/constants.js';
import { Pathfinding } from './pathfinding.js';
import { render, updateInstancePill, setModeRenderer } from '../../core/render.js';
import { fillInspector, clearSelection, initInspectorDeps } from '../../core/inspector.js';
import { clearIndicators } from '../../core/indicators.js';
import { buildTableList } from '../../core/table-list.js';
import { syncSidebarForMode } from '../../core/sidebar-sync.js';
import { setViewMode, onViewModeChange, registerModeValidator } from '../../core/view-mode.js';
import { setWorkspace, getWorkspace } from '../../core/workspace.js';
import { registerSwitcherTool, refreshToolSwitcher } from '../../core/tool-switcher.js';
import { registerTool, refreshLanding } from '../landing/index.js';
import { selectInstanceForGraph } from '../load/index.js';
import { instancesState, getInstance } from '../../core/instances-state.js';
import { getPfConfig, pfConfigSyncVisibility, pfConfigWireInputs } from './config.js';
import { initExclusions } from './exclusions.js';
import { pfState } from './pf-state.js';
import { renderPathView, pfRenderResults, pfClearHighlight } from './path-view.js';

// ── Settings registrations ───────────────────────────────────────────────────

Settings.registerFeature({
  key: 'pathFinding',
  label: 'Path Finder',
  description:
    'Adds a third view mode that finds shortest dot-walk paths between tables or from a table to a field. Inheritance-aware: paths through extends edges cost nothing because ancestor fields are directly accessible. Shows up to 5 alternative paths for fallback when fields may be unpopulated.',
  baseline: true,
  category: 'features',
});

Settings.registerFeature({
  key: 'advancedPathFinder',
  label: 'Advanced Path Finder configuration',
  description:
    'Adds a Configuration panel at the top of the Path Finder sidebar (visible when Path Finder is also enabled) for tuning the search: minimum path length, maximum path length, and how many alternative paths to return. Default values match the standard behaviour (1 step minimum, 10 maximum, 5 alternatives).',
  baseline: true,
  category: 'experimental',
});

// ── Path-view state ──────────────────────────────────────────────────────────

let _pfMode = 'table';

// Auto-refresh the current search result whenever exclusions change (if inputs are filled)
function pfAutoRefreshSearch() {
  const btn = document.getElementById('pf-find');
  if (btn && !btn.disabled) pfRunSearch();
}

// Re-run the current search after a config change, but only when results already show.
function pfReRunIfActive() {
  if (pfState.paths && pfState.paths.length) {
    const findBtn = document.getElementById('pf-find');
    if (findBtn && !findBtn.disabled) findBtn.click();
  }
}

// Register path view renderer
setModeRenderer('path', renderPathView);

// ── Mode change registration ──────────────────────────────────────────────────

registerModeValidator(mode => mode !== 'path' || Settings.isEnabled('pathFinding'));

onViewModeChange((mode, prevMode) => {
  Dom.simControls.classList.remove('visible');
  Dom.layoutProgress.style.display = 'none';
  clearIndicators();
  pfSyncSidebar();
  pfSyncCanvasOverlays();
  const emptyHint = Dom.inspectorEmpty;
  if (emptyHint) {
    if (mode === 'path') {
      emptyHint.textContent =
        'Find a path between tables, then tap a node in the result to inspect it.';
    } else {
      emptyHint.textContent = 'Tap a table node to inspect its fields, references & dependencies.';
    }
  }
  if (uiState.selectedNode && graphState.graphData) {
    const d = graphState.graphData.nodes.find(n => n.id === uiState.selectedNode);
    if (d) fillInspector(d);
    else {
      Dom.inspectorEmpty.style.display = '';
      Dom.inspectorContent.style.display = 'none';
    }
  } else {
    Dom.inspectorEmpty.style.display = '';
    Dom.inspectorContent.style.display = 'none';
  }
});

// ── Sidebar sync ─────────────────────────────────────────────────────────────

export function pfSyncSidebar() {
  if (!document.getElementById('pf-sidebar')) return;
  syncSidebarForMode();
  if (uiState.viewMode === 'path') {
    pfHydrateSourceFromFocus();
    pfValidate();
  }
}

// Hydrate the Path Finder source from the shared focus (#131): when entering the
// lens with a table focused, pre-fill the (empty) source so the user's place
// carries across. Never clobbers a source they've already typed, and only fills
// with a table that exists in the loaded graph.
function pfHydrateSourceFromFocus() {
  const srcEl = document.getElementById('pf-source');
  if (!srcEl || srcEl.value) return;
  const table = focusState.table;
  if (!table || !graphState.graphData) return;
  if (graphState.graphData.nodes.some(n => n.id === table)) srcEl.value = table;
}

// ── Canvas overlay sync ───────────────────────────────────────────────────────

export function pfSyncCanvasOverlays() {
  const af = document.getElementById('active-filter');
  const el = document.getElementById('edge-legend');
  const mm = document.getElementById('minimap');
  if (uiState.viewMode === 'path') {
    if (af) af.style.display = 'none';
    if (el) el.style.display = 'none';
    if (mm) mm.style.display = 'none';
  } else {
    if (el) el.style.display = 'block';
    if (mm) mm.style.display = '';
  }
}

// ── Path Finder core UI ───────────────────────────────────────────────────────

export function pfSetMode(mode) {
  _pfMode = mode;
  document.querySelectorAll('.pf-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const lbl = document.getElementById('pf-target-label');
  const inp = document.getElementById('pf-target');
  if (mode === 'field') {
    if (lbl) lbl.textContent = 'To field';
    if (inp) inp.placeholder = 'e.g. manufacturer';
  } else {
    if (lbl) lbl.textContent = 'To table';
    if (inp) inp.placeholder = 'e.g. core_company';
  }
  pfValidate();
  if (_onPfSetMode) _onPfSetMode(mode);
}

let _onPfSetMode = null;
export function onPfSetMode(fn) {
  _onPfSetMode = fn;
}

export function pfValidate() {
  const srcEl = document.getElementById('pf-source');
  const tgtEl = document.getElementById('pf-target');
  const src = srcEl ? srcEl.value.trim() : '';
  const tgt = tgtEl ? tgtEl.value.trim() : '';
  const btn = document.getElementById('pf-find');
  if (btn) btn.disabled = !(src && tgt && graphState.graphData);
}

export function pfRunSearch() {
  const srcEl = document.getElementById('pf-source');
  const tgtEl = document.getElementById('pf-target');
  const resBox = document.getElementById('pf-result');
  const src = srcEl ? srcEl.value.trim() : '';
  const tgtRaw = tgtEl ? tgtEl.value.trim() : '';
  resBox.replaceChildren();
  pfState.paths = [];
  pfState.activePathIdx = 0;
  pfState.fieldName = null;
  pfState.sourceId = null;
  if (uiState.viewMode === 'path') render();
  else pfClearHighlight();

  if (!graphState.graphData || !src || !tgtRaw) return;

  const srcNode = graphState.graphData.nodes.find(n => n.id === src);
  if (!srcNode) {
    resBox.appendChild(h('div', { class: 'pf-no-result' }, `Unknown table: ${src}`));
    return;
  }

  const advanced = Settings.isEnabled('advancedPathFinder');
  const pfConfig = getPfConfig();
  const minSteps = advanced ? pfConfig.minSteps : 1;
  const maxSteps = advanced ? pfConfig.maxSteps : Infinity;
  const wantCount = advanced ? pfConfig.maxResults : 5;
  const K = Math.min(20, wantCount + (minSteps > 1 ? 5 : 0));
  const filterAndTrim = rs =>
    rs.filter(r => r.steps.length >= minSteps && r.steps.length <= maxSteps).slice(0, wantCount);
  let results = [];

  if (_pfMode === 'table') {
    const tgtNode = graphState.graphData.nodes.find(n => n.id === tgtRaw);
    if (!tgtNode) {
      resBox.appendChild(h('div', { class: 'pf-no-result' }, `Unknown table: ${tgtRaw}`));
      return;
    }
    results = filterAndTrim(Pathfinding.tableToTableK(src, tgtRaw, K));
    if (!results.length) {
      resBox.appendChild(
        h(
          'div',
          { class: 'pf-no-result' },
          advanced
            ? `No path found between ${src} and ${tgtRaw} matching the current filter (min ${minSteps}, max ${maxSteps} steps). Try relaxing the configuration.`
            : `No path found between ${src} and ${tgtRaw} (they may not be connected in the schema).`
        )
      );
      return;
    }
    pfRenderResults(resBox, results, src, null);
    return;
  }

  // Field mode
  let fieldName = tgtRaw;
  let pinnedOwnerTable = null;
  if (tgtRaw.includes('.')) {
    const segs = tgtRaw.split('.');
    fieldName = segs[segs.length - 1];
    let cur = segs[0];
    if (!graphState.graphData.nodes.find(n => n.id === cur)) {
      resBox.appendChild(h('div', { class: 'pf-no-result' }, `Unknown table: ${cur}`));
      return;
    }
    for (let i = 1; i < segs.length - 1; i++) {
      const fname = segs[i];
      const ref = graphState.graphData.edges.find(e => {
        const s = e.source?.id ?? e.source;
        return s === cur && e.type === 'reference' && e.field === fname;
      });
      if (!ref) {
        resBox.appendChild(
          h(
            'div',
            { class: 'pf-no-result' },
            `Cannot resolve "${tgtRaw}" — ${cur} has no reference field "${fname}".`
          )
        );
        return;
      }
      cur = ref.target?.id ?? ref.target;
    }
    pinnedOwnerTable = cur;
    if (!Pathfinding.fieldDefinedAt(pinnedOwnerTable, fieldName)) {
      resBox.appendChild(
        h(
          'div',
          { class: 'pf-no-result' },
          `Field "${fieldName}" not found on table ${pinnedOwnerTable}.`
        )
      );
      return;
    }
  } else {
    const owners = Pathfinding.fieldOwners(fieldName);
    if (!owners.length) {
      resBox.appendChild(
        h('div', { class: 'pf-no-result' }, `Field "${fieldName}" not found on any table.`)
      );
      return;
    }
  }

  if (pinnedOwnerTable) {
    if (src === pinnedOwnerTable) {
      results = [
        {
          steps: [],
          path: [src],
          totalCost: 0,
          dotWalk: `${src}.${fieldName}`,
          fieldOwner: Pathfinding.fieldDefinedAt(src, fieldName),
          inheritedFromAncestor: Pathfinding.fieldDefinedAt(src, fieldName) !== src,
        },
      ];
    } else {
      const rawResults = filterAndTrim(Pathfinding.tableToTableK(src, pinnedOwnerTable, K));
      if (!rawResults.length) {
        resBox.appendChild(
          h(
            'div',
            { class: 'pf-no-result' },
            advanced
              ? `No path from ${src} to ${pinnedOwnerTable} matching the current filter (min ${minSteps}, max ${maxSteps} steps). Try relaxing the configuration.`
              : `No path from ${src} to ${pinnedOwnerTable}.`
          )
        );
        return;
      }
      const defAt = Pathfinding.fieldDefinedAt(pinnedOwnerTable, fieldName);
      results = rawResults.map(r => ({
        ...r,
        dotWalk: r.dotWalk + '.' + fieldName,
        fieldOwner: defAt,
        inheritedFromAncestor: defAt !== pinnedOwnerTable,
      }));
    }
  } else {
    results = filterAndTrim(Pathfinding.tableToFieldK(src, fieldName, K));
    if (!results.length) {
      resBox.appendChild(
        h(
          'div',
          { class: 'pf-no-result' },
          advanced
            ? `No path found from ${src} to a table with field "${fieldName}" matching the current filter (min ${minSteps}, max ${maxSteps} steps).`
            : `No path found from ${src} to a table with field "${fieldName}".`
        )
      );
      return;
    }
  }

  pfRenderResults(resBox, results, src, fieldName);
}

// ── Visibility sync ───────────────────────────────────────────────────────────

function pfSyncVisibility() {
  const enabled = Settings.isEnabled('pathFinding');
  // The Path Finder entry is shown/hidden by the header tool switcher's enabled()
  // gate; just refresh it, and leave path view if the feature was turned off.
  refreshToolSwitcher();
  refreshLanding();
  if (!enabled && uiState.viewMode === 'path') {
    setViewMode('force');
  }
}

// Schema-capable instance currently loaded? (gates the graph-view tools)
function pfSelectedHasSchema() {
  const e = instancesState.selectedId && getInstance(instancesState.selectedId);
  return !!(e && e.capabilities && e.capabilities.schema);
}

// Header tool switcher entry + landing instance-card tool.
registerSwitcherTool({
  key: 'path',
  label: 'Path Finder',
  icon: '⤳',
  order: 20,
  enabled: () => Settings.isEnabled('pathFinding') && pfSelectedHasSchema(),
  isActive: () => getWorkspace() === 'schema-explorer' && uiState.viewMode === 'path',
  activate: () => {
    setWorkspace('schema-explorer');
    setViewMode('path');
  },
});
registerTool({
  key: 'pathFinder',
  label: 'Open in Path Finder',
  icon: '⤳',
  requires: ['schema'],
  minInstances: 1,
  enabled: () => Settings.isEnabled('pathFinding'),
  disabledHint: 'Enable Path Finder in Settings',
  enter: id => {
    if (selectInstanceForGraph(id)) {
      setWorkspace('schema-explorer');
      setViewMode('path');
    }
  },
});

// ── Inspector field ⤳ link factory ──────────────────────────────────────────

function makeInspectorPathLink(fieldName, tableId) {
  if (!Settings.isEnabled('pathFinding')) return null;
  const btn = document.createElement('button');
  btn.className = 'insp-field-pflink';
  btn.title = `Find shortest path to .${fieldName}`;
  btn.textContent = '⤳';
  btn.dataset.field = fieldName;
  btn.dataset.fromTable = tableId;
  btn.addEventListener('click', ev => {
    ev.stopPropagation();
    // Switch to path view first (pfSyncSidebar pre-fills pf-source from
    // uiState.selectedNode).  Then, in the next animation frame once the
    // path view has painted, set the field-mode target and run the search.
    pfSetMode('field');
    setViewMode('path');
    requestAnimationFrame(() => {
      const src = document.getElementById('pf-source');
      const tgt = document.getElementById('pf-target');
      if (!src || !tgt) return;
      src.value = tableId;
      tgt.value = `${tableId}.${fieldName}`;
      pfValidate();
      pfRunSearch();
    });
  });
  return btn;
}

// ── Init ──────────────────────────────────────────────────────────────────────

pfConfigWireInputs({ onApply: pfReRunIfActive });
pfConfigSyncVisibility();
pfSyncVisibility();
Settings.onChange('pathFinding', pfSyncVisibility);
Settings.onChange('advancedPathFinder', pfConfigSyncVisibility);

// Hop exclusions — load persisted set, wire chips / add-input / "Clear all" / context-menu event
initExclusions({ onChange: pfAutoRefreshSearch });

// Inject the path-link factory into the inspector.
initInspectorDeps({ makePathLink: makeInspectorPathLink });

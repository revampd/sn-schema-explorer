// Dev-only diagnostics: when the `snse:debug` localStorage flag is set to '1',
// warn whenever a Dom id fails to resolve. This surfaces shell.html / dom.js
// drift (a renamed id otherwise fails silently as `null` and only blows up later
// with an opaque TypeError). Off by default, so the shipped build stays silent.
const _DOM_DEBUG = (() => {
  try {
    return localStorage.getItem('snse:debug') === '1';
  } catch {
    return false;
  }
})();
function _getById(id) {
  const el = document.getElementById(id);
  if (!el && _DOM_DEBUG) console.warn('[Dom] no element found for id #' + id);
  return el;
}

export const Dom = (() => {
  const g = _getById;
  return {
    canvas: g('canvas'),
    graphEl: g('graph'),
    loadOverlay: g('load-overlay'),
    sidebar: g('sidebar'),
    inspector: g('inspector'),
    inspectorContent: g('inspector-content'),
    inspectorEmpty: g('inspector-empty'),
    scrim: g('scrim'),
    statNodes: g('stat-nodes'),
    statEdges: g('stat-edges'),
    statRendered: g('stat-rendered'),
    statFocus: g('stat-focus'),
    slMaxNodes: g('sl-max-nodes'),
    slHopDepth: g('sl-hop-depth'),
    valMaxNodes: g('val-max-nodes'),
    valHopDepth: g('val-hop-depth'),
    densityGroup: g('density-group'),
    densityInfo: g('density-info'),
    sortBar: g('sort-bar'),
    sortBtnName: g('sort-btn-name'),
    sortBtnEdge: g('sort-btn-edge'),
    tableCount: g('table-count'),
    scopeInfoList: g('scope-info-list'),
    filterBar: g('filter-bar'),
    filterBadge: g('filter-badge'),
    filterBody: g('filter-body'),
    filterOpenBtn: g('scope-filter-btn'),
    tableList: g('table-list'),
    searchBox: g('search-box'),
    edgeLegend: g('edge-legend'),
    fieldLegend: g('field-legend'),
    minimap: g('minimap'),
    domIndicators: g('dom-indicators'),
    activeFilter: g('active-filter'),
    activeFilterBody: g('active-filter-body'),
    ctxMenu: g('ctx-menu'),
    ctxFocus: g('ctx-focus'),
    ctxDeselect: g('ctx-deselect'),
    ctxCopy: g('ctx-copy'),
    ctxSnlink: g('ctx-snlink'),
    simControls: g('sim-controls'),
    btnStopSim: g('btn-stop-sim'),
    btnLod: g('btn-lod'),
    btnHistBack: g('btn-hist-back'),
    btnHistFwd: g('btn-hist-fwd'),
    btnRefresh: g('btn-refresh'),
    btnReset: g('btn-reset'),
    btnExport: g('btn-export'),
    exportBar: g('export-bar'),
    btnFitM: g('btn-fit-m'),
    btnRefGuide: g('btn-ref-guide'),
    btnUserGuide: g('btn-user-guide'),
    btnSidebarCollapse: g('btn-sidebar-collapse'),
    btnInspectorCollapse: g('btn-inspector-collapse'),
    btnSidebarClose: g('btn-sidebar-close'),
    btnInspectorClose: g('btn-inspector-close'),
    btnSidebarToggle: g('btn-sidebar-toggle'),
    btnInspectorToggle: g('btn-inspector-toggle'),
    dropZone: g('drop-zone'),
    fileInput: g('file-input'),
    btnDemo: g('btn-demo'),
    layoutProgress: g('layout-progress'),
    layoutProgressFill: g('layout-progress-fill'),
    zIn: g('z-in'),
    zOut: g('z-out'),
    zFit: g('z-fit'),
    zFreeze: g('z-freeze'),
  };
})();

export function initLateDom() {
  Dom.refModal = _getById('ref-modal');
  Dom.guideModal = _getById('guide-modal');
  Dom.settingsModal = _getById('settings-modal');
  Dom.settingsModalBody = _getById('settings-modal-body');
  Dom.btnRefClose = _getById('btn-ref-close');
  Dom.btnGuideClose = _getById('btn-guide-close');
  Dom.btnSettings = _getById('btn-settings');
  Dom.btnSettingsClose = _getById('btn-settings-close');
}

export const Dom = (() => {
  const g = id => document.getElementById(id);
  return {
    canvas:          g('canvas'),
    graphEl:         g('graph'),
    loadOverlay:     g('load-overlay'),
    sidebar:         g('sidebar'),
    inspector:       g('inspector'),
    inspectorContent:g('inspector-content'),
    inspectorEmpty:  g('inspector-empty'),
    scrim:           g('scrim'),
    statNodes:       g('stat-nodes'),
    statEdges:       g('stat-edges'),
    statRendered:    g('stat-rendered'),
    statFocus:       g('stat-focus'),
    slMaxNodes:      g('sl-max-nodes'),
    slHopDepth:      g('sl-hop-depth'),
    valMaxNodes:     g('val-max-nodes'),
    valHopDepth:     g('val-hop-depth'),
    densityGroup:    g('density-group'),
    densityInfo:     g('density-info'),
    sortBar:         g('sort-bar'),
    sortBtnName:     g('sort-btn-name'),
    sortBtnEdge:     g('sort-btn-edge'),
    scopeInfoList:   g('scope-info-list'),
    filterPanel:     g('filter-panel'),
    filterBadge:     g('filter-badge'),
    filterBody:      g('filter-body'),
    filterOpenBtn:   g('scope-filter-btn'),
    tableList:       g('table-list'),
    searchBox:       g('search-box'),
    edgeLegend:      g('edge-legend'),
    fieldLegend:     g('field-legend'),
    minimap:         g('minimap'),
    domIndicators:   g('dom-indicators'),
    activeFilter:    g('active-filter'),
    activeFilterBody:g('active-filter-body'),
    ctxMenu:         g('ctx-menu'),
    ctxFocus:        g('ctx-focus'),
    ctxDeselect:     g('ctx-deselect'),
    ctxCopy:         g('ctx-copy'),
    ctxSnlink:       g('ctx-snlink'),
    simControls:     g('sim-controls'),
    btnStopSim:      g('btn-stop-sim'),
    btnLod:          g('btn-lod'),
    btnHistBack:     g('btn-hist-back'),
    btnHistFwd:      g('btn-hist-fwd'),
    btnRefresh:      g('btn-refresh'),
    btnReset:        g('btn-reset'),
    btnExport:       g('btn-export'),
    exportMenu:      g('export-menu'),
    btnFitM:         g('btn-fit-m'),
    btnRefGuide:     g('btn-ref-guide'),
    btnUserGuide:    g('btn-user-guide'),
    btnSidebarCollapse:  g('btn-sidebar-collapse'),
    btnInspectorCollapse:g('btn-inspector-collapse'),
    btnSidebarClose:     g('btn-sidebar-close'),
    btnInspectorClose:   g('btn-inspector-close'),
    btnSidebarToggle:    g('btn-sidebar-toggle'),
    btnInspectorToggle:  g('btn-inspector-toggle'),
    dropZone:   g('drop-zone'),
    fileInput:  g('file-input'),
    btnDemo:    g('btn-demo'),
    layoutProgress:     g('layout-progress'),
    layoutProgressFill: g('layout-progress-fill'),
    zIn:  g('z-in'),
    zOut: g('z-out'),
    zFit: g('z-fit'),
  };
})();

export function initLateDom() {
  Dom.refModal          = document.getElementById('ref-modal');
  Dom.guideModal        = document.getElementById('guide-modal');
  Dom.settingsModal     = document.getElementById('settings-modal');
  Dom.settingsModalBody = document.getElementById('settings-modal-body');
  Dom.btnRefClose       = document.getElementById('btn-ref-close');
  Dom.btnGuideClose     = document.getElementById('btn-guide-close');
  Dom.btnSettings       = document.getElementById('btn-settings');
  Dom.btnSettingsClose  = document.getElementById('btn-settings-close');
}

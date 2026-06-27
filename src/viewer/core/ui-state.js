import { Config } from './constants.js';

export const uiState = {
  selectedNode: null,
  // Workspace is a SIBLING of viewMode, not a 4th mode: it selects which
  // top-level tool is showing ('landing' | 'schema-explorer' |
  // 'instance-comparison'), while viewMode ('force'|'path'|'diff') stays the
  // graph sub-mode within the Schema Explorer workspace. The landing page is
  // the front door, so the app boots into it; render() early-returns on null
  // graphData, so nothing graph-related fires until an instance is selected.
  workspace: 'landing',
  viewMode: 'force',
  showLabels: false,
  showRefTo: true,
  showRefFrom: false,
  showExt: false,
  showM2M: false,
  showRel: false,
  showView: false,
  showCmdbRel: false,
  showFields: false,
  selectedScopes: new Set(),
  filterConditions: [],
  connectedNodes: new Set(),
  _lastInheritedSeeds: new Set(),
  compactMode: false,
  sortMode: 'name-asc',
  hiddenNodes: new Set(),
  inspSectionState: new Map(),
  maxNodes: null,
  hopDepth: null,
  _viewPositionCache: { force: null, diff: null },
  pfExcludedHops: new Set(),
};

uiState.maxNodes = Config.render.maxNodesDefault;
uiState.hopDepth = Config.render.hopDepthDefault;

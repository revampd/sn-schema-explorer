import { Config } from './constants.js';

export const uiState = {
  selectedNode:        null,
  viewMode:            'force',
  showLabels:          false,
  showRefTo:           true,
  showRefFrom:         false,
  showExt:             false,
  showM2M:             false,
  showRel:             false,
  showView:            false,
  showCmdbRel:         false,
  showFields:          false,
  selectedScopes:      new Set(),
  connectedNodes:      new Set(),
  _lastInheritedSeeds: new Set(),
  compactMode:         false,
  sortMode:            'name-asc',
  hiddenNodes:         new Set(),
  inspSectionState:    new Map(),
  maxNodes:            null,
  hopDepth:            null,
  _viewPositionCache:  { force: null, diff: null },
};

uiState.maxNodes = Config.render.maxNodesDefault;
uiState.hopDepth = Config.render.hopDepthDefault;

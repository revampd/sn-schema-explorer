import { SCOPE_PALETTE } from './constants.js';

export const graphState = {
  graphData:    null,
  simulation:   null,
  scopeColorMap:{},
  snInstance:   '',
};

export function buildScopeColorMap(nodes) {
  graphState.scopeColorMap = {};
  graphState.scopeColorMap['global'] = '#0EA5E9';
  let paletteIdx = 0;
  nodes.forEach(n => {
    if (graphState.scopeColorMap[n.scope]) return;
    if (n.scope === 'global') return;
    graphState.scopeColorMap[n.scope] = SCOPE_PALETTE[paletteIdx % SCOPE_PALETTE.length];
    paletteIdx++;
  });
}

export function nodeColor(n) {
  if (n.core) return '#63DF4E';
  return graphState.scopeColorMap[n.scope] ?? '#0EA5E9';
}

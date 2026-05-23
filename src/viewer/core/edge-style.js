export const EdgeStyle = (() => {
  const CSS_CLASS = Object.freeze({
    extends:'edge-extends', reference:'edge-ref',
    'ref-to':'edge-ref-to', 'ref-from':'edge-ref-from',
    m2m:'edge-m2m', rel:'edge-rel', view:'edge-view',
    cmdb_rel:'edge-cmdbrel'
  });

  const ARROW = Object.freeze({
    'ref-to':'ref-to', 'ref-from':'ref-from', reference:'ref',
    extends:'ext', m2m:'m2m', rel:'rel', view:'view',
    cmdb_rel:'cmdbrel'
  });

  function tagDirection(edgesArr, selectedId) {
    edgesArr.forEach(e => {
      if (e.type !== 'reference') return;
      const s = e.source?.id ?? e.source, t = e.target?.id ?? e.target;
      if (!selectedId)           { e._rtype = 'reference'; return; }
      if (s === selectedId)      { e._rtype = 'ref-to';   return; }
      if (t === selectedId)      { e._rtype = 'ref-from'; return; }
      // Multi-hop edges: use _hopDist (attached to simNode objects by render.js)
      // to colour by direction — outward = ref-to (green), inward = ref-from (purple).
      // Falls back to neutral 'reference' if hop data is unavailable (e.g. diff view).
      const srcHop = typeof e.source === 'object' ? e.source._hopDist : undefined;
      const tgtHop = typeof e.target === 'object' ? e.target._hopDist : undefined;
      if (srcHop != null && tgtHop != null && srcHop !== tgtHop) {
        e._rtype = srcHop < tgtHop ? 'ref-to' : 'ref-from';
      } else {
        e._rtype = 'reference';
      }
    });
  }

  function arrowId(d) {
    const key = d.type === 'reference' ? (d._rtype ?? 'reference') : d.type;
    return `url(#arrow-${ARROW[key] ?? 'ref'})`;
  }

  function cssClass(d) {
    const key = d.type === 'reference' ? (d._rtype ?? 'reference') : d.type;
    return CSS_CLASS[key] ?? 'edge-ref';
  }

  function buildFanOffsets(edgesArr, fanStep, maxFan) {
    const pairGroups = {};
    edgesArr.forEach((e, i) => {
      const a = e.source?.id ?? e.source;
      const b = e.target?.id ?? e.target;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      (pairGroups[key] ??= []).push(i);
    });
    const fanOffset  = new Array(edgesArr.length).fill(0);
    const fanVisible = new Array(edgesArr.length).fill(true);
    for (const indices of Object.values(pairGroups)) {
      if (indices.length < 2) continue;
      indices.slice(maxFan).forEach(idx => { fanVisible[idx] = false; });
      const shown = Math.min(indices.length, maxFan);
      const base = -((shown - 1) / 2) * fanStep;
      indices.slice(0, shown).forEach((idx, rank) => {
        fanOffset[idx] = base + rank * fanStep;
      });
    }
    return { fanOffset, fanVisible };
  }

  return { CSS_CLASS, ARROW, tagDirection, arrowId, cssClass, buildFanOffsets };
})();

const EDGE_CLASS       = EdgeStyle.CSS_CLASS;
const ARROW_ID         = EdgeStyle.ARROW;
export const tagRefDirection  = EdgeStyle.tagDirection;
export const arrowId          = EdgeStyle.arrowId;
export const edgeClass        = EdgeStyle.cssClass;
export const buildFanOffsets  = EdgeStyle.buildFanOffsets;

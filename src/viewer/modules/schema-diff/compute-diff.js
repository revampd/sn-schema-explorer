/**
 * Pure diff computation — no DOM, no module-level state.
 * Extracted so it can be unit-tested in isolation.
 */
export function computeDiff(base, compare) {
  const baseMap = new Map(base.nodes.map(n => [n.id, n]));
  const compareMap = new Map(compare.nodes.map(n => [n.id, n]));

  const added = new Set();
  const removed = new Set();
  const changed = new Map();

  for (const [id] of compareMap) {
    if (!baseMap.has(id)) added.add(id);
  }
  for (const [id] of baseMap) {
    if (!compareMap.has(id)) removed.add(id);
  }

  function edgeDiffKey(e) {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    const f = e.type === 'reference' ? e.field || '' : '';
    return `${s}||${t}||${e.type}||${f}`;
  }

  const baseEdgeMap = new Map((base.edges || []).map(e => [edgeDiffKey(e), e]));
  const compareEdgeMap = new Map((compare.edges || []).map(e => [edgeDiffKey(e), e]));

  const allAddedEdges = [];
  const allRemovedEdges = [];
  for (const [key, e] of compareEdgeMap) {
    if (!baseEdgeMap.has(key)) allAddedEdges.push(e);
  }
  for (const [key, e] of baseEdgeMap) {
    if (!compareEdgeMap.has(key)) allRemovedEdges.push(e);
  }

  const tableEdgeChanges = new Map();
  function getTableEdgeEntry(id) {
    if (!tableEdgeChanges.has(id)) tableEdgeChanges.set(id, { addedEdges: [], removedEdges: [] });
    return tableEdgeChanges.get(id);
  }
  for (const e of allAddedEdges) {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    const owner = baseMap.has(s) || compareMap.has(s) ? s : t;
    getTableEdgeEntry(owner).addedEdges.push(e);
  }
  for (const e of allRemovedEdges) {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    const owner = baseMap.has(s) ? s : t;
    getTableEdgeEntry(owner).removedEdges.push(e);
  }

  for (const [id, baseNode] of baseMap) {
    if (!compareMap.has(id)) continue;
    const cmpNode = compareMap.get(id);
    const bFields = new Map((baseNode.fields || []).map(f => [f.name, f]));
    const cFields = new Map((cmpNode.fields || []).map(f => [f.name, f]));

    const addedFields = [];
    const removedFields = [];
    const changedFields = [];
    for (const [name, cf] of cFields) {
      if (!bFields.has(name)) {
        addedFields.push(cf);
      } else {
        const bf = bFields.get(name);
        if ((bf.type || '') !== (cf.type || '')) {
          changedFields.push({ name, baseType: bf.type, compareType: cf.type, bf, cf });
        }
      }
    }
    for (const [name, bf] of bFields) {
      if (!cFields.has(name)) removedFields.push(bf);
    }

    const edgeCh = tableEdgeChanges.get(id) || { addedEdges: [], removedEdges: [] };
    if (
      addedFields.length ||
      removedFields.length ||
      changedFields.length ||
      edgeCh.addedEdges.length ||
      edgeCh.removedEdges.length
    ) {
      changed.set(id, {
        addedFields,
        removedFields,
        changedFields,
        addedEdges: edgeCh.addedEdges,
        removedEdges: edgeCh.removedEdges,
      });
    }
  }

  for (const [id, edgeCh] of tableEdgeChanges) {
    if (changed.has(id)) continue;
    if (!baseMap.has(id) || !compareMap.has(id)) continue;
    if (edgeCh.addedEdges.length || edgeCh.removedEdges.length) {
      changed.set(id, {
        addedFields: [],
        removedFields: [],
        changedFields: [],
        addedEdges: edgeCh.addedEdges,
        removedEdges: edgeCh.removedEdges,
      });
    }
  }

  const addedEdgeKeys = new Set(allAddedEdges.map(e => edgeDiffKey(e)));
  const removedEdgeKeys = new Set(allRemovedEdges.map(e => edgeDiffKey(e)));

  return {
    added,
    removed,
    changed,
    baseMap,
    compareMap,
    addedEdgeKeys,
    removedEdgeKeys,
    allAddedEdges,
    allRemovedEdges,
    edgeDiffKey,
  };
}

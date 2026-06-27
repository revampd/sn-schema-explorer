import { graphState, uiState } from '../../core/state.js';

export const Pathfinding = (() => {
  const EDGE_WEIGHTS = {
    extends: 0,
    reference: 1,
    m2m: 2,
    rel: 2,
    view: 2,
  };

  let _adjCache = { graph: null, version: null, adj: null };
  function getAdjacency() {
    // Key on both the graphData reference AND its _indexVersion: the diff graft
    // rebuilds indexes in place (same object), so identity alone would serve a
    // stale adjacency until the user re-selected a node.
    const version = graphState.graphData?._indexVersion ?? null;
    if (_adjCache.graph === graphState.graphData && _adjCache.version === version) {
      return _adjCache.adj;
    }
    const adj = new Map();
    if (graphState.graphData) {
      for (const n of graphState.graphData.nodes) adj.set(n.id, []);
      for (const e of graphState.graphData.edges) {
        const s = e.source?.id ?? e.source;
        const t = e.target?.id ?? e.target;
        if (s === t) continue;
        if (!adj.has(s) || !adj.has(t)) continue;
        adj.get(s).push({ to: t, edge: e, dir: 'out' });
        adj.get(t).push({ to: s, edge: e, dir: 'in' });
      }
    }
    _adjCache = { graph: graphState.graphData, version, adj };
    return adj;
  }

  function ancestorsOf(tableId) {
    const out = [];
    if (!graphState.graphData) return out;
    // Use the cached adjacency (O(degree) per hop) rather than scanning every
    // edge per ancestor level — ancestorsOf is called once per node inside
    // fieldOwners, so the old O(edges) find() was O(N x depth x edges).
    const adj = getAdjacency();
    const seen = new Set([tableId]);
    let cur = tableId;
    for (let depth = 0; depth < 20; depth++) {
      // extends edge child→parent is stored as an 'out' entry on the child.
      const ext = (adj.get(cur) || []).find(e => e.edge.type === 'extends' && e.dir === 'out');
      if (!ext) break;
      const parent = ext.to;
      if (seen.has(parent)) break;
      seen.add(parent);
      out.push(parent);
      cur = parent;
    }
    return out;
  }

  function fieldDefinedAt(tableId, fieldName) {
    if (!graphState.graphData) return null;
    const node = graphState.graphData.nodes.find(n => n.id === tableId);
    if (!node) return null;
    if (node.fields?.some(f => f.name === fieldName)) {
      let defAt = tableId;
      for (const ancId of ancestorsOf(tableId)) {
        const anc = graphState.graphData.nodes.find(n => n.id === ancId);
        if (anc?.fields?.some(f => f.name === fieldName)) defAt = ancId;
      }
      return defAt;
    }
    for (const ancId of ancestorsOf(tableId)) {
      const anc = graphState.graphData.nodes.find(n => n.id === ancId);
      if (anc?.fields?.some(f => f.name === fieldName)) return ancId;
    }
    return null;
  }

  function fieldOwners(fieldName) {
    if (!graphState.graphData || !fieldName) return [];
    const results = [];
    for (const n of graphState.graphData.nodes) {
      const owner = fieldDefinedAt(n.id, fieldName);
      if (!owner) continue;
      results.push({
        tableId: n.id,
        isOwn: owner === n.id,
        isInherited: owner !== n.id,
        inheritedFrom: owner !== n.id ? owner : null,
      });
    }
    return results;
  }

  function dijkstra(sourceId, targetSet, opts = {}) {
    const { forbiddenEdges = null, forbiddenNodes = null } = opts;
    const adj = getAdjacency();
    if (!adj.has(sourceId)) return null;

    const dist = new Map();
    const prev = new Map();
    dist.set(sourceId, 0);
    const visited = new Set();
    const frontier = new Set([sourceId]);

    while (frontier.size > 0) {
      let bestId = null,
        bestDist = Infinity;
      for (const id of frontier) {
        const d = dist.get(id);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
      if (bestId == null) break;
      frontier.delete(bestId);
      visited.add(bestId);

      if (targetSet.has(bestId)) {
        const path = [bestId];
        const edges = [];
        let cur = bestId;
        while (prev.has(cur)) {
          const p = prev.get(cur);
          edges.unshift({ edge: p.edge, dir: p.dir, from: p.from, to: cur });
          path.unshift(p.from);
          cur = p.from;
        }
        return { path, edges, totalCost: bestDist };
      }

      for (const { to, edge, dir } of adj.get(bestId) || []) {
        if (visited.has(to)) continue;
        if (forbiddenNodes && forbiddenNodes.has(to)) continue;
        if (forbiddenEdges && forbiddenEdges.has(edge)) continue;
        // Skip excluded-hop tables when they're intermediates (still allowed as target)
        if (!targetSet.has(to) && uiState.pfExcludedHops.has(to)) continue;

        if (edge.type === 'reference' && dir !== 'out') continue;
        if (edge.type === 'extends' && dir !== 'out') continue;
        if (
          edge.type === 'm2m' ||
          edge.type === 'rel' ||
          edge.type === 'view' ||
          edge.type === 'cmdb_rel'
        )
          continue;

        // Skip explicitly excluded reference fields ("sourceTable.fieldName" in pfExcludedHops)
        if (edge.type === 'reference' && edge.field) {
          const edgeSrc = edge.source?.id ?? edge.source;
          if (uiState.pfExcludedHops.has(edgeSrc + '.' + edge.field)) continue;
        }

        const w = EDGE_WEIGHTS[edge.type] ?? 1;
        const alt = bestDist + w;
        if (alt < (dist.get(to) ?? Infinity)) {
          dist.set(to, alt);
          prev.set(to, { from: bestId, edge, dir });
          frontier.add(to);
        }
      }
    }
    return null;
  }

  function formatPath(pathResult, originalSource, fieldName = null) {
    if (!pathResult) return null;
    const { path, edges, totalCost } = pathResult;
    const steps = edges.map(e => ({
      from: e.from,
      to: e.to,
      edgeType: e.edge.type,
      fieldName: e.edge.type === 'reference' ? e.edge.field || e.edge.label || '?' : null,
      viaInheritance: e.edge.type === 'extends',
      dir: e.dir,
    }));
    const dotSegments = [originalSource];
    for (const s of steps) {
      if (s.edgeType === 'extends') continue;
      if (s.edgeType === 'reference' && s.fieldName) dotSegments.push(s.fieldName);
    }
    if (fieldName) dotSegments.push(fieldName);
    return {
      steps,
      path,
      totalCost,
      dotWalk: dotSegments.join('.'),
    };
  }

  function findKShortestPaths(sourceId, targetSet, k = 5) {
    const A = [];
    const B = [];

    const first = dijkstra(sourceId, targetSet);
    if (!first) return A;
    A.push(first);

    const pathKey = p =>
      p.edges
        .map(e => {
          const s = e.edge.source?.id ?? e.edge.source;
          const t = e.edge.target?.id ?? e.edge.target;
          return `${s}|${t}|${e.edge.type}|${e.edge.field || ''}`;
        })
        .join('>>');

    // Track every key already accepted (A) or queued (B) so candidate
    // deduplication is O(1) instead of re-scanning + re-keying both arrays.
    const seenKeys = new Set([pathKey(first)]);

    for (let kth = 1; kth < k; kth++) {
      const prevPath = A[kth - 1];
      for (let i = 0; i < prevPath.path.length - 1; i++) {
        const spurNode = prevPath.path[i];
        const rootPathNodes = prevPath.path.slice(0, i + 1);
        const rootPathEdges = prevPath.edges.slice(0, i);
        const rootCost = rootPathEdges.reduce(
          (sum, e) => sum + (EDGE_WEIGHTS[e.edge.type] ?? 1),
          0
        );

        const forbiddenEdges = new Set();
        for (const accepted of A) {
          if (accepted.path.length <= i + 1) continue;
          let matches = true;
          for (let j = 0; j <= i; j++) {
            if (accepted.path[j] !== rootPathNodes[j]) {
              matches = false;
              break;
            }
          }
          if (matches && accepted.edges[i]) forbiddenEdges.add(accepted.edges[i].edge);
        }
        const forbiddenNodes = new Set(rootPathNodes.slice(0, -1));

        const spurResult = dijkstra(spurNode, targetSet, {
          forbiddenEdges,
          forbiddenNodes,
        });
        if (!spurResult) continue;

        const fullPath = [...rootPathNodes, ...spurResult.path.slice(1)];
        const fullEdges = [...rootPathEdges, ...spurResult.edges];
        const totalCost = rootCost + spurResult.totalCost;
        const candidate = { path: fullPath, edges: fullEdges, totalCost };

        const key = pathKey(candidate);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          B.push(candidate);
        }
      }

      if (B.length === 0) break;
      B.sort((a, b) => {
        if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
        return a.edges.length - b.edges.length;
      });
      A.push(B.shift());
    }

    return A;
  }

  function tableToTable(sourceId, targetId) {
    if (!graphState.graphData || sourceId === targetId) return null;
    const result = dijkstra(sourceId, new Set([targetId]));
    return formatPath(result, sourceId);
  }

  function tableToTableK(sourceId, targetId, k = 5) {
    if (!graphState.graphData || sourceId === targetId) return [];
    const rawPaths = findKShortestPaths(sourceId, new Set([targetId]), k);
    return rawPaths.map(p => formatPath(p, sourceId)).filter(Boolean);
  }

  function tableToField(sourceId, fieldName) {
    if (!graphState.graphData || !sourceId || !fieldName) return null;
    const owners = fieldOwners(fieldName);
    if (!owners.length) return null;
    const targetSet = new Set(owners.map(o => o.tableId));
    if (targetSet.has(sourceId)) {
      const ownerEntry = owners.find(o => o.tableId === sourceId);
      return {
        steps: [],
        path: [sourceId],
        totalCost: 0,
        dotWalk: `${sourceId}.${fieldName}`,
        fieldOwner: ownerEntry?.inheritedFrom || sourceId,
        inheritedFromAncestor: !!ownerEntry?.isInherited,
      };
    }
    const result = dijkstra(sourceId, targetSet);
    if (!result) return null;
    const formatted = formatPath(result, sourceId, fieldName);
    if (!formatted) return null;
    const finalTable = result.path[result.path.length - 1];
    const ownerEntry = owners.find(o => o.tableId === finalTable);
    formatted.fieldOwner = ownerEntry?.inheritedFrom || finalTable;
    formatted.inheritedFromAncestor = !!ownerEntry?.isInherited;
    return formatted;
  }

  function tableToFieldK(sourceId, fieldName, k = 5) {
    if (!graphState.graphData || !sourceId || !fieldName) return [];
    const owners = fieldOwners(fieldName);
    if (!owners.length) return [];
    const targetSet = new Set(owners.map(o => o.tableId));
    if (targetSet.has(sourceId)) {
      const ownerEntry = owners.find(o => o.tableId === sourceId);
      return [
        {
          steps: [],
          path: [sourceId],
          totalCost: 0,
          dotWalk: `${sourceId}.${fieldName}`,
          fieldOwner: ownerEntry?.inheritedFrom || sourceId,
          inheritedFromAncestor: !!ownerEntry?.isInherited,
        },
      ];
    }
    const rawPaths = findKShortestPaths(sourceId, targetSet, k);
    return rawPaths
      .map(raw => {
        const formatted = formatPath(raw, sourceId, fieldName);
        if (!formatted) return null;
        const finalTable = raw.path[raw.path.length - 1];
        const ownerEntry = owners.find(o => o.tableId === finalTable);
        formatted.fieldOwner = ownerEntry?.inheritedFrom || finalTable;
        formatted.inheritedFromAncestor = !!ownerEntry?.isInherited;
        return formatted;
      })
      .filter(Boolean);
  }

  return {
    tableToTable,
    tableToField,
    tableToTableK,
    tableToFieldK,
    fieldOwners,
    fieldDefinedAt,
    ancestorsOf,
  };
})();

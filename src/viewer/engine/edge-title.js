import { graphState } from '../core/state.js';
import { Settings } from '../modules/settings/index.js';

// ── Edge tooltip text ──────────────────────────────────────────────────────────
//
// Builds the hover-title text for a graph edge: the source→target header, the
// edge's own reference fields, and (when the tooltipInheritedRefs feature is on)
// reference fields inherited from ancestor tables. Extracted verbatim from
// render.js (#73).
//
// makeEdgeTitleText() snapshots the current graph into ancestor-lookup maps once
// per render and returns the per-edge title function used by both the visible
// edge paths and the wide hit-overlay paths. By the time it runs, D3's forceLink
// has replaced edge source/target id strings with node objects.
export function makeEdgeTitleText() {
  // Pre-build ancestor lookup maps for inherited tooltip refs (rebuilt each render).
  // _extendsMap: child id → parent id (one hop up)
  // _refBySourceTarget: source id → Map(target id → { fields: string[], fieldLabels: string[] })
  const _extendsMap = new Map();
  const _refBySourceTarget = new Map();
  if (graphState.graphData) {
    for (const e of graphState.graphData.edges) {
      const s = e.source?.id ?? e.source;
      const t = e.target?.id ?? e.target;
      if (e.type === 'extends') {
        _extendsMap.set(s, t);
      } else if (e.type === 'reference') {
        if (!_refBySourceTarget.has(s)) _refBySourceTarget.set(s, new Map());
        const tm = _refBySourceTarget.get(s);
        if (!tm.has(t)) tm.set(t, { fields: [], fieldLabels: [] });
        const entry = tm.get(t);
        if (e.field) entry.fields.push(e.field);
        if (e.label) entry.fieldLabels.push(e.label);
      }
    }
  }

  return d => {
    const fmtNode = n => {
      if (!n || typeof n !== 'object') return n || '';
      return n.label && n.label !== n.id ? `${n.label} (${n.id})` : n.id;
    };
    const header = `${fmtNode(d.source)} → ${fmtNode(d.target)}`;

    // _fields / _fieldLabels are populated for every collapsed edge (count 1 or more).
    const labels = d._fieldLabels || [];
    const names = d._fields || [];
    const count = Math.max(labels.length, names.length);

    let directSection = '';
    if (count > 0) {
      const pairs = Array.from({ length: count }, (_, i) => {
        const lbl = labels[i] || '',
          nm = names[i] || '';
        return lbl && nm && lbl !== nm ? `${lbl} (${nm})` : lbl || nm;
      });
      directSection = pairs.map(p => `• ${p}`).join('\n');
    }

    // Inherited reference fields — walk full ancestor chain when feature is on.
    let inheritedSection = '';
    if (d.type === 'reference' && Settings.isEnabled('tooltipInheritedRefs')) {
      const targetId = d.target?.id ?? d.target;
      let current = d.source?.id ?? d.source;
      const CAP = 5;
      const sections = [];
      while (true) {
        const parentId = _extendsMap.get(current);
        if (!parentId) break;
        const refs = _refBySourceTarget.get(parentId)?.get(targetId);
        if (refs && refs.fields.length > 0) {
          const ancestorNode = graphState.graphData.nodes.find(n => n.id === parentId);
          const ancestorLabel = ancestorNode?.label || parentId;
          const pairs = refs.fieldLabels.map((lbl, i) => {
            const nm = refs.fields[i] || '';
            return lbl && nm && lbl !== nm ? `${lbl} (${nm})` : lbl || nm;
          });
          const visible = pairs.slice(0, CAP);
          const overflow = pairs.length - CAP;
          let block = `↳ inherited from ${ancestorLabel}:\n${visible.map(p => `  • ${p}`).join('\n')}`;
          if (overflow > 0) block += `\n  … +${overflow} more`;
          sections.push(block);
        }
        current = parentId;
      }
      if (sections.length) inheritedSection = '\n' + sections.join('\n');
    }

    if (directSection || inheritedSection) {
      return `${header}\n${directSection}${inheritedSection}`;
    }

    // Non-reference edges (extends, m2m, cmdb_rel…) — append label if present.
    const rel = d.label || '';
    return rel ? `${header}\n${rel}` : header;
  };
}

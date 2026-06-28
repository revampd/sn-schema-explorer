/**
 * diff-export.js — pure serialisers for the active comparison/diff (#177).
 *
 * The Schema-Diff sidebar/inspector build their report as DOM; nothing turns the
 * diff into *data*. These helpers do, so the Schema-Map exporters can fold the
 * comparison into their output (embedded) or emit it on its own (standalone).
 *
 * No DOM, no module-level state — unit-tested in isolation.
 *
 * Input is the diff matrix (`diffState._diffMatrix`): an array of pairwise
 * `computeDiff` results, each stamped with `_compareId` / `_compareLabel`
 * (see schema-diff/compute-matrix.js). `includedIds` is the user-chosen subset of
 * compares to fold in (null/undefined = all).
 */

function _edgeSummary(e) {
  const source = typeof e.source === 'object' ? e.source.id : e.source;
  const target = typeof e.target === 'object' ? e.target.id : e.target;
  const out = { source, target, type: e.type };
  if (e.type === 'reference' && e.field) out.field = e.field;
  return out;
}

function _labelFor(diff, id) {
  return diff.baseMap.get(id)?.label || diff.compareMap.get(id)?.label || id;
}

/**
 * Build the canonical, serialisable comparison object from the diff matrix.
 *
 * @param {Array} matrix  output of computeDiffMatrix (entries stamped _compareId/_compareLabel)
 * @param {object} [opts]
 * @param {string[]} [opts.includedIds]  subset of compareIds to include (default: all)
 * @param {string}   [opts.baseLabel]    label for the base (loaded) instance
 * @returns {null | {base, compares, tables, summary}}  null when nothing to export
 */
export function diffToExport(matrix, opts = {}) {
  const { includedIds, baseLabel } = opts;
  const included = (matrix || []).filter(d => !includedIds || includedIds.includes(d._compareId));
  if (!included.length) return null;

  const compares = included.map(d => ({
    id: d._compareId,
    label: d._compareLabel || d._compareId,
  }));

  // Per-table union across the included diffs, each with its per-compare status.
  const tablesMap = new Map();
  const ensure = (id, diff) => {
    if (!tablesMap.has(id)) tablesMap.set(id, { id, label: _labelFor(diff, id), perCompare: {} });
    return tablesMap.get(id);
  };

  for (const diff of included) {
    const cid = diff._compareId;
    for (const id of diff.added) ensure(id, diff).perCompare[cid] = { status: 'added' };
    for (const id of diff.removed) ensure(id, diff).perCompare[cid] = { status: 'removed' };
    for (const [id, ch] of diff.changed) {
      ensure(id, diff).perCompare[cid] = {
        status: 'changed',
        addedFields: ch.addedFields.map(f => ({ name: f.name, type: f.type || null })),
        removedFields: ch.removedFields.map(f => ({ name: f.name, type: f.type || null })),
        changedFields: ch.changedFields.map(f => ({
          name: f.name,
          baseType: f.baseType || null,
          compareType: f.compareType || null,
        })),
        addedEdges: ch.addedEdges.map(_edgeSummary),
        removedEdges: ch.removedEdges.map(_edgeSummary),
      };
    }
  }

  const tables = [...tablesMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!tables.length) return null; // included compares are all identical to base

  // Roll-up counts: a table counts toward a bucket if it has that status anywhere.
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const t of tables) {
    const sts = Object.values(t.perCompare).map(p => p.status);
    if (sts.includes('added')) added++;
    if (sts.includes('removed')) removed++;
    if (sts.includes('changed')) changed++;
  }

  return {
    base: baseLabel || null,
    compares,
    summary: { tablesDiffering: tables.length, added, removed, changed },
    tables,
  };
}

// ── Markdown ──────────────────────────────────────────────────────────────────

const _STATUS_LABEL = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  same: '—',
  absent: '—',
};

/**
 * Render the comparison object as a Markdown "Differences" section.
 * `de` is the output of diffToExport (caller guarantees non-null).
 */
export function diffToMarkdown(de) {
  const lines = [];
  lines.push('## Comparison — differences', '');
  if (de.base) lines.push(`**Base:** ${de.base}`, '');
  lines.push(`**Compared against:** ${de.compares.map(c => c.label).join(', ')}`, '');
  lines.push(
    `**Summary:** ${de.summary.tablesDiffering} table(s) differ — ` +
      `${de.summary.added} added, ${de.summary.removed} removed, ${de.summary.changed} changed (in ≥1 instance).`,
    ''
  );

  for (const t of de.tables) {
    lines.push(`### \`${t.id}\`${t.label && t.label !== t.id ? ` — ${t.label}` : ''}`, '');
    for (const c of de.compares) {
      const p = t.perCompare[c.id];
      if (!p) {
        lines.push(`- **${c.label}:** unchanged`);
        continue;
      }
      lines.push(`- **${c.label}:** ${_STATUS_LABEL[p.status] || p.status}`);
      if (p.status === 'changed') {
        if (p.addedFields?.length)
          lines.push(`  - Fields added: ${p.addedFields.map(f => `\`${f.name}\``).join(', ')}`);
        if (p.removedFields?.length)
          lines.push(`  - Fields removed: ${p.removedFields.map(f => `\`${f.name}\``).join(', ')}`);
        if (p.changedFields?.length)
          lines.push(
            `  - Fields retyped: ${p.changedFields
              .map(f => `\`${f.name}\` (${f.baseType} → ${f.compareType})`)
              .join(', ')}`
          );
        if (p.addedEdges?.length) lines.push(`  - Relationships added: ${p.addedEdges.length}`);
        if (p.removedEdges?.length)
          lines.push(`  - Relationships removed: ${p.removedEdges.length}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── Generic YAML (for the OpenAPI x-comparison block / standalone) ──────────────

function _yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  // Quote when it could be misread as a non-string scalar or contains specials.
  if (
    s === '' ||
    /[:#\-?{}[\],&*!|>'"%@`]/.test(s) ||
    /^\s|\s$/.test(s) ||
    /^(true|false|null|~|\d)/i.test(s)
  ) {
    return "'" + s.replace(/'/g, "''") + "'";
  }
  return s;
}

/** Minimal, deterministic object→YAML for plain JSON values (objects/arrays/scalars). */
export function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return pad + '[]';
    return value
      .map(v => {
        if (v && typeof v === 'object') {
          const block = toYaml(v, indent + 1);
          return pad + '-\n' + block;
        }
        return pad + '- ' + _yamlScalar(v);
      })
      .join('\n');
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return pad + '{}';
    return keys
      .map(k => {
        const v = value[k];
        if (v && typeof v === 'object' && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
          return pad + k + ':\n' + toYaml(v, indent + 1);
        }
        if (v && typeof v === 'object') return pad + k + ': ' + (Array.isArray(v) ? '[]' : '{}');
        return pad + k + ': ' + _yamlScalar(v);
      })
      .join('\n');
  }
  return pad + _yamlScalar(value);
}

// ── Turtle / JSON-LD helpers ────────────────────────────────────────────────────

/** A `#`-comment block summarising the comparison, for Turtle output. */
export function diffToTurtleComment(de) {
  const lines = ['# ── Comparison ──────────────────────────────────────────────'];
  if (de.base) lines.push(`# Base: ${de.base}`);
  lines.push(`# Compared against: ${de.compares.map(c => c.label).join(', ')}`);
  lines.push(
    `# ${de.summary.tablesDiffering} table(s) differ — ${de.summary.added} added, ` +
      `${de.summary.removed} removed, ${de.summary.changed} changed (in ≥1 instance).`
  );
  for (const t of de.tables) {
    const parts = de.compares.map(c => {
      const p = t.perCompare[c.id];
      return `${c.label}=${p ? p.status : 'unchanged'}`;
    });
    lines.push(`#   ${t.id}: ${parts.join(', ')}`);
  }
  lines.push('# ────────────────────────────────────────────────────────────', '');
  return lines.join('\n');
}

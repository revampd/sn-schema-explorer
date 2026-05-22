import { graphState, uiState } from '../core/state.js';

// ── Scope filter component ────────────────────────────────────────────────────
//
// Builds scope-filter checkboxes into the provided container.
//
//   container  — the DOM element to render into (e.g. Dom.scopeList)
//   opts.onApply() — called whenever the selection changes so the caller can
//                    trigger a re-render or filter pass
//
// Reusable by any view that needs scope-based filtering.

export function buildScopeFilter(container, { onApply } = {}) {
  if (!graphState.graphData) return;

  const scopeInfo = {};
  graphState.graphData.nodes.forEach(n => {
    if (!scopeInfo[n.scope]) scopeInfo[n.scope] = { count: 0 };
    scopeInfo[n.scope].count++;
  });

  const scopes = Object.keys(scopeInfo).sort((a, b) => {
    if (a === 'global') return -1;
    if (b === 'global') return  1;
    return a.localeCompare(b);
  });

  uiState.selectedScopes = new Set(scopes);

  container.innerHTML = scopes.map(s => {
    const color = graphState.scopeColorMap[s] ?? 'var(--edge-ref)';
    const count = scopeInfo[s].count;
    return `<label class="scope-row">
      <input type="checkbox" class="scope-cb" data-scope="${s}" checked>
      <span class="scope-dot" style="background:${color}"></span>
      <span class="scope-name" title="${s}">${s}</span>
      <span class="scope-count">${count}</span>
    </label>`;
  }).join('') + `
  <div class="scope-filter-actions">
    <button class="scope-action-btn" id="scope-all">All</button>
    <button class="scope-action-btn" id="scope-none">None</button>
  </div>`;

  container.querySelectorAll('.scope-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) uiState.selectedScopes.add(cb.dataset.scope);
      else            uiState.selectedScopes.delete(cb.dataset.scope);
      if (onApply) onApply();
    });
  });
  document.getElementById('scope-all').addEventListener('click', () => {
    container.querySelectorAll('.scope-cb').forEach(cb => {
      cb.checked = true;
      uiState.selectedScopes.add(cb.dataset.scope);
    });
    if (onApply) onApply();
  });
  document.getElementById('scope-none').addEventListener('click', () => {
    container.querySelectorAll('.scope-cb').forEach(cb => {
      cb.checked = false;
      uiState.selectedScopes.delete(cb.dataset.scope);
    });
    if (onApply) onApply();
  });
}

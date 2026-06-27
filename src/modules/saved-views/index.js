import {
  graphState,
  uiState,
  serializeState,
  restoreState,
  setRestoreCallback,
} from '../../core/state.js';
import { Settings } from '../settings/index.js';
import { h } from '../../core/template.js';
import { onViewModeChange } from '../../core/view-mode.js';
import { render } from '../../core/render.js';
import { focusTable } from '../../core/inspector.js';
import { inlinePrompt } from '../../core/inline-prompt.js';

// ── Saved-views UI (self-contained — no external wiring needed) ───────────────

export const SavedViews = (() => {
  const STORAGE_KEY = 'snse:views:v1';
  let currentFp = null;
  const subscribers = new Set();

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function saveAll(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn('SavedViews: localStorage write failed', e);
    }
  }
  function notify() {
    subscribers.forEach(fn => {
      try {
        fn();
      } catch {}
    });
  }

  function fingerprint(graph) {
    if (!graph || !graph.nodes) return 'unknown';
    const nc = graph.nodes.length;
    const ec = (graph.edges || []).length;
    const sample = graph.nodes
      .slice(0, 50)
      .map(n => n.id)
      .sort()
      .join('|');
    let h = 0;
    for (let i = 0; i < sample.length; i++) {
      h = ((h << 5) - h + sample.charCodeAt(i)) | 0;
    }
    return `${nc}-${ec}-${(h >>> 0).toString(36)}`;
  }
  function setFingerprint(fp) {
    currentFp = fp;
    notify();
  }

  function list() {
    if (!currentFp) return [];
    const all = loadAll();
    return (all[currentFp] || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  }
  function save(name) {
    if (!currentFp || !graphState.graphData) return null;
    const all = loadAll();
    const bucket = all[currentFp] || [];
    const entry = {
      id: 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      name: (name || 'Untitled view').trim().slice(0, 60),
      createdAt: Date.now(),
      state: serializeState(),
    };
    bucket.push(entry);
    all[currentFp] = bucket;
    saveAll(all);
    notify();
    return entry;
  }
  function apply(id) {
    if (!currentFp) return false;
    const all = loadAll();
    const entry = (all[currentFp] || []).find(v => v.id === id);
    if (!entry) return false;
    restoreState(entry.state);
    return true;
  }
  function remove(id) {
    if (!currentFp) return false;
    const all = loadAll();
    all[currentFp] = (all[currentFp] || []).filter(v => v.id !== id);
    saveAll(all);
    notify();
    return true;
  }
  function onChange(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }
  return { fingerprint, setFingerprint, list, save, apply, remove, onChange };
})();

function buildViewsList() {
  const list = document.getElementById('views-list');
  if (!list) return;
  const views = SavedViews.list();
  if (!views.length) {
    list.replaceChildren(h('div', { class: 'views-empty' }, 'No saved views yet.'));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const v of views) {
    const dateLabel = new Date(v.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    frag.appendChild(
      h(
        'div',
        { class: 'view-item', dataId: v.id, title: v.name },
        h('span', { class: 'view-name' }, v.name),
        h('span', { class: 'view-meta' }, dateLabel),
        h(
          'button',
          { class: 'view-delete', dataAction: 'delete', dataId: v.id, title: 'Delete this view' },
          '×'
        )
      )
    );
  }
  list.replaceChildren(frag);
}

// Subscribe so the list rebuilds whenever views are added/removed/fingerprint changes
SavedViews.onChange(buildViewsList);

// Wire save and apply/delete interactions
document.getElementById('btn-save-view')?.addEventListener('click', async () => {
  if (!graphState.graphData) return;
  const name = await inlinePrompt({
    title: 'Name this view',
    placeholder: 'e.g. Incident neighbourhood',
    okLabel: 'Save',
  });
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  SavedViews.save(trimmed);
});

document.getElementById('views-list')?.addEventListener('click', e => {
  const delBtn = e.target.closest('button.view-delete[data-id]');
  if (delBtn) {
    e.stopPropagation();
    SavedViews.remove(delBtn.dataset.id);
    return;
  }
  const item = e.target.closest('.view-item[data-id]');
  if (item) SavedViews.apply(item.dataset.id);
});

function syncSavedViewsVisibility() {
  const group = document.getElementById('views-group');
  if (!group) return;
  const inForce = !uiState.viewMode || uiState.viewMode === 'force';
  group.style.display = inForce && Settings.isEnabled('savedViews') ? '' : 'none';
}

onViewModeChange(() => syncSavedViewsVisibility());
Settings.onChange('savedViews', syncSavedViewsVisibility);
// Initial visibility sync — runs when module first loads
syncSavedViewsVisibility();

// Wire the restore callback immediately — no injection needed because
// saved-views → render and saved-views → inspector are both one-way imports.
setRestoreCallback(function (selectedNode) {
  if (selectedNode && graphState.graphData) focusTable(selectedNode);
  else if (graphState.graphData) render();
});

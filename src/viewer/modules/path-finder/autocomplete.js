import { graphState } from '../../core/state.js';
import { h } from '../../core/template.js';
import { Pathfinding } from './pathfinding.js';
import { pfValidate, pfRunSearch, pfSetMode, onPfSetMode } from './index.js';

// ── Autocomplete engine ───────────────────────────────────────────────────────

function createAutocomplete(inputEl, dropdownEl, getSuggestions) {
  let activeIdx = -1;
  let currentItems = [];

  function renderList(items) {
    currentItems = items;
    activeIdx = -1;
    dropdownEl.replaceChildren();
    if (!items.length) {
      dropdownEl.appendChild(h('div', { class: 'pf-ac-empty' }, 'No matches'));
      dropdownEl.classList.add('visible');
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const row = h('div', {
        class: 'pf-ac-item' + (item.kind === 'field' ? ' field-item' : ''),
        dataIdx: idx,
        onMousedown: (e) => {
          e.preventDefault();
          accept(idx);
        }
      },
        h('span', { class: 'pf-ac-item-id' }, item.value),
        item.subtitle ? h('span', { class: 'pf-ac-item-label' }, item.subtitle) : null,
        item.tag      ? h('span', { class: 'pf-ac-item-tag' },   item.tag)      : null
      );
      frag.appendChild(row);
    });
    dropdownEl.appendChild(frag);
    dropdownEl.classList.add('visible');
  }

  function close() {
    dropdownEl.classList.remove('visible');
    dropdownEl.replaceChildren();
    currentItems = [];
    activeIdx = -1;
  }

  function setActive(idx) {
    const rows = dropdownEl.querySelectorAll('.pf-ac-item');
    if (!rows.length) return;
    activeIdx = ((idx % rows.length) + rows.length) % rows.length;
    rows.forEach((r, i) => r.classList.toggle('active', i === activeIdx));
    rows[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }

  function accept(idx) {
    if (idx < 0 || idx >= currentItems.length) return;
    const item = currentItems[idx];
    inputEl.value = item.insert ?? item.value;
    close();
    pfValidate();
    if (item.continue) {
      setTimeout(() => refresh(), 0);
    }
  }

  function refresh() {
    const items = getSuggestions(inputEl.value);
    if (!items || !items.length) {
      if (inputEl.value.trim()) renderList([]);
      else close();
      return;
    }
    renderList(items);
  }

  inputEl.addEventListener('input',  () => { refresh(); });
  inputEl.addEventListener('focus',  () => { refresh(); });
  inputEl.addEventListener('blur',   () => { setTimeout(close, 120); });
  inputEl.addEventListener('keydown', (e) => {
    if (!dropdownEl.classList.contains('visible')) return;
    if      (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter') {
      if (activeIdx >= 0) { e.preventDefault(); e.stopPropagation(); accept(activeIdx); }
    }
    else if (e.key === 'Escape') { close(); }
  });

  return { refresh, close };
}

// ── Suggestion providers ──────────────────────────────────────────────────────

function tableSuggestions(query) {
  if (!graphState.graphData) return [];
  const q = (query || '').toLowerCase().trim();
  const out = [];
  for (const n of graphState.graphData.nodes) {
    if (q && !n.id.toLowerCase().includes(q) && !(n.label || '').toLowerCase().includes(q)) continue;
    out.push({ value: n.id, subtitle: n.label && n.label !== n.id ? n.label : null, kind: 'table' });
    if (out.length >= 50) break;
  }
  out.sort((a, b) => {
    const aPrefix = a.value.toLowerCase().startsWith(q);
    const bPrefix = b.value.toLowerCase().startsWith(q);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    return a.value.localeCompare(b.value);
  });
  return out;
}

function fieldSuggestions(query) {
  if (!graphState.graphData) return [];
  const raw    = (query || '').trim();
  const dotIdx = raw.lastIndexOf('.');

  if (dotIdx >= 0) {
    const segments    = raw.slice(0, dotIdx).split('.').filter(Boolean);
    const partial     = raw.slice(dotIdx + 1).toLowerCase();
    let currentTable  = segments[0];
    if (!graphState.graphData.nodes.find(n => n.id === currentTable)) return [];
    for (let i = 1; i < segments.length; i++) {
      const fname = segments[i];
      const ref = graphState.graphData.edges.find(e => {
        const s = e.source?.id ?? e.source;
        return s === currentTable && e.type === 'reference' && e.field === fname;
      });
      if (!ref) return [];
      currentTable = ref.target?.id ?? ref.target;
    }
    const node = graphState.graphData.nodes.find(n => n.id === currentTable);
    if (!node) return [];
    const fields = new Map();
    for (const f of (node.fields || [])) {
      fields.set(f.name, { label: f.label, type: f.type, source: currentTable, isOwn: true });
    }
    for (const ancId of Pathfinding.ancestorsOf(currentTable)) {
      const anc = graphState.graphData.nodes.find(n => n.id === ancId);
      for (const f of (anc?.fields || [])) {
        if (!fields.has(f.name)) {
          fields.set(f.name, { label: f.label, type: f.type, source: ancId, isOwn: false });
        }
      }
    }
    const prefix = raw.slice(0, dotIdx + 1);
    const out = [];
    for (const [fname, meta] of fields) {
      if (partial && !fname.toLowerCase().includes(partial)) continue;
      const isRef = meta.type === 'reference';
      out.push({
        value:    prefix + fname,
        insert:   prefix + fname + (isRef ? '.' : ''),
        subtitle: meta.label,
        tag:      isRef ? `${meta.type} →` : meta.type,
        kind:     'field',
        continue: isRef,
      });
      if (out.length >= 80) break;
    }
    out.sort((a, b) => {
      const av = a.value.slice(prefix.length).toLowerCase();
      const bv = b.value.slice(prefix.length).toLowerCase();
      const aPrefix = av.startsWith(partial);
      const bPrefix = bv.startsWith(partial);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      return av.localeCompare(bv);
    });
    return out;
  }

  // No dot — match field names across all tables
  const q    = raw.toLowerCase();
  const seen = new Set();
  const out  = [];
  for (const n of graphState.graphData.nodes) {
    for (const f of (n.fields || [])) {
      if (seen.has(f.name)) continue;
      if (q && !f.name.toLowerCase().includes(q)) continue;
      seen.add(f.name);
      out.push({
        value:    f.name,
        subtitle: f.label && f.label !== f.name ? f.label : null,
        tag:      f.type,
        kind:     'field',
      });
      if (out.length >= 50) break;
    }
    if (out.length >= 50) break;
  }
  out.sort((a, b) => {
    const aPrefix = a.value.toLowerCase().startsWith(q);
    const bPrefix = b.value.toLowerCase().startsWith(q);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    return a.value.localeCompare(b.value);
  });
  return out;
}

// ── Wire up autocompletes ─────────────────────────────────────────────────────

const _pfSourceAc = createAutocomplete(
  document.getElementById('pf-source'),
  document.getElementById('pf-source-ac'),
  tableSuggestions
);

let _pfTargetAc = null;

export function pfBindTargetAutocomplete() {
  const targetInput    = document.getElementById('pf-target');
  const targetDropdown = document.getElementById('pf-target-ac');
  if (!targetInput || !targetDropdown) return;
  // Clone to remove previous event listeners
  const fresh = targetInput.cloneNode(true);
  targetInput.parentNode.replaceChild(fresh, targetInput);
  _pfTargetAc = createAutocomplete(
    fresh,
    targetDropdown,
    document.querySelector('.pf-mode-btn.active')?.dataset.mode === 'field'
      ? fieldSuggestions
      : tableSuggestions
  );
  fresh.addEventListener('input', pfValidate);
  fresh.addEventListener('keydown', e => {
    if (e.key === 'Enter'
        && !document.getElementById('pf-find').disabled
        && !document.getElementById('pf-target-ac').classList.contains('visible')) {
      pfRunSearch();
    }
  });
}

pfBindTargetAutocomplete();

// When mode changes, swap target suggestions and clear target value
onPfSetMode(() => {
  const t = document.getElementById('pf-target');
  if (t && t.value) t.value = '';
  pfBindTargetAutocomplete();
  pfValidate();
});

// ── Remaining control wiring ──────────────────────────────────────────────────

document.getElementById('pf-mode-table').addEventListener('click', () => pfSetMode('table'));
document.getElementById('pf-mode-field').addEventListener('click', () => pfSetMode('field'));
document.getElementById('pf-source').addEventListener('input', pfValidate);
document.getElementById('pf-find').addEventListener('click', pfRunSearch);
document.getElementById('pf-source').addEventListener('keydown', e => {
  if (e.key === 'Enter'
      && !document.getElementById('pf-find').disabled
      && !document.getElementById('pf-source-ac').classList.contains('visible')) {
    pfRunSearch();
  }
});

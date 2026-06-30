import { Dom } from '../../core/dom.js';
import { h } from '../../core/template.js';

export const Settings = (() => {
  const STORAGE_KEY = 'snse:settings:v1';
  const FONT_SCALE_KEY = 'snse:fontScale:v1';
  const MAX_PNG_SCALE_KEY = 'snse:maxPngScale:v1';
  const CUSTOM_PREFIXES_KEY = 'snse:customPrefixes:v1';
  const DEFAULT_PREFIXES = 'u_, x_';
  const features = new Map();
  const subscribers = new Map();
  const anySubscribers = new Set();
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      cache = raw ? JSON.parse(raw) : {};
    } catch {
      cache = {};
    }
    return cache;
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('Settings: localStorage write failed', e);
    }
  }
  function notify(key, value) {
    const subs = subscribers.get(key);
    if (subs)
      subs.forEach(fn => {
        try {
          fn(value);
        } catch {}
      });
    anySubscribers.forEach(fn => {
      try {
        fn(key, value);
      } catch {}
    });
  }

  function get(key) {
    const store = load();
    if (key in store) return store[key];
    const feat = features.get(key);
    return feat ? feat.default : undefined;
  }
  function set(key, value) {
    load();
    cache[key] = value;
    persist();
    notify(key, value);
  }
  function isEnabled(featureKey) {
    if (features.get(featureKey)?.baseline) return true;
    const v = get(featureKey);
    return v !== false;
  }
  function registerFeature(def) {
    if (!def || !def.key) return;
    features.set(def.key, {
      key: def.key,
      label: def.label || def.key,
      description: def.description || '',
      default: def.default !== false,
      hidden: !!def.hidden,
      baseline: !!def.baseline,
      category: def.category || 'features',
    });
  }
  function getFeatures() {
    return [...features.values()];
  }
  function onChange(key, callback) {
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    set.add(callback);
    return () => set.delete(callback);
  }
  function onAnyChange(callback) {
    anySubscribers.add(callback);
    return () => anySubscribers.delete(callback);
  }

  function getFontScale() {
    try {
      return parseInt(localStorage.getItem(FONT_SCALE_KEY), 10) || 100;
    } catch {
      return 100;
    }
  }
  function setFontScale(pct) {
    pct = Math.max(80, Math.min(150, Math.round(pct / 10) * 10));
    document.documentElement.style.setProperty('--font-scale', pct / 100);
    try {
      localStorage.setItem(FONT_SCALE_KEY, String(pct));
    } catch (e) {
      console.warn('Settings: localStorage write failed', e);
    }
    return pct;
  }

  // Runtime default derived from the browser's detected canvas limit.
  // Set by initMaxPngScale() in the export module at startup; falls back to 20
  // until then. User-stored preferences always take priority over this default.
  let _maxPngScaleDefault = 20;

  function initMaxPngScale(detectedArea) {
    if (detectedArea >= 67108864)
      _maxPngScaleDefault = 200; // 64 MP+ — capable desktop browser
    else if (detectedArea >= 16777216)
      _maxPngScaleDefault = 50; // 16 MP — current default
    else _maxPngScaleDefault = 20; // < 16 MP — constrained fallback
  }
  function getMaxPngScale() {
    try {
      return parseInt(localStorage.getItem(MAX_PNG_SCALE_KEY), 10) || _maxPngScaleDefault;
    } catch {
      return _maxPngScaleDefault;
    }
  }
  function setMaxPngScale(n) {
    n = Math.max(10, Math.min(200, Math.round(n / 10) * 10));
    try {
      localStorage.setItem(MAX_PNG_SCALE_KEY, String(n));
    } catch (e) {
      console.warn('Settings: localStorage write failed', e);
    }
    return n;
  }

  function getCustomPrefixes() {
    try {
      return localStorage.getItem(CUSTOM_PREFIXES_KEY) || DEFAULT_PREFIXES;
    } catch {
      return DEFAULT_PREFIXES;
    }
  }
  function setCustomPrefixes(val) {
    try {
      localStorage.setItem(CUSTOM_PREFIXES_KEY, val || DEFAULT_PREFIXES);
    } catch (e) {
      console.warn('Settings: localStorage write failed', e);
    }
  }
  function isCustomName(name) {
    if (!name) return false;
    const prefixes = getCustomPrefixes()
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const n = name.toLowerCase();
    return prefixes.some(p => p && n.startsWith(p));
  }

  return {
    get,
    set,
    isEnabled,
    registerFeature,
    getFeatures,
    onChange,
    onAnyChange,
    notify,
    getFontScale,
    setFontScale,
    getMaxPngScale,
    setMaxPngScale,
    initMaxPngScale,
    getCustomPrefixes,
    setCustomPrefixes,
    isCustomName,
    DEFAULT_PREFIXES,
  };
})();

// Apply persisted font scale before first render
Settings.setFontScale(Settings.getFontScale());

Settings.registerFeature({
  key: 'savedViews',
  label: 'Saved Views',
  description: 'Save and restore named view configurations from the sidebar.',
  default: true,
  category: 'features',
});

Settings.registerFeature({
  key: 'customHighlight',
  label: 'Highlight custom tables & fields',
  description:
    'Mark tables and fields whose names start with a configured prefix with a coloured border on the canvas, a badge in the inspector, and an indicator in the sidebar list. Configure prefixes below. Off by default.',
  default: false,
  category: 'display',
});

Settings.registerFeature({
  key: 'showEdgeLabels',
  label: 'Show field names on edges',
  description:
    "Render reference field names alongside edges in Schema Map for the selected table's neighbourhood. Useful for tracing dot-walks visually; off by default to keep dense graphs readable.",
  default: false,
  category: 'display',
});

Settings.registerFeature({
  key: 'dimOnHover',
  label: 'Dim unrelated tables on hover',
  description:
    'When hovering a table, dim everything that is not directly connected to it. Off by default to keep the canvas calm.',
  default: false,
  category: 'display',
});

Settings.registerFeature({
  key: 'autoFitOnSelect',
  label: 'Auto-fit canvas on selection',
  description:
    'When you click a table, smoothly recenter and zoom the canvas to fit its neighbourhood. Off by default — most users prefer keeping their current viewport.',
  default: false,
  category: 'behaviour',
});

Settings.registerFeature({
  key: 'clearSearchOnSelect',
  label: 'Clear search on selection',
  description:
    'Empties the search box when you click a table from the sidebar or canvas, so the next search starts fresh.',
  default: true,
  category: 'behaviour',
});

Settings.registerFeature({
  key: 'inheritedRefsInspector',
  label: 'Show inherited references in inspector',
  description:
    'When a table is selected, the inspector shows not only that table\'s own outgoing and incoming references, but also those of every ancestor in its inheritance chain. For example, selecting "incident" will also show Task\'s references, since incident extends task. Inherited sections are clearly labelled with the source ancestor and start collapsed. Off by default.',
  default: false,
  category: 'behaviour',
});

Settings.registerFeature({
  key: 'inheritedRefsCanvas',
  label: 'Show inherited edges on canvas',
  description:
    'Extends "Show inherited references in inspector" to also pull ancestor edges into the canvas neighbourhood. When incident is selected, tables that reference task will also appear as neighbours. Can significantly expand the graph on tables with deep inheritance chains — keep Hop Depth at 1 to stay manageable. Off by default. Has no effect unless "Show inherited references in inspector" is also on.',
  default: false,
  hidden: true,
  category: 'behaviour',
});

Settings.registerFeature({
  key: 'tooltipInheritedRefs',
  label: 'Show inherited refs in edge tooltip',
  description:
    'When hovering a reference edge on the canvas, also show inherited reference fields from ancestor tables in the tooltip. Each ancestor that contributes fields to the same target is grouped under a "↳ inherited from …" label. Off by default.',
  default: false,
  category: 'behaviour',
});

Settings.registerFeature({
  key: 'expandedFields',
  label: 'Expanded field view',
  description:
    "Show each selected table's fields inline inside its node rectangle in Schema Map. Useful for at-a-glance schema inspection, but expands nodes vertically and can clutter the canvas — especially on tables with hundreds of fields like cmdb_ci_service. Off by default.",
  default: false,
  category: 'experimental',
});

Settings.registerFeature({
  key: 'checkUpdates',
  label: 'Check for updates',
  description:
    'Once per browser session, check GitHub for a newer release and show a dismissible "update available" badge in the footer. The only network request is a single GET to the public releases API — no telemetry, no usage data. Fails silently when offline. On by default.',
  default: true,
  category: 'behaviour',
});

export function renderSettingsModal() {
  const body = Dom.settingsModalBody;
  body.replaceChildren();

  const features = Settings.getFeatures();
  const featuresByCategory = new Map();
  for (const f of features) {
    if (f.hidden || f.baseline) continue;
    if (!featuresByCategory.has(f.category)) featuresByCategory.set(f.category, []);
    featuresByCategory.get(f.category).push(f);
  }
  for (const arr of featuresByCategory.values()) {
    arr.sort((a, b) => a.label.localeCompare(b.label));
  }

  const CATEGORY_META = {
    features: {
      title: 'Features',
      desc: 'Enable or disable advanced features. Disabled features hide their UI but preserve any saved data so you can re-enable them later.',
    },
    display: {
      title: 'Display',
      desc: 'How information is presented on the canvas and in the inspector.',
    },
    behaviour: { title: 'Behaviour', desc: 'How the application responds to your actions.' },
    experimental: {
      title: 'Experimental',
      desc: 'Off by default. These features work but have rough edges — performance issues on large graphs, layout glitches, or unfinished UX. Try them at your own pace and turn them off if anything misbehaves.',
    },
    export: { title: 'Export', desc: 'Settings that control export quality and limits.' },
  };
  const CATEGORY_ORDER = ['features', 'display', 'behaviour', 'experimental', 'export'];

  for (const cat of CATEGORY_ORDER) {
    const items = featuresByCategory.get(cat) || [];
    // Display section always renders (has the font-size stepper even if no feature toggles)
    if (!items.length && cat !== 'display') continue;
    const meta = CATEGORY_META[cat] || { title: cat, desc: '' };

    const section = h('div', { class: 'settings-section' });
    section.appendChild(h('div', { class: 'settings-section-title' }, meta.title));
    if (meta.desc) {
      section.appendChild(h('div', { class: 'settings-section-desc' }, meta.desc));
    }

    // Font size stepper — injected at the top of the Display section
    if (cat === 'display') {
      let cur = Settings.getFontScale();
      const valEl = h('span', { class: 'setting-stepper-val' }, cur + '%');
      // Don't pass `disabled` through h() — setAttribute('disabled', false) still disables;
      // set the DOM property directly instead.
      const minBtn = h(
        'button',
        {
          class: 'setting-stepper-btn',
          title: 'Decrease font size',
          onClick: () => {
            cur = Settings.setFontScale(cur - 10);
            valEl.textContent = cur + '%';
            minBtn.disabled = cur <= 80;
            plusBtn.disabled = cur >= 150;
          },
        },
        '−'
      );
      minBtn.disabled = cur <= 80;
      const plusBtn = h(
        'button',
        {
          class: 'setting-stepper-btn',
          title: 'Increase font size',
          onClick: () => {
            cur = Settings.setFontScale(cur + 10);
            valEl.textContent = cur + '%';
            minBtn.disabled = cur <= 80;
            plusBtn.disabled = cur >= 150;
          },
        },
        '+'
      );
      plusBtn.disabled = cur >= 150;
      section.appendChild(
        h(
          'div',
          { class: 'setting-row' },
          h(
            'div',
            { class: 'setting-row-text' },
            h('div', { class: 'setting-row-label' }, 'Font size'),
            h(
              'div',
              { class: 'setting-row-desc' },
              'Scale text in the inspector, sidebar, and modals. Range: 80–150%, step 10%.'
            )
          ),
          h('div', { class: 'setting-stepper' }, minBtn, valEl, plusBtn)
        )
      );
    }

    // Custom prefix input — injected at the bottom of the Display section
    if (cat === 'display') {
      const prefixInput = h('input', {
        type: 'text',
        class: 'setting-prefix-input',
        value: Settings.getCustomPrefixes(),
        placeholder: Settings.DEFAULT_PREFIXES,
        title: 'Comma-separated prefixes for "Highlight custom tables & fields"',
        onBlur: e => {
          Settings.setCustomPrefixes(e.target.value.trim());
          Settings.notify('customHighlight', Settings.isEnabled('customHighlight'));
        },
        onKeydown: e => {
          if (e.key === 'Enter') e.target.blur();
        },
      });
      section.appendChild(
        h(
          'div',
          { class: 'setting-row' },
          h(
            'div',
            { class: 'setting-row-text' },
            h('div', { class: 'setting-row-label' }, 'Custom prefixes'),
            h(
              'div',
              { class: 'setting-row-desc' },
              'Comma-separated name prefixes used by "Highlight custom tables & fields". Any table or field starting with one of these is marked as custom. Default: ' +
                Settings.DEFAULT_PREFIXES
            )
          ),
          prefixInput
        )
      );
    }

    for (const f of items) {
      const enabled = Settings.isEnabled(f.key);
      const toggle = h('div', {
        class: 'setting-toggle' + (enabled ? ' on' : ''),
        role: 'switch',
        'aria-checked': String(enabled),
        title: enabled ? 'Click to disable' : 'Click to enable',
        onClick: () => {
          const newVal = !Settings.isEnabled(f.key);
          Settings.set(f.key, newVal);
          toggle.classList.toggle('on', newVal);
          toggle.setAttribute('aria-checked', String(newVal));
          toggle.title = newVal ? 'Click to disable' : 'Click to enable';
        },
      });
      section.appendChild(
        h(
          'div',
          { class: 'setting-row' },
          h(
            'div',
            { class: 'setting-row-text' },
            h('div', { class: 'setting-row-label' }, f.label),
            h('div', { class: 'setting-row-desc' }, f.description)
          ),
          toggle
        )
      );
    }
    body.appendChild(section);
  }

  if (!features.length) {
    body.appendChild(h('div', { class: 'settings-empty' }, 'No settings available.'));
  }

  body.appendChild(
    h(
      'div',
      { class: 'settings-actions' },
      h(
        'button',
        {
          class: 'settings-reset-btn',
          title: 'Restore all settings to their defaults',
          onClick: () => {
            if (
              !confirm(
                'Reset all settings to defaults? This will not delete your saved views or data.'
              )
            )
              return;
            try {
              localStorage.removeItem('snse:settings:v1');
              localStorage.removeItem('snse:fontScale:v1');
              localStorage.removeItem('snse:maxPngScale:v1');
              localStorage.removeItem('snse:customPrefixes:v1');
              localStorage.removeItem('snse:pngExportScale');
              localStorage.removeItem('snse:exportBgColor');
              localStorage.removeItem('snse:pfConfig:v1');
              localStorage.removeItem('snse:panelWidths:v1');
            } catch {}
            location.reload();
          },
        },
        'Reset to defaults'
      )
    )
  );
}

export const isMobile = () => window.innerWidth <= 768;

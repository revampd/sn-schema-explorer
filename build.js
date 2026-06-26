#!/usr/bin/env node
/* ============================================================================
 * Unified build script
 * ============================================================================
 * Usage:
 *   node build.js app           → dist/sn_schema_explorer.html
 *   node build.js exporter      → dist/exporter/*
 *   node build.js all           → all of the above
 * ============================================================================ */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const rel = (...p) => join(__dir, ...p);

// HTML-escape a string for safe embedding inside a <pre> element.
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Inline D3 — read from node_modules so the output has zero CDN dependencies.
const _d3Source = readFileSync(rel('node_modules/d3/dist/d3.min.js'), 'utf8');
const D3_INLINE = `<script>\n${_d3Source}\n</script>`;

// Build version + timestamp — computed once so all targets share the same stamp.
const _pkg = JSON.parse(readFileSync(rel('package.json'), 'utf8'));
const _buildDate = (() => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
})();
const BUILD_VERSION_HTML = `<span class="footer-build">${_pkg.version}-${_buildDate}</span>`;

// ── Target definitions ───────────────────────────────────────────────────────

const BASE_CSS = [
  'src/viewer/styles/core.css',
  'src/viewer/modules/export/index.css',
  'src/viewer/modules/load/index.css',
  'src/viewer/modules/saved-views/index.css',
  'src/viewer/modules/schema-map/index.css',
  'src/viewer/shared/inspector.css',
  'src/viewer/modules/reference/index.css',
  'src/viewer/modules/guide/index.css',
  'src/viewer/modules/settings/index.css',
];

const FOOTER_DISCLAIMER = `  <span class="footer-disclaimer">
    Not affiliated with or endorsed by ServiceNow, Inc. ServiceNow is a registered trademark of ServiceNow, Inc.
  </span>`;

const VIEWER_TARGETS = {
  app: {
    entry: rel('src/viewer/entries/full.js'),
    css: [
      ...BASE_CSS,
      'src/viewer/modules/path-finder/index.css',
      'src/viewer/modules/schema-diff/index.css',
    ],
    features: ['path-finder', 'schema-diff', 'setup'],
    title: 'Schema Explorer',
    output: rel('dist/sn_schema_explorer.html'),
  },
};

// HTML partials injected per feature
const FEATURE_PARTIALS = {
  'path-finder': {
    toolbar: 'src/viewer/modules/path-finder/toolbar.html',
    'pf-sidebar': 'src/viewer/modules/path-finder/sidebar.html',
  },
  'schema-diff': {
    toolbar: 'src/viewer/modules/schema-diff/toolbar.html',
    'diff-sidebar': 'src/viewer/modules/schema-diff/sidebar.html',
  },
  setup: {
    'setup-instructions': 'src/viewer/modules/load/setup-instructions.html',
  },
};

// Ordered list of all guide modules — determines tab order in the guide modal.
// feature: optional — only included when that feature is in the target's features array.
const GUIDE_MODULES = [
  { file: 'src/viewer/modules/guide/guide-overview.html' },
  { file: 'src/viewer/modules/load/guide.html' },
  { file: 'src/viewer/modules/guide/guide-navigation.html' },
  { file: 'src/viewer/modules/schema-map/guide-filters.html' },
  { file: 'src/viewer/modules/guide/guide-inspector.html' },
  { file: 'src/viewer/modules/settings/guide.html' },
  { file: 'src/viewer/modules/schema-map/guide-tips.html' },
  { file: 'src/viewer/modules/path-finder/guide.html', feature: 'path-finder' },
  { file: 'src/viewer/modules/schema-diff/guide.html', feature: 'schema-diff' },
];

function assembleGuide(features) {
  let tabs = '',
    panels = '',
    first = true;
  const SEP = '<!-- GUIDE:PANEL -->';
  for (const m of GUIDE_MODULES) {
    if (m.feature && !features.includes(m.feature)) continue;
    let content;
    try {
      content = readFileSync(rel(m.file), 'utf8');
    } catch {
      continue;
    }
    const splitIdx = content.indexOf(SEP);
    if (splitIdx === -1) continue;
    let tab = content
      .slice(0, splitIdx)
      .replace(/<!--\s*GUIDE:TAB\s*-->/, '')
      .trim();
    let panel = content.slice(splitIdx + SEP.length).trim();
    if (first) {
      tab = tab.replace(/class="g-tab"/, 'class="g-tab active"');
      panel = panel.replace(/class="g-panel"/, 'class="g-panel active"');
      first = false;
    }
    tabs += tab + '\n';
    panels += panel + '\n';
  }
  return { tabs, panels };
}

// Base HTML partials — always injected (not feature-gated).
// Order matters: partials that contain sub-markers must come before those sub-markers.
const BASE_PARTIALS = [
  // marker                     file path
  ['export-toolbar', 'src/viewer/modules/export/toolbar.html'],
  ['schema-map-sidebar', 'src/viewer/modules/schema-map/sidebar.html'],
  ['load-overlay', 'src/viewer/modules/load/overlay.html'],
  ['schema-map-overlays', 'src/viewer/modules/schema-map/canvas-overlays.html'],
  ['context-menu', 'src/viewer/modules/schema-map/context-menu.html'],
  ['reference-modal', 'src/viewer/modules/reference/modal.html'],
  ['settings-modal', 'src/viewer/modules/settings/modal.html'],
  ['guide-modal', 'src/viewer/modules/guide/modal.html'],
];

// ── Viewer build ─────────────────────────────────────────────────────────────

async function buildViewer(targetName) {
  const t = VIEWER_TARGETS[targetName];
  if (!t) {
    console.error(`Unknown target: ${targetName}`);
    process.exit(1);
  }

  console.log(`Building ${targetName}...`);

  // 1. Bundle JS with esbuild
  let bundledJS = '';
  try {
    const result = await esbuild.build({
      entryPoints: [t.entry],
      bundle: true,
      format: 'iife',
      target: 'es2020',
      minify: false,
      write: false,
      logLevel: 'warning',
    });
    bundledJS = result.outputFiles[0].text;
  } catch (e) {
    console.error(`  esbuild failed for ${targetName}:`, e.message);
    process.exit(1);
  }

  // 2. Assemble CSS
  const css = t.css.map(f => readFileSync(rel(f), 'utf8')).join('\n');

  // 3. Read shell template
  let html = readFileSync(rel('src/viewer/html/shell.html'), 'utf8');

  // 4. Resolve feature HTML partials
  const toolbarExtras = resolvePartials(t.features, 'toolbar');
  const pfSidebar = resolvePartialFile(t.features, 'path-finder', 'pf-sidebar');
  const diffSidebar = resolvePartialFile(t.features, 'schema-diff', 'diff-sidebar');
  const setupInstr = resolvePartialFile(t.features, 'setup', 'setup-instructions');

  // 5. Inject all markers — base partials first (they may contain sub-markers),
  //    then feature partials, then footer + JS.
  //
  // IMPORTANT: all replacements use a function (() => value) so that special
  // replacement patterns in the content ($&, $', $`, $1…) are never interpreted.
  // The injected partials (especially setup-instructions.html) contain exporter
  // JavaScript with bare $ characters that would otherwise corrupt the output.
  const inj = content => () => content;

  html = html
    .replace('<!--INJECT:d3-->', inj(D3_INLINE))
    .replace('<!--INJECT:title-->', inj(t.title))
    .replace('<!--INJECT:css-->', inj('\n' + css + '\n'))
    .replace('<!--INJECT:toolbar-extras-->', inj(toolbarExtras));

  // Base partials (always present)
  for (const [marker, path] of BASE_PARTIALS) {
    html = html.replace(`<!--INJECT:${marker}-->`, inj(readFileSync(rel(path), 'utf8')));
  }

  // Assemble guide tabs + panels from per-module guide files
  const { tabs: guideTabs, panels: guidePanels } = assembleGuide(t.features);

  // Feature/variant partials resolved after base (some live inside base partials)
  html = html
    .replace('<!--INJECT:pf-sidebar-->', inj(pfSidebar))
    .replace('<!--INJECT:diff-sidebar-->', inj(diffSidebar))
    .replace('<!--INJECT:setup-instructions-->', inj(setupInstr))
    .replace('<!--INJECT:guide-tabs-->', inj(guideTabs))
    .replace('<!--INJECT:guide-panels-->', inj(guidePanels))
    .replace('<!--INJECT:footer-disclaimer-->', inj(FOOTER_DISCLAIMER))
    .replace('<!--INJECT:build-version-->', inj(BUILD_VERSION_HTML))
    .replace('<!--INJECT:js-->', inj(`<script>\n${bundledJS}\n</script>`));

  // 6. Inject exporter scripts into <pre> blocks in the Setup Instructions tab
  if (t.features.includes('setup')) {
    const bgPath = rel('dist/exporter/sn-schema-export.bg.js');
    const nodePath = rel('dist/exporter/sn-schema-export.node.standalone.js');
    if (!existsSync(bgPath) || !existsSync(nodePath)) {
      throw new Error(
        'Exporter dist files are missing — the app build embeds them into the ' +
          'Setup Instructions tab.\nRun `node build.js all` (or `node build.js exporter` ' +
          'first) before building the app.'
      );
    }
    const bgSrc = readFileSync(bgPath, 'utf8');
    const nodeSrc = readFileSync(nodePath, 'utf8');
    html = html
      .replace('<!--INJECT:exporter-bg-->', inj(escHtml(bgSrc)))
      .replace('<!--INJECT:exporter-node-->', inj(escHtml(nodeSrc)));
  }

  // 7. Write output
  mkdirSync(rel('dist'), { recursive: true });
  writeFileSync(t.output, html);
  const lines = html.split('\n').length;
  console.log(`  → ${t.output.replace(__dir, '.')} (${lines.toLocaleString()} lines)`);
}

function resolvePartials(features, key, readFile = false) {
  const parts = [];
  for (const f of features) {
    const defs = FEATURE_PARTIALS[f];
    if (!defs || !defs[key]) continue;
    const val = defs[key];
    if (!val) continue;
    if (readFile || val.endsWith('.html')) {
      try {
        parts.push(readFileSync(rel(val), 'utf8'));
      } catch {
        /* partial not yet created */
      }
    } else {
      parts.push(val);
    }
  }
  return parts.join('\n');
}

function resolvePartialFile(features, featureName, key) {
  if (!features.includes(featureName)) return '';
  const defs = FEATURE_PARTIALS[featureName];
  if (!defs || !defs[key]) return '';
  const path = defs[key];
  try {
    return readFileSync(rel(path), 'utf8');
  } catch {
    return '';
  }
}

// ── Exporter build ───────────────────────────────────────────────────────────

function buildExporter() {
  console.log('Building exporter...');
  const root = rel('src/exporter');
  const distDir = rel('dist/exporter');
  mkdirSync(distDir, { recursive: true });
  mkdirSync(join(distDir, 'shared'), { recursive: true });

  // Remove stale output files that no longer have a source (e.g. removed exporters).
  // Without this, old files from previous builds persist in dist/ indefinitely.
  const staleExporterFiles = ['sn-schema-export.rest.js'];
  for (const f of staleExporterFiles) {
    try {
      unlinkSync(join(distDir, f));
    } catch (_) {
      /* already gone */
    }
  }

  // Ensure Node.js treats all files in dist/exporter/ as CommonJS, regardless
  // of the root package.json "type":"module" setting.  Without this, Node.js
  // loads schema-builder.js as ESM (no `module` binding), the UMD CJS branch
  // never fires, and require() returns {} — making SchemaBuilder null/empty.
  writeFileSync(
    join(distDir, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
  );

  const builder = readFileSync(join(root, 'shared/schema-builder.js'), 'utf8');

  function spliceMarker(src) {
    return src.replace(
      /\/\/<SCHEMA_BUILDER>[\s\S]*?\/\/<\/SCHEMA_BUILDER>/,
      '//<SCHEMA_BUILDER>\n' + builder + '\n//</SCHEMA_BUILDER>'
    );
  }

  // Background script — self-contained (schema-builder inlined)
  const bg = readFileSync(join(root, 'background/sn-schema-export.bg.js'), 'utf8');
  writeFileSync(join(distDir, 'sn-schema-export.bg.js'), spliceMarker(bg));

  // Node script — ships alongside shared module; rewrite require path for dist layout
  const nodeSrc = readFileSync(join(root, 'node/sn-schema-export.node.js'), 'utf8');
  writeFileSync(
    join(distDir, 'sn-schema-export.node.js'),
    nodeSrc.replace(
      "require('../shared/schema-builder.js')",
      "require('./shared/schema-builder.js')"
    )
  );
  copyFileSync(join(root, 'shared/schema-builder.js'), join(distDir, 'shared/schema-builder.js'));

  // Node standalone — schema-builder inlined, zero external dependencies
  const inlineNode = nodeSrc.replace(
    "const SchemaBuilder = require('../shared/schema-builder.js');",
    '// ── INLINED SchemaBuilder (see https://github.com/.../shared/schema-builder.js for source) ──\n' +
      'const SchemaBuilder = (function(){ const module = { exports: {} }; \n' +
      builder +
      '\nreturn module.exports; })();'
  );
  writeFileSync(join(distDir, 'sn-schema-export.node.standalone.js'), inlineNode);

  console.log(`  → dist/exporter/ (bg, node, node.standalone, shared/)`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node build.js <app|exporter|all>');
  process.exit(1);
}

const targets = args.includes('all') ? ['exporter', 'app'] : args;

// app reads dist/exporter/* for the Setup Instructions tab — build exporter first.
if (targets.includes('app') && !targets.includes('exporter')) {
  buildExporter();
}

for (const t of targets) {
  if (t === 'exporter') {
    buildExporter();
  } else {
    await buildViewer(t);
  }
}
console.log('Done.');

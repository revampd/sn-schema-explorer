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
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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
const BUILD_VERSION_HTML = `v${_pkg.version}`;

// ── Target definitions ───────────────────────────────────────────────────────

const FOOTER_DISCLAIMER = `  <span class="footer-disclaimer">
    Not affiliated with or endorsed by ServiceNow, Inc. ServiceNow is a registered trademark of ServiceNow, Inc.
  </span>`;

// ── Manifest-driven assembly ───────────────────────────────────────────────
// app.meta.js (core/app styles) plus each modules/<name>/module.meta.js are the
// single source of truth for the build's path arrays. We glob the manifests and
// assemble the CSS cascade (sorted by the shared `order` scale), the base + per-
// feature HTML partials, the guide tab order, and the enabled-feature list — so
// adding a feature is just dropping a folder with a manifest, no edits here.
const MODULES_DIR = 'src/modules';

async function loadManifests() {
  const core = (await import(pathToFileURL(rel('src/app/app.meta.js')).href)).default;
  const modules = [];
  for (const name of readdirSync(rel(MODULES_DIR)).sort()) {
    const metaPath = rel(MODULES_DIR, name, 'module.meta.js');
    if (!existsSync(metaPath)) continue;
    const m = { ...(await import(pathToFileURL(metaPath).href)).default };
    m._dir = `${MODULES_DIR}/${name}`; // repo-relative module dir for path joins
    modules.push(m);
  }
  return { core, modules };
}

// A module's assets are included when it declares no feature, or its feature is
// enabled in the target.
const moduleIncluded = (m, features) => !m.feature || features.includes(m.feature);

// The single app target enables every feature any module declares. Sorted by
// module `order` so feature-iteration order (e.g. toolbar-extras concatenation)
// is deterministic.
function deriveFeatures(modules) {
  return [
    ...new Set(
      modules
        .filter(m => m.feature)
        .sort((a, b) => a.order - b.order)
        .map(m => m.feature)
    ),
  ];
}

function assembleCss(core, modules, features) {
  const entries = core.css.map(c => ({ file: c.file, order: c.order }));
  for (const m of modules) {
    if (!moduleIncluded(m, features)) continue;
    for (const c of m.css || []) entries.push({ file: `${m._dir}/${c.file}`, order: c.order });
  }
  return entries.sort((a, b) => a.order - b.order).map(e => e.file);
}

// Base partials replace fixed shell.html markers, so injection order does not
// affect output; we still sort by module order for a stable, readable build.
function assembleBasePartials(modules, features) {
  const out = [];
  for (const m of [...modules].sort((a, b) => a.order - b.order)) {
    if (!moduleIncluded(m, features) || !m.partials) continue;
    for (const [marker, file] of Object.entries(m.partials))
      out.push([marker, `${m._dir}/${file}`]);
  }
  return out;
}

function assembleFeaturePartials(modules) {
  const fp = {};
  for (const m of modules) {
    if (!m.featurePartials) continue;
    fp[m.feature] = fp[m.feature] || {};
    for (const [k, file] of Object.entries(m.featurePartials))
      fp[m.feature][k] = `${m._dir}/${file}`;
  }
  return fp;
}

// Guide tabs concatenate in `order` — that order IS the visible tab order.
function assembleGuideModules(modules) {
  const g = [];
  for (const m of modules) {
    for (const gi of m.guide || []) {
      g.push({ file: `${m._dir}/${gi.file}`, order: gi.order, feature: m.feature });
    }
  }
  return g.sort((a, b) => a.order - b.order);
}

// Feature modules the app entry imports directly, in module `order`. The core
// platform + bootstrap (init + hook injection) live in src/app/main.js, imported
// first; these self-registering feature modules are imported after it.
function assembleFeatureEntries(modules) {
  return modules
    .filter(m => m.entryImports)
    .sort((a, b) => a.order - b.order)
    .flatMap(m => m.entryImports.map(f => `${m._dir}/${f}`));
}

// Populated by initBuild() from the manifests before any viewer build runs.
let FEATURE_PARTIALS = {};
let GUIDE_MODULES = [];
let BASE_PARTIALS = [];
const VIEWER_TARGETS = {
  app: {
    main: rel('src/app/main.js'),
    featureEntries: [],
    css: [],
    features: [],
    title: 'Schema Explorer',
    output: rel('dist/sn_schema_explorer.html'),
  },
};

async function initBuild() {
  const { core, modules } = await loadManifests();
  const features = deriveFeatures(modules);
  VIEWER_TARGETS.app.features = features;
  VIEWER_TARGETS.app.css = assembleCss(core, modules, features);
  VIEWER_TARGETS.app.featureEntries = assembleFeatureEntries(modules);
  BASE_PARTIALS = assembleBasePartials(modules, features);
  FEATURE_PARTIALS = assembleFeaturePartials(modules);
  GUIDE_MODULES = assembleGuideModules(modules);
}

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

// ── Viewer build ─────────────────────────────────────────────────────────────

async function buildViewer(targetName) {
  const t = VIEWER_TARGETS[targetName];
  if (!t) {
    console.error(`Unknown target: ${targetName}`);
    process.exit(1);
  }

  console.log(`Building ${targetName}...`);

  // 1. Bundle JS with esbuild. The entry is synthesized from the manifests:
  //    main.js (core platform + bootstrap init) is imported first, then each
  //    self-registering feature module in manifest order. Equivalent to the old
  //    full.js (= lite.js + feature imports), now manifest-driven.
  const entryContents =
    [t.main, ...t.featureEntries.map(p => rel(p))]
      .map(p => `import ${JSON.stringify(p)};`)
      .join('\n') + '\n';
  let bundledJS = '';
  try {
    const result = await esbuild.build({
      stdin: {
        contents: entryContents,
        resolveDir: __dir,
        sourcefile: 'main.entry.js',
        loader: 'js',
      },
      bundle: true,
      format: 'iife',
      target: 'es2020',
      minify: false,
      write: false,
      logLevel: 'warning',
      // Inject the package version so the viewer can compare against the latest
      // GitHub release (update-check). Replaced at build time; defaults to
      // '0.0.0' in non-build contexts (e.g. unit tests) so the check is inert.
      define: { __APP_VERSION__: JSON.stringify(_pkg.version) },
    });
    bundledJS = result.outputFiles[0].text;
  } catch (e) {
    console.error(`  esbuild failed for ${targetName}:`, e.message);
    process.exit(1);
  }

  // 2. Assemble CSS
  const css = t.css.map(f => readFileSync(rel(f), 'utf8')).join('\n');

  // 3. Read shell template
  let html = readFileSync(rel('src/app/shell.html'), 'utf8');

  // 4. Resolve feature HTML partials
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
    .replace('<!--INJECT:css-->', inj('\n' + css + '\n'));

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
  const root = rel('src/exporters');
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
  // bg serialisers live in a sibling source file and are spliced back into the
  // single self-contained bg script (ES5/Rhino has no runtime module system).
  const bgSerialisers = readFileSync(join(root, 'background/serialisers.bg.js'), 'utf8').replace(
    /\n$/,
    ''
  );

  function spliceMarker(src) {
    return src
      .replace(
        /\/\/<SCHEMA_BUILDER>[\s\S]*?\/\/<\/SCHEMA_BUILDER>/,
        '//<SCHEMA_BUILDER>\n' + builder + '\n//</SCHEMA_BUILDER>'
      )
      .replace(
        /\/\/<SERIALISERS>[\s\S]*?\/\/<\/SERIALISERS>/,
        '//<SERIALISERS>\n' + bgSerialisers + '\n//</SERIALISERS>'
      );
  }

  // Background script — self-contained (schema-builder + serialisers inlined)
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
  // Format serialisers ship next to the node script (required as ./serialisers.js — same dir).
  copyFileSync(join(root, 'node/serialisers.js'), join(distDir, 'serialisers.js'));

  // Node standalone — schema-builder + serialisers inlined, zero external dependencies
  const serialisers = readFileSync(join(root, 'node/serialisers.js'), 'utf8');
  const inlineNode = nodeSrc
    .replace(
      "const SchemaBuilder = require('../shared/schema-builder.js');",
      '// ── INLINED SchemaBuilder (see https://github.com/.../shared/schema-builder.js for source) ──\n' +
        'const SchemaBuilder = (function(){ const module = { exports: {} }; \n' +
        builder +
        '\nreturn module.exports; })();'
    )
    .replace(
      "const Serialisers = require('./serialisers.js');",
      '// ── INLINED Serialisers (see https://github.com/.../node/serialisers.js for source) ──\n' +
        'const Serialisers = (function(){ const module = { exports: {} }; \n' +
        serialisers +
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

// Assemble the build's path arrays from the per-module manifests before any
// viewer build consumes them.
if (targets.includes('app')) {
  await initBuild();
}

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

/* ============================================================================
 * app.meta.js — core/platform build manifest
 * ============================================================================
 *
 * The non-module, app-global stylesheets (styles/*.css + shared/inspector.css).
 * build.js merges these with every module's `module.meta.js` and sorts the whole
 * set by `order` to produce the CSS cascade — so this file plus the module
 * manifests are the single source of truth for the build's path arrays.
 *
 * `order` is a shared cascade scale across core + all modules (see each
 * module.meta.js). Paths are repo-relative.
 * ============================================================================ */
export default {
  name: 'app',
  css: [
    { file: 'src/viewer/styles/base.css', order: 100 },
    { file: 'src/viewer/styles/panels.css', order: 110 },
    { file: 'src/viewer/styles/header.css', order: 120 },
    { file: 'src/viewer/styles/footer.css', order: 130 },
    { file: 'src/viewer/shared/inspector.css', order: 200 },
    { file: 'src/viewer/styles/workspace.css', order: 290 },
  ],
};

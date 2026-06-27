/* export — schema-export toolbar + serialisers. See app.meta.js for the manifest
 * contract; `css[].order` is the shared cascade scale, paths are module-relative. */
export default {
  name: 'export',
  order: 40,
  css: [{ file: 'index.css', order: 140 }],
  partials: { 'export-toolbar': 'toolbar.html' },
  entry: 'index.js',
};

/* schema-diff — compare two registered instances. Gated on the 'schema-diff'
 * feature. Its toolbar partial joins the shared toolbar-extras region. */
export default {
  name: 'schema-diff',
  order: 140,
  feature: 'schema-diff',
  css: [{ file: 'index.css', order: 330 }],
  featurePartials: { toolbar: 'toolbar.html', 'diff-sidebar': 'sidebar.html' },
  guide: [{ file: 'guide.html', order: 9 }],
  entry: 'index.js',
  entryImports: ['index.js'],
};

/* schema-diff — compare two registered instances. Gated on the 'schema-diff'
 * feature. Entered from the header tool switcher / an instance-card tool. */
export default {
  name: 'schema-diff',
  order: 140,
  feature: 'schema-diff',
  css: [{ file: 'index.css', order: 330 }],
  featurePartials: { 'diff-sidebar': 'sidebar.html' },
  guide: [{ file: 'guide.html', order: 9 }],
  entry: 'index.js',
  entryImports: ['index.js'],
};

/* path-finder — shortest dot-walk path finder. Gated on the 'path-finder'
 * feature. Its toolbar partial joins the shared toolbar-extras region. */
export default {
  name: 'path-finder',
  order: 130,
  feature: 'path-finder',
  css: [{ file: 'index.css', order: 320 }],
  featurePartials: { toolbar: 'toolbar.html', 'pf-sidebar': 'sidebar.html' },
  guide: [{ file: 'guide.html', order: 8 }],
  entry: 'index.js',
  // Files the app entry imports directly (index.js does not pull autocomplete.js).
  entryImports: ['index.js', 'autocomplete.js'],
};

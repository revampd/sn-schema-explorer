/* load — landing file-drop / demo / manifest stitching + Setup Instructions. The
 * setup-instructions partial is feature-gated under 'setup'. */
export default {
  name: 'load',
  order: 50,
  feature: 'setup',
  css: [{ file: 'index.css', order: 150 }],
  featurePartials: { 'setup-instructions': 'setup-instructions.html' },
  entry: 'index.js',
};

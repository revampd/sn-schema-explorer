/* config-data — Configuration Data workspace (cross-instance reconcile). Gated on
 * the 'configData' Settings feature. */
export default {
  name: 'config-data',
  order: 120,
  feature: 'configData',
  css: [{ file: 'index.css', order: 310 }],
  partials: { 'config-data': 'region.html' },
  guide: [{ file: 'guide.html', order: 10 }],
  entry: 'index.js',
};

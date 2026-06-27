/* config-overlay — the Config lens projected onto the Schema Map as a toggleable
 * "config drift" layer (#133, part of the integrated-lenses epic #130). Gated on
 * the 'configData' Settings feature, like the Configuration Data workspace it
 * shares its drift classification with. */
export default {
  name: 'config-overlay',
  order: 155,
  feature: 'configData',
  css: [{ file: 'index.css', order: 174 }],
  entry: 'index.js',
  entryImports: ['index.js'],
};

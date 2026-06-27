/* settings — the Settings modal + feature registry. */
export default {
  name: 'settings',
  order: 90,
  css: [{ file: 'index.css', order: 230 }],
  partials: { 'settings-modal': 'modal.html' },
  guide: [{ file: 'guide.html', order: 6 }],
  entry: 'index.js',
};

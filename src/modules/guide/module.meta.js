/* guide — the help/guide modal and the core guide tabs (overview / navigation /
 * inspector). `guide[].order` is the guide-tab scale shared across modules. */
export default {
  name: 'guide',
  order: 80,
  css: [{ file: 'index.css', order: 220 }],
  partials: { 'guide-modal': 'modal.html' },
  guide: [
    { file: 'guide-overview.html', order: 1 },
    { file: 'guide-navigation.html', order: 3 },
    { file: 'guide-inspector.html', order: 5 },
  ],
};

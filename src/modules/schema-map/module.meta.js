/* schema-map — the graph canvas: sidebar, canvas, edges, chrome styles, plus the
 * sidebar / canvas-overlays / context-menu regions and two guide tabs. Its JS is
 * imported by the core bootstrap (controls.js / interactions.js), so no `entry`. */
export default {
  name: 'schema-map',
  order: 30,
  css: [
    { file: 'sidebar.css', order: 170 },
    { file: 'canvas.css', order: 171 },
    { file: 'edges.css', order: 172 },
    { file: 'chrome.css', order: 173 },
  ],
  partials: {
    'schema-map-sidebar': 'sidebar.html',
    'schema-map-overlays': 'canvas-overlays.html',
    'context-menu': 'context-menu.html',
  },
  guide: [
    { file: 'guide-filters.html', order: 4 },
    { file: 'guide-tips.html', order: 7 },
  ],
};

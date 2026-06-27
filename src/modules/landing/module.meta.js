/* landing — the front-door instance registry. landing.html holds the
 * <!--INJECT:setup-instructions--> sub-marker, filled in the feature-partial pass. */
export default {
  name: 'landing',
  order: 110,
  css: [{ file: 'index.css', order: 300 }],
  partials: { 'landing-root': 'landing.html' },
  guide: [{ file: 'guide.html', order: 2 }],
  entry: 'index.js',
};

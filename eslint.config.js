import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config.
 *
 * The repo has four distinct execution environments, each with its own globals
 * and module system:
 *   - src/{core,modules,app}/**  ESM, runs in the browser (d3 injected as a global)
 *   - src/exporters/node/**     CommonJS, runs in Node
 *   - src/exporters/shared/**   UMD (works in both Node and Rhino)
 *   - src/exporters/background/ ES5 script, runs inside ServiceNow (Rhino + Glide* globals)
 *
 * Rules are intentionally pragmatic — correctness/bug rules stay as errors,
 * stylistic concerns are delegated to Prettier (eslint-config-prettier disables them).
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,

  // Shared rule tweaks across all files. The three downgraded rules flag code
  // smells, not bugs — kept visible as warnings rather than failing CI.
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },

  // Browser viewer — ESM
  {
    files: ['src/core/**/*.js', 'src/modules/**/*.js', 'src/app/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // d3 is injected inline; __APP_VERSION__ is replaced at build time by esbuild.
      globals: { ...globals.browser, d3: 'readonly', __APP_VERSION__: 'readonly' },
    },
  },

  // Node CLI exporter — CommonJS (require / module.exports), ES5 var idioms
  {
    files: ['src/exporters/node/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    // ES5 `var` reuse across sibling loops is intentional in these scripts.
    rules: { 'no-redeclare': 'off' },
  },

  // Shared UMD builder — runs in both Node and Rhino
  {
    files: ['src/exporters/shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { 'no-redeclare': 'off' },
  },

  // Build tooling — ESM (repo is "type": "module")
  {
    files: ['build.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Benchmark — ESM Node driver that also runs browser code via page.evaluate()
  {
    files: ['benchmark/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // ServiceNow background script — ES5, Rhino engine, Glide* server globals
  {
    files: ['src/exporters/background/**/*.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      globals: {
        gs: 'readonly',
        GlideRecord: 'readonly',
        GlideRecordSecure: 'readonly',
        GlideAggregate: 'readonly',
        GlideStringUtil: 'readonly',
        GlideSysAttachment: 'readonly',
        GlideDateTime: 'readonly',
        Packages: 'readonly',
        current: 'readonly',
        JSON: 'readonly',
        // SchemaBuilder is inlined into the bg script at build time.
        SchemaBuilder: 'readonly',
        // CONFIG is the run-config object declared in sn-schema-export.bg.js;
        // the spliced-in serialisers (serialisers.bg.js) read it.
        CONFIG: 'readonly',
        // Serialiser entry points live in serialisers.bg.js and are spliced into
        // the bg script at build time; the main script calls them.
        serializeMarkdownBg: 'readonly',
        serializeJsonLdBg: 'readonly',
      },
    },
    rules: { 'no-redeclare': 'off' },
  },

  // ESM config files at repo root
  {
    files: ['*.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },

  // Tests — Vitest/Playwright (globals imported explicitly). e2e specs run
  // browser code inside page.evaluate() callbacks, so allow browser globals too.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  prettier,
];

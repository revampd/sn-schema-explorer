import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // Only JS sources (the .html partials can't be parsed by the v8 remapper).
      include: ['src/**/*.js'],
      // Ratcheted floor — set just below current measured coverage so regressions
      // fail CI without blocking today. Raised in Phase 4 after adding the
      // graph-state, filter-memoisation, and feature e2e tests.
      // NOTE: the exporter sources (schema-builder.js, sn-schema-export.node.js)
      // are loaded in tests via readFileSync + new Function, so v8 never
      // instruments them (always 0 covered). Adding exporter code therefore grows
      // the denominator without adding instrumented coverage, mechanically
      // lowering the global pct. The v1.0.3 metadata sections (#97) added ~200
      // such lines, so this floor was re-ratcheted down to match — despite the
      // test count increasing. Real exporter logic is covered by the unit tests.
      thresholds: {
        statements: 24.8,
        branches: 21.5,
        functions: 27.9,
        lines: 25.0,
      },
    },
  },
});

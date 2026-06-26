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
      thresholds: {
        statements: 10,
        branches: 10,
        functions: 10,
        lines: 10,
      },
    },
  },
});

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
      // fail CI without blocking today. Raise these as Phase 4 adds tests.
      thresholds: {
        statements: 5,
        branches: 5,
        functions: 5,
        lines: 5,
      },
    },
  },
});

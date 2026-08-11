import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@aura/db',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests need the Postgres container that only
    // vitest.integration.config.ts starts. Without this they get picked up by
    // the fast gate and fail for want of a database.
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Test infrastructure, exercised by the integration run rather than
        // this one.
        'src/testing/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});

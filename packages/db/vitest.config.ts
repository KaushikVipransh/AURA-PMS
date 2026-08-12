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
    // These tests import the generated Prisma client and, in enum-drift, the
    // whole of Zod. On a warm Vite cache that costs ~200ms; on a cold one --
    // CI, a fresh clone, or the first run after `prisma generate` -- it took
    // over the 5s default and failed a test that asserts nothing about speed.
    // Raising the ceiling keeps the assertion intact; leaving it would have
    // made a side-effect guard fail for being slow.
    testTimeout: 30_000,
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

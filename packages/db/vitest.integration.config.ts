import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Postgres in a disposable container, real migrations,
 * real constraints. Kept separate from the unit config so `pnpm verify` stays
 * fast and does not require Docker.
 */
export default defineConfig({
  test: {
    name: 'db:integration',
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./src/testing/global-setup.ts'],
    // One container shared by all files; a transaction-per-test gives the
    // isolation instead. Parallel workers would each want their own database.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

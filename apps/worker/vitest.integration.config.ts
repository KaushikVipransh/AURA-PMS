import { defineConfig } from 'vitest/config';

/**
 * Worker integration tests: real Postgres, real pg-boss, real migrations.
 *
 * Reuses `@aura/db`'s global setup — the same disposable container the API
 * suite uses — so the sweep runs against the constraints production has,
 * including `@@unique([cycleId, subjectUserId, rule])`, which is the thing
 * that makes the nightly job idempotent rather than merely intended to be.
 *
 * `RESEND_API_KEY` is deliberately absent, so `emailAdapterFromEnv` resolves
 * to the no-op adapter and no test can reach a real provider even by mistake.
 */
export default defineConfig({
  test: {
    name: 'worker:integration',
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['@aura/db/testing/global-setup'],
    env: { NODE_ENV: 'test', WORKER_AUTOSTART: 'off' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

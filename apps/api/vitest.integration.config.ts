import { defineConfig } from 'vitest/config';

/**
 * API integration tests: real Postgres, real migrations, real Better Auth.
 *
 * Reuses `@aura/db`'s global setup rather than starting a container of its own
 * — the same disposable Postgres, the same `migrate deploy`, so an auth test
 * runs against exactly the constraints production has.
 *
 * Auth is the one part of this system that cannot be meaningfully unit-tested.
 * A mocked session store proves the mock works. Whether a password hash lands
 * in the right column, whether a session row is really deleted on logout, and
 * whether a unique index rejects a duplicate email are all questions only a
 * database can answer.
 */
export default defineConfig({
  test: {
    name: 'api:integration',
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['@aura/db/testing/global-setup'],
    /*
     * A fixed secret, so the suite does not depend on a developer having a
     * populated `.env` — CI has none, and a test that passes only on one
     * machine is worse than no test. It signs sessions inside a disposable
     * container that is destroyed at teardown; it is not a usable default and
     * nothing outside this config reads it.
     */
    env: {
      BETTER_AUTH_SECRET: 'integration-test-secret-not-for-any-real-deployment',
      BETTER_AUTH_URL: 'http://localhost:5000',
      NODE_ENV: 'test',
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

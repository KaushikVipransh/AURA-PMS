import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'worker',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      /* The queue wiring, the job bodies and the live email adapter are
         covered by the integration suite against a real Postgres and a real
         pg-boss. Excluded from *unit* coverage because they are tested, not
         untested -- a unit test of `startWorker` would be a test of a mock. */
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/boss.ts',
        'src/jobs/**',
        'src/email.ts',
        'src/storage.ts',
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

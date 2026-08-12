import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests need the Postgres container that only
    // vitest.integration.config.ts starts. Without this they are picked up by
    // the fast gate and fail for want of a database -- the same trap
    // packages/db hit in W1-12.
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/auth/**'],
      /* `src/auth/**` is excluded from coverage, not from testing: it is
         covered by the integration suite, which is the only place its claims
         mean anything. Measuring it here would report 0% for code that is
         thoroughly tested and invite someone to "fix" that with a mock.

         No thresholds yet: this app is still largely the prototype's
         JavaScript, so there is little TypeScript source to measure. They are
         added alongside the TypeScript migration in Waves 3-4 — see TASKS.md. */
    },
  },
});

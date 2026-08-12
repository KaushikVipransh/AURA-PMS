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
      exclude: [
        'src/**/*.test.ts',
        // Covered by the integration suite, which is the only place their
        // claims mean anything -- see the note below.
        'src/auth/**',
        'src/routes/**',
        'src/db/**',
        'src/security.ts',
        'src/app.ts',
        'src/server.ts',
      ],
      /* The excluded paths are excluded from *coverage*, not from testing.
         Auth, routers and the app shell are covered by the integration suite,
         which is the only place their claims mean anything: "the password is
         hashed", "the session row is really gone", "a disallowed origin gets
         no CORS header" are all questions a mock answers by agreeing with you.
         Measuring them here would report 0% for thoroughly tested code and
         invite someone to "fix" that with exactly such a mock.

         No thresholds yet: this app is still largely the prototype's
         JavaScript, so there is little TypeScript source to measure. They are
         added alongside the TypeScript migration in Waves 3-4 — see TASKS.md. */
    },
  },
});

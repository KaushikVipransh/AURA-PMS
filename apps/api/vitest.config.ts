import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      /* No thresholds yet: this app is still the prototype's JavaScript, so
         there is no TypeScript source to measure. They are added alongside the
         TypeScript migration in Waves 3-4 — see TASKS.md. */
    },
  },
});

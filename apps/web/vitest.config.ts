import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Web unit tests.
 *
 * `jsdom`, because the things worth testing here are components: a guard that
 * redirects, a form that reports a failure, an error mapper. Testing them
 * without a DOM would mean testing the functions they are made of and trusting
 * the wiring, which is where the prototype's guard went wrong.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/test/**',
        'src/main.tsx',
        /* shadcn primitives, vendored unchanged. Testing them would be
           testing Radix, which has its own suite. */
        'src/components/ui/**',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});

import { defineConfig } from 'vitest/config';

/**
 * Root config for running every suite at once — useful in watch mode and for
 * IDE integration. CI and the `pnpm verify` gate run tests per package through
 * Turborepo instead, so each package's own thresholds apply.
 *
 * Vitest 4 removed `vitest.workspace.ts`; `test.projects` replaces it.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/core',
      'packages/contracts',
      'packages/db',
      'apps/api',
      'apps/worker',
      'apps/web',
    ],
  },
});

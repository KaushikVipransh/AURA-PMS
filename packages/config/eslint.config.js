import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

/** Build artefacts and vendored code that no package should lint. */
export const ignores = {
  ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/.turbo/**', '**/node_modules/**'],
};

/**
 * Base rules for every package. Type-aware linting is on, which is what lets
 * rules like no-unnecessary-condition and no-floating-promises actually work.
 */
export const base = tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // A rejected promise that nobody awaits is how audit writes silently
      // vanish. PLAN.md F-09 is partly this shape.
      '@typescript-eslint/no-floating-promises': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Type-aware rules need a tsconfig project, which plain JavaScript has no
    // way to provide. This covers the prototype's remaining .js — server.js,
    // models/, the .jsx pages — plus every flat-config and Vite config file.
    // The blocks shrink as Waves 3-4 and W6-01 convert those files to
    // TypeScript, and eventually only the config-file case remains.
    files: ['**/*.{js,jsx,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Tool config files sit at the package root, outside every tsconfig
    // `include`, so the project service cannot resolve them either.
    files: ['*.config.ts', '**/*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);

/**
 * `packages/core` must stay pure: no database, no HTTP, no filesystem, no
 * ambient clock. That constraint is what makes Wave 2 independently testable
 * and parallelisable, so it is enforced rather than merely documented.
 *
 * Anything needing I/O belongs in a service in `apps/api`, which may import
 * core freely — never the other way round.
 */
export const purityRules = {
  files: ['**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              'node:*',
              'fs',
              'path',
              'http',
              'https',
              'crypto',
              '@prisma/*',
              '@aura/db',
              'express',
              'pg-boss',
              'resend',
            ],
            message:
              '@aura/core must stay pure — no I/O. Move anything needing the database, network, or filesystem into a service in apps/api.',
          },
        ],
      },
    ],
  },
};

/** Node-side packages: api, worker, core, contracts, db. */
export const node = tseslint.config(...base, {
  languageOptions: { globals: globals.node },
});

/** The Vite React application. */
export const react = tseslint.config(
  ...base,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
);

export default base;

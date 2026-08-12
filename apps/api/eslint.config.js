import { node } from '@aura/config/eslint.config.js';

/* The W0-03 quarantine block is gone: it covered 16 unused `catch (error)`
 * bindings in the Mongoose implementation, and W1-14 deleted that code. */
export default [
  ...node,
  {
    /**
     * The auth boundary (W3-02).
     *
     * `apps/api/src/auth/` is the only place in this repository allowed to name
     * the auth library. Everything else goes through the five functions in
     * `src/auth/index.ts`, whose signatures mention only our own types.
     *
     * This is the reversibility guarantee from TECH_STACK.md §6, made
     * structural. An auth library is the dependency most likely to need
     * replacing, and the cost of that replacement is set now, by how many files
     * know its name. Enforced rather than documented, because a documented
     * boundary is one `import` away from not existing.
     *
     * `config.js` is restricted alongside the package itself: importing it
     * yields the raw Better Auth instance, which would route around this file
     * just as effectively as importing the library directly.
     */
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/auth/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['better-auth', 'better-auth/*', '**/auth/config', '**/auth/config.js'],
              message:
                'Import from `src/auth/index.js` instead. Only src/auth/ may name the auth library — see TECH_STACK.md §6 and TASKS.md W3-02.',
            },
          ],
        },
      ],
    },
  },
];

import { node } from '@aura/config/eslint.config.js';

export default [
  ...node,
  {
    /* QUARANTINE — remove this block at W1-14.
     *
     * server.js and models/ are the prototype's original JavaScript. Linting
     * flags 16 `catch (error)` blocks that never use the variable — genuine
     * smells, and part of what PLAN.md F-14 describes, since a failed write
     * currently produces no log and no user-visible signal.
     *
     * They are not fixed here on purpose: W1-14 strips the Mongoose layer and
     * reduces these handlers to 501 stubs, and Wave 4 rewrites them in
     * TypeScript against Prisma. Polishing code with a scheduled deletion date
     * is waste. The exception is scoped to exactly these paths so no new file
     * inherits it.
     */
    files: ['server.js', 'models/**/*.js'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];

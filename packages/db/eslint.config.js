import { node } from '@aura/config/eslint.config.js';

export default [
  ...node,
  {
    /* The seed is a CLI script. Reporting what it wrote is its job, not a
     * stray debug statement left behind. */
    files: ['prisma/seed.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

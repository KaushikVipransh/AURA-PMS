import { react } from '@aura/config/eslint.config.js';

export default [
  ...react,
  {
    /* PERMANENT — shadcn/ui convention.
     *
     * These primitives are vendored from shadcn, which exports the component
     * and its cva variants object from the same module (`Button` alongside
     * `buttonVariants`). react-refresh flags the mixed export, but the pattern
     * is upstream and we keep these files in sync with it.
     */
    files: ['src/components/ui/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
];

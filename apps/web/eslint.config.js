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
  {
    /* QUARANTINE — remove this block as Wave 6 lands.
     *
     * The four prototype pages carry 8 findings: unused catch bindings and
     * dead state (PLAN.md F-14), a useless `progressFraction` assignment in
     * the duplicated scoring code (F-07), and react-hooks/immutability on the
     * `useEffect(() => { fetchX(); }, [])` fetch pattern (F-12/F-14).
     *
     * Every one of them is in a file scheduled for rewrite: W2-01 replaces the
     * scoring code, W6-02 replaces the fetch layer, and W6-06 … W6-11 rewrite
     * the pages themselves. Fixing them here would be discarded work.
     *
     * Scoped to src/pages/ only, so nothing new inherits it. Delete each entry
     * as its page is rewritten; the block should be gone by end of Wave 6.
     */
    files: ['src/pages/**/*.{js,jsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'react-hooks/immutability': 'off',
    },
  },
];

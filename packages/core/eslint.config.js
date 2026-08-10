import { node, purityRules } from '@aura/config/eslint.config.js';

/* purityRules is what keeps this package free of I/O — see TASKS.md W2. */
export default [...node, purityRules];

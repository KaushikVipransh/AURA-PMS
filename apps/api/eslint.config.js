import { node } from '@aura/config/eslint.config.js';

/* The W0-03 quarantine block is gone: it covered 16 unused `catch (error)`
 * bindings in the Mongoose implementation, and W1-14 deleted that code. */
export default node;

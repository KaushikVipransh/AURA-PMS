/**
 * @aura/core — pure domain logic.
 *
 * Everything exported here must be a pure function: no database, no HTTP, no
 * filesystem, no clock reads that aren't passed in. That constraint is enforced
 * by an ESLint `no-restricted-imports` rule (W0-03) and is what lets Wave 2 be
 * built and tested as independent, parallelisable tasks.
 *
 * Modules land in Wave 2 — see TASKS.md W2-01 … W2-09.
 */

export {};

// TEMPORARY — deliberate type error to prove CI fails. Reverted immediately.
export const ciProbe: number = 'not a number';

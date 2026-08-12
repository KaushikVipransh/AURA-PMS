/**
 * @aura/contracts — the API contract, as Zod schemas.
 *
 * One definition of every request and response, imported by the server that
 * parses it and by the client that builds it. The prototype validated in the
 * browser and trusted the result: its check-in route accepted the client's
 * whole payload and wrote it over an approved sheet (PLAN.md F-04). A shared
 * schema removes the gap where those two ideas of "valid" could differ.
 *
 * Business rules are **not** restated here. `goalSheetInputSchema` calls
 * `validateWeightages` from `@aura/core`, and `createCycleRequestSchema` calls
 * `findPhaseOverlaps`. A schema that re-implemented either would become a
 * fourth opinion on a question that already had three too many (F-10).
 */

export * from './common.js';
export * from './auth.js';
export * from './user.js';
export * from './cycle.js';
export * from './goal.js';
export * from './appraisal.js';
export * from './compliance.js';

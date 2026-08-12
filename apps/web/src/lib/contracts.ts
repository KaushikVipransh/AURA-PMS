/**
 * The application's single import point for API types and schemas.
 *
 * Everything here comes from `@aura/contracts`, which the server parses
 * requests with. That is the whole point: the form that builds a goal sheet and
 * the endpoint that accepts one are checking the same rules, so "valid in the
 * browser" and "valid on the server" cannot mean different things.
 *
 * The prototype had them diverge in the most expensive direction — a UI that
 * disabled its submit button at `totalWeightage >= 100` and a server that
 * accepted anything a request contained (PLAN.md F-04, F-10).
 *
 * Re-exported through one module rather than imported directly across the app,
 * so W6-02's generated client has a single place to land.
 */

export {
  apiErrorSchema,
  goalSheetInputSchema,
  checkInRequestSchema,
  loginRequestSchema,
  signupRequestSchema,
  type ApiError,
  type CheckInRequest,
  type Cycle,
  type Goal,
  type GoalInput,
  type GoalSheet,
  type GoalSheetInput,
  type LoginRequest,
  type SessionUser,
  type SignupRequest,
  type User,
} from '@aura/contracts';

/**
 * The weightage rules the form needs, from the same source the schema uses.
 *
 * A "you have 15% left" hint computed from a constant typed into a component is
 * how the prototype's three disagreeing totals rules happened.
 */
export {
  MAX_GOALS_PER_SHEET,
  MIN_GOALS_PER_SHEET,
  MIN_GOAL_WEIGHTAGE,
  WEIGHTAGE_TOTAL,
  remainingWeightage,
  validateWeightages,
} from '@aura/core';

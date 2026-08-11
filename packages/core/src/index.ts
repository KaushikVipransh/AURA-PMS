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

export {
  GOAL_DIRECTIONS,
  GOAL_STATUSES,
  InvalidGoalError,
  TIMELINE_SCORES,
  UOMS,
  clamp01,
  scoreGoal,
  scoreSheet,
  type GoalDirection,
  type GoalScore,
  type GoalStatus,
  type ScorableGoal,
  type SheetScore,
  type Uom,
  type WeightedGoal,
} from './scoring.js';

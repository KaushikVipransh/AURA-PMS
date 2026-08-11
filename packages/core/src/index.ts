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

export { parseNumeric, roundTo, type ParsedNumber } from './numeric.js';

export {
  ACTION_PHASES,
  CYCLE_ACTIONS,
  CYCLE_STATUSES,
  PHASE_KEYS,
  activePhase,
  findPhaseOverlaps,
  isActionAllowed,
  nextPhase,
  phasesOverlap,
  type Cycle,
  type CycleAction,
  type CycleStatus,
  type Phase,
  type PhaseKey,
  type PhaseOverlap,
} from './cycle.js';

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

export {
  MAX_GOALS_PER_SHEET,
  MIN_GOALS_PER_SHEET,
  MIN_GOAL_WEIGHTAGE,
  WEIGHTAGE_ISSUE_CODES,
  WEIGHTAGE_TOTAL,
  WEIGHTAGE_TOTAL_TOLERANCE,
  remainingWeightage,
  validateWeightages,
  type WeightableGoal,
  type WeightageIssue,
  type WeightageIssueCode,
  type WeightageValidation,
} from './weightage.js';

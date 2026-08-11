/**
 * Goal sheet weightage rules.
 *
 * A sheet's weightages decide how much each goal contributes to the appraisal,
 * so "do they add up" is not a cosmetic check — it is the difference between an
 * appraisal that means something and one that does not.
 *
 * The prototype checked this in three places with three different rules:
 * `Math.round(total) !== 100` in one route, a strict `total !== 100` in
 * another, and `totalWeightage >= 100` disabling a button in the UI. The first
 * accepted 99.6, the second rejected 99.999999 arising from ordinary float
 * addition, and the third disagreed with both (PLAN.md F-10). The rule lives
 * here now, once, with its thresholds exported so no call site can invent them.
 *
 * Returns structured issues rather than a boolean: the caller needs to tell the
 * user *which* goal is wrong and *by how much*, which a `false` cannot carry.
 */

import { parseNumeric, roundTo } from './numeric.js';

/** Weightages must total exactly this. */
export const WEIGHTAGE_TOTAL = 100;

/**
 * How far from {@link WEIGHTAGE_TOTAL} still counts as exact.
 *
 * Two decimal places is what `Decimal(5, 2)` stores, so 0.01 is one unit in the
 * last place the database can represent. This absorbs float residue without
 * absorbing a real mistake: 99.995 passes, 99.98 does not.
 */
export const WEIGHTAGE_TOTAL_TOLERANCE = 0.01;

/** No goal may be worth less than this, or it is noise on the sheet. */
export const MIN_GOAL_WEIGHTAGE = 10;

/** Fewer than this and the sheet is not a portfolio. */
export const MIN_GOALS_PER_SHEET = 3;

/** More than this and no one can hold them all in mind, including the reviewer. */
export const MAX_GOALS_PER_SHEET = 8;

export const WEIGHTAGE_ISSUE_CODES = [
  'TOO_FEW_GOALS',
  'TOO_MANY_GOALS',
  'TOTAL_MISMATCH',
  'WEIGHTAGE_MISSING',
  'WEIGHTAGE_INVALID',
  'WEIGHTAGE_BELOW_MINIMUM',
] as const;

export type WeightageIssueCode = (typeof WEIGHTAGE_ISSUE_CODES)[number];

/** The minimum a goal must expose to be weighed. */
export type WeightableGoal = {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly weightage: string | number | null;
};

export type WeightageIssue = {
  readonly code: WeightageIssueCode;
  /** Human-readable and safe to show directly; always names the subject. */
  readonly message: string;
  /** Absent on sheet-level issues such as the goal count. */
  readonly goalId: string | undefined;
  /** Absent on sheet-level issues. */
  readonly goalIndex: number | undefined;
};

export type WeightageValidation = {
  readonly valid: boolean;
  /** Sum of the parseable weightages, rounded to settle float residue. */
  readonly total: number;
  readonly issues: readonly WeightageIssue[];
};

/**
 * Name a goal well enough for a person to find it on screen.
 *
 * Order matters: an id is unambiguous, a title is what the user actually sees,
 * and the array index is the last resort for a sheet still being drafted where
 * neither exists yet.
 */
function describe(goal: WeightableGoal, index: number): string {
  if (goal.id !== undefined && goal.id !== '') {
    return goal.id;
  }
  if (goal.title !== undefined && goal.title !== '') {
    return `"${goal.title}"`;
  }
  return `goal ${String(index + 1)}`;
}

/**
 * Check a sheet's weightages against every rule at once.
 *
 * Every rule is evaluated on every call — validation stops at no first error,
 * because a user fixing one problem at a time and resubmitting is a worse
 * experience than seeing all of them together.
 *
 * A goal whose weightage cannot be read is reported *and* excluded from the
 * total, so an unreadable value shows up as its own issue rather than silently
 * dragging the total off 100 and producing a confusing second complaint.
 */
export function validateWeightages(goals: readonly WeightableGoal[]): WeightageValidation {
  const issues: WeightageIssue[] = [];

  if (goals.length < MIN_GOALS_PER_SHEET) {
    issues.push({
      code: 'TOO_FEW_GOALS',
      message: `A goal sheet needs at least ${String(MIN_GOALS_PER_SHEET)} goals; this one has ${String(goals.length)}.`,
      goalId: undefined,
      goalIndex: undefined,
    });
  }

  if (goals.length > MAX_GOALS_PER_SHEET) {
    issues.push({
      code: 'TOO_MANY_GOALS',
      message: `A goal sheet allows at most ${String(MAX_GOALS_PER_SHEET)} goals; this one has ${String(goals.length)}.`,
      goalId: undefined,
      goalIndex: undefined,
    });
  }

  let runningTotal = 0;

  goals.forEach((goal, index) => {
    const label = describe(goal, index);
    const parsed = parseNumeric(goal.weightage);

    if (parsed.kind === 'absent') {
      issues.push({
        code: 'WEIGHTAGE_MISSING',
        message: `${label} has no weightage.`,
        goalId: goal.id,
        goalIndex: index,
      });
      return;
    }

    if (parsed.kind === 'invalid') {
      issues.push({
        code: 'WEIGHTAGE_INVALID',
        message: `${label} has a weightage of ${String(goal.weightage)}, which is not a number.`,
        goalId: goal.id,
        goalIndex: index,
      });
      return;
    }

    runningTotal += parsed.value;

    if (parsed.value < MIN_GOAL_WEIGHTAGE) {
      issues.push({
        code: 'WEIGHTAGE_BELOW_MINIMUM',
        message: `${label} is weighted ${String(roundTo(parsed.value, 2))}%, below the ${String(MIN_GOAL_WEIGHTAGE)}% minimum.`,
        goalId: goal.id,
        goalIndex: index,
      });
    }
  });

  // Both the total and the drift are rounded, and both roundings are load-
  // bearing. The total: `10 + 58.01 + 31.99` sums to 99.999999999999985789, so
  // an unrounded total displays as that and a strict `!== 100` rejects a
  // perfectly valid sheet — F-10 exactly. The drift: `100.01 - 100` evaluates
  // to 0.010000000000005116, which is greater than the tolerance by pure
  // representation error and would put the stated boundary just out of reach.
  const total = roundTo(runningTotal, 4);
  const drift = roundTo(Math.abs(total - WEIGHTAGE_TOTAL), 4);

  if (drift > WEIGHTAGE_TOTAL_TOLERANCE) {
    const direction = total > WEIGHTAGE_TOTAL ? 'over' : 'under';
    issues.push({
      code: 'TOTAL_MISMATCH',
      message: `Weightages total ${String(roundTo(total, 2))}%, ${String(roundTo(drift, 2))} ${direction} the required ${String(WEIGHTAGE_TOTAL)}%.`,
      goalId: undefined,
      goalIndex: undefined,
    });
  }

  return { valid: issues.length === 0, total, issues };
}

/**
 * How much weightage is still unassigned on a sheet.
 *
 * Exists so the "you have 15% left to allocate" hint in the UI is computed from
 * the same total as the validation that will reject the sheet. Negative when
 * over-allocated, which the caller should show rather than clamp.
 */
export function remainingWeightage(goals: readonly WeightableGoal[]): number {
  const assigned = goals.reduce((sum, goal) => {
    const parsed = parseNumeric(goal.weightage);
    return parsed.kind === 'ok' ? sum + parsed.value : sum;
  }, 0);

  return roundTo(WEIGHTAGE_TOTAL - assigned, 4);
}

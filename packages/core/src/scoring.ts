/**
 * Goal scoring — the single implementation.
 *
 * The prototype had two byte-identical copies of this logic, one in
 * `EmployeeDashboard.jsx` and one in `ManagerWorkspace.jsx`, and a third
 * variant on the server. This module replaces all of them.
 *
 * Three things it does differently, each closing a finding in PLAN.md:
 *
 *   F-06  Direction came from substring-matching the goal's *title*:
 *         `title.includes('tat' | 'cost' | 'reduction')`. "Reduce customer
 *         wait time" scored inversely by accident, "Cost Awareness Training"
 *         was read as a cost-reduction metric, and "Rotation" flipped on the
 *         letters t-a-t. Nothing here reads `title`. The type does not even
 *         carry it.
 *
 *   F-07  Scoring lived in the UI, so the number an employee saw and the
 *         number a manager saw could drift with a deploy. It lives here now
 *         and both call it.
 *
 *   The `|| 1` bug  The prototype wrote `Number(goal.target) || 1`, so a
 *         target of `0`, `''`, or `'N/A'` silently became a target of 1 —
 *         turning a malformed goal into a plausible-looking score. Malformed
 *         input throws here. A wrong appraisal is worse than a failed one.
 *
 * Everything in this file is pure: same input, same output, no clock, no I/O.
 */

/** Unit of measurement. Mirrors the `Uom` enum in `packages/db`. */
export const UOMS = ['NUMERIC', 'PERCENT', 'TIMELINE', 'ZERO_BASED'] as const;
export type Uom = (typeof UOMS)[number];

/** Which way is good. Mirrors the `GoalDirection` enum in `packages/db`. */
export const GOAL_DIRECTIONS = ['HIGHER_IS_BETTER', 'LOWER_IS_BETTER'] as const;
export type GoalDirection = (typeof GOAL_DIRECTIONS)[number];

/** Progress state. Mirrors the `GoalStatus` enum in `packages/db`. */
export const GOAL_STATUSES = ['NOT_STARTED', 'ON_TRACK', 'COMPLETED'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/**
 * The enums above are re-declared rather than imported because `@aura/core`
 * may not import `@aura/db` — that is the purity rule from W0-03, and it is
 * what lets this package be tested with no database. The drift risk is real
 * and is guarded by a test in `packages/db` that asserts the Prisma enums and
 * these arrays hold the same members.
 */

/**
 * What a Timeline goal is worth at each milestone status.
 *
 * Exported so that no call site can invent its own idea of what "on track"
 * is worth. `ON_TRACK = 0.5` is a policy choice inherited from the prototype,
 * kept deliberately: half credit for started-and-healthy. Changing it is a
 * business decision, and it should be changed here, once.
 */
export const TIMELINE_SCORES: Readonly<Record<GoalStatus, number>> = {
  NOT_STARTED: 0,
  ON_TRACK: 0.5,
  COMPLETED: 1,
};

/**
 * The fields scoring actually needs. Note the absence of `title` — F-06 has
 * nowhere to come back from if the function cannot see the string.
 *
 * `target` and `actualAchievement` are `string | number` because Prisma stores
 * them as text (a target may legitimately be "99.95" or a date-like label).
 */
export type ScorableGoal = {
  readonly uom: Uom;
  readonly direction: GoalDirection;
  readonly target: string | number | null;
  readonly actualAchievement: string | number | null;
  readonly status: GoalStatus;
};

/** A goal plus the weight it carries on its sheet. */
export type WeightedGoal = ScorableGoal & {
  readonly id?: string | undefined;
  readonly weightage: string | number;
};

/** One row of a sheet's score breakdown. */
export type GoalScore = {
  readonly id: string | undefined;
  readonly index: number;
  /** The goal's own achievement, 0–1. */
  readonly score: number;
  readonly weightage: number;
  /** `score × weightage / totalWeightage` — what this goal added to the sheet. */
  readonly contribution: number;
};

export type SheetScore = {
  /** Weighted achievement across the sheet, 0–1. */
  readonly score: number;
  /** The same number as a percentage, rounded to two decimals for display. */
  readonly percent: number;
  readonly totalWeightage: number;
  readonly breakdown: readonly GoalScore[];
};

/**
 * A goal that cannot be scored as written.
 *
 * This is a data defect, not a low score. The distinction matters: an empty
 * `actualAchievement` means "nothing reported yet" and scores 0, whereas
 * `'N/A'` means someone put text in a numeric field and no score is
 * meaningful. The prototype collapsed both into a number and published it.
 */
export class InvalidGoalError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'InvalidGoalError';
    this.field = field;
  }
}

type ParsedNumber =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly value: number };

const ABSENT: ParsedNumber = { kind: 'absent' };
const INVALID: ParsedNumber = { kind: 'invalid' };

/**
 * Tri-state parse. `null`, `undefined` and blank strings are *absent*;
 * anything non-finite is *invalid*. `Number('')` is 0 in JavaScript, which is
 * exactly the coercion that let blank actuals look like real zeroes, so blank
 * is checked before the conversion.
 */
function parseNumeric(raw: string | number | null | undefined): ParsedNumber {
  if (raw == null) {
    return ABSENT;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { kind: 'ok', value: raw } : INVALID;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return ABSENT;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? { kind: 'ok', value } : INVALID;
}

/** Constrain a raw achievement ratio to [0, 1]. Over-delivery caps at 1. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Score one goal, 0–1.
 *
 * How each unit of measurement is read:
 *
 * - **NUMERIC / PERCENT** — linear against the target, in whichever direction
 *   the goal declares. `HIGHER_IS_BETTER` with a positive target is plainly
 *   `actual / target`. `LOWER_IS_BETTER` is its mirror: full credit at or
 *   below target, falling linearly to zero at twice the target. That last part
 *   is a deliberate change — the prototype used `target / actual`, which never
 *   reaches zero, so missing a 5-defect target by 5× still scored 0.2. It also
 *   inverted on negative actuals. The linear form is monotone across the whole
 *   number line and has an explainable rule: double the target, lose the goal.
 *
 * - **ZERO_BASED** — binary, and simply the degenerate `target = 0` case of the
 *   rule above: zero (or below) scores 1, anything above scores 0.
 *
 * - **TIMELINE** — by milestone status, via {@link TIMELINE_SCORES}. Target
 *   and actual are not read; a timeline goal is measured by where it got to.
 *
 * A missing `actualAchievement` scores 0 in every case: nothing reported is
 * not the same as nothing gone wrong.
 *
 * @param label How to name this goal in error messages.
 * @throws {InvalidGoalError} when the goal itself is malformed.
 */
export function scoreGoal(goal: ScorableGoal, label = 'goal'): number {
  if (goal.uom === 'TIMELINE') {
    return TIMELINE_SCORES[goal.status];
  }

  const actual = parseNumeric(goal.actualAchievement);
  if (actual.kind === 'invalid') {
    throw new InvalidGoalError(
      `${label}: actualAchievement is not a number (${String(goal.actualAchievement)}).`,
      'actualAchievement',
    );
  }

  const target = parseNumeric(goal.target);

  if (goal.uom === 'ZERO_BASED') {
    // A zero-based goal whose target is not zero is a contradiction, and
    // quietly ignoring the stated target is how F-06 happened.
    if (target.kind === 'invalid' || (target.kind === 'ok' && target.value !== 0)) {
      throw new InvalidGoalError(
        `${label}: a ZERO_BASED goal must have a target of 0, got ${String(goal.target)}.`,
        'target',
      );
    }
    if (goal.direction !== 'LOWER_IS_BETTER') {
      throw new InvalidGoalError(
        `${label}: a ZERO_BASED goal must be LOWER_IS_BETTER; "more incidents is better" is not a goal.`,
        'direction',
      );
    }
    return actual.kind === 'ok' && actual.value <= 0 ? 1 : 0;
  }

  if (target.kind !== 'ok') {
    throw new InvalidGoalError(
      `${label}: target is required and must be a number, got ${String(goal.target)}.`,
      'target',
    );
  }
  if (actual.kind === 'absent') {
    return 0;
  }

  const scale = Math.abs(target.value);
  if (scale === 0) {
    // No proportion to take, so the comparison is all that is left.
    return goal.direction === 'HIGHER_IS_BETTER'
      ? Number(actual.value >= 0)
      : Number(actual.value <= 0);
  }

  const delta = (actual.value - target.value) / scale;
  return clamp01(goal.direction === 'HIGHER_IS_BETTER' ? 1 + delta : 1 - delta);
}

/**
 * Score a whole sheet: each goal's achievement, weighted by its weightage.
 *
 * Weightages are normalised by their own total rather than assumed to be 100,
 * so this stays correct on a draft sheet mid-edit. Enforcing "must total 100"
 * is `validateWeightages` in `./weightage.ts` (W2-02) — one rule, one home.
 *
 * @throws {InvalidGoalError} when a weightage or a goal is malformed.
 */
export function scoreSheet(goals: readonly WeightedGoal[]): SheetScore {
  const scored = goals.map((goal, index) => {
    const label = goal.id ?? `goals[${index}]`;
    const weightage = parseNumeric(goal.weightage);
    if (weightage.kind !== 'ok') {
      throw new InvalidGoalError(
        `${label}: weightage is required and must be a number, got ${String(goal.weightage)}.`,
        'weightage',
      );
    }
    if (weightage.value < 0) {
      throw new InvalidGoalError(
        `${label}: weightage cannot be negative, got ${weightage.value}.`,
        'weightage',
      );
    }
    return { goal, index, label, weightage: weightage.value, score: scoreGoal(goal, label) };
  });

  const totalWeightage = scored.reduce((sum, entry) => sum + entry.weightage, 0);

  const breakdown: GoalScore[] = scored.map((entry) => ({
    id: entry.goal.id,
    index: entry.index,
    score: entry.score,
    weightage: entry.weightage,
    // An unweighted sheet contributes nothing rather than NaN. A silent NaN
    // renders as "—" and reads like a UI glitch instead of a broken sheet.
    contribution: totalWeightage === 0 ? 0 : (entry.score * entry.weightage) / totalWeightage,
  }));

  const score = clamp01(breakdown.reduce((sum, entry) => sum + entry.contribution, 0));

  return {
    score,
    percent: Math.round(score * 100 * 100) / 100,
    totalWeightage,
    breakdown,
  };
}

/**
 * Working out who can actually receive a cascaded goal — and telling you,
 * rather than finding out halfway through.
 *
 * `planCascade` **performs nothing**. It returns who would receive the goal and
 * who would not, with a reason for each refusal. The caller decides whether to
 * apply it, and can show the manager the consequences first (PRD US-402).
 *
 * That shape is the fix for two prototype behaviours:
 *
 *   - F-05 — the primary owner was matched by comparing display-name strings,
 *     so two people called the same thing shared an identity and a rename broke
 *     the link. Ownership is a user id here, and the types below carry no name
 *     at all, so the comparison cannot regress.
 *   - The cascade wrote goals row by row with no prior check, so a push to
 *     twelve people could leave four of them holding an invalid sheet — over
 *     100% weightage, or a ninth goal — with no record of which four.
 */

import { parseNumeric, roundTo } from './numeric.js';
import {
  MAX_GOALS_PER_SHEET,
  WEIGHTAGE_TOTAL,
  WEIGHTAGE_TOTAL_TOLERANCE,
} from './weightage.js';

/** The goal being pushed down. Note the absence of any name or title. */
export type CascadableGoal = {
  readonly id: string;
  /** The primary owner, by id. Their instance already exists. */
  readonly ownerUserId: string;
  readonly weightage: string | number | null;
};

/** One goal already on a recipient's sheet. */
export type RecipientGoal = {
  /** Set when this goal arrived from a cascade; `null` for a personal goal. */
  readonly sharedGoalId: string | null;
  readonly weightage: string | number | null;
};

export type CascadeRecipient = {
  readonly userId: string;
  readonly goals: readonly RecipientGoal[];
  /**
   * Whether their sheet can still take a new goal.
   *
   * Added in W4-13, when the endpoint that consumes this planner needed an
   * answer the planner could not give. A sheet that is already approved is
   * locked, and a cascade that appended a goal to it would move the target
   * after the agreement — the same class of mistake as F-04's check-in route
   * writing over a locked sheet.
   *
   * Optional, defaulting to editable, so a caller that has no sheets to reason
   * about (a pure "who would receive this" question) is unaffected.
   */
  readonly sheetIsEditable?: boolean;
};

/**
 * Every reason a cascade can pass someone over.
 *
 * `NOT_IN_YOUR_LINE` is the one member `planCascade` never emits, and a test
 * asserts as much. Reach is an authorisation question, and answering it needs
 * an actor and their roles — neither of which this planner takes, and neither
 * of which it should, because a function that decided both *who has room* and
 * *who you are allowed to ask* would be two rules in one place. The caller
 * applies W2-06 and merges its refusals into the same list, so a manager reads
 * one explanation per person rather than two lists to reconcile.
 */
export const CASCADE_SKIP_REASONS = [
  'DUPLICATE_RECIPIENT',
  'IS_OWNER',
  'NOT_IN_YOUR_LINE',
  'ALREADY_HAS_GOAL',
  'SHEET_NOT_EDITABLE',
  'INVALID_WEIGHTAGE',
  'WOULD_EXCEED_GOAL_LIMIT',
  'WOULD_EXCEED_WEIGHTAGE',
] as const;
export type CascadeSkipReason = (typeof CASCADE_SKIP_REASONS)[number];

export type CascadeSkip = {
  readonly userId: string;
  readonly reason: CascadeSkipReason;
  /** Safe to show to the manager deciding whether to proceed. */
  readonly detail: string;
};

export type CascadePlan = {
  readonly sharedGoalId: string;
  /** The weightage each recipient would take on. */
  readonly weightage: number;
  readonly willReceive: readonly string[];
  readonly skipped: readonly CascadeSkip[];
};

type SheetWeightages =
  | { readonly ok: true; readonly values: readonly number[] }
  | { readonly ok: false; readonly badIndex: number };

/**
 * Read every weightage on a sheet, or report the first one that will not read.
 *
 * Returning both outcomes from a single pass is deliberate: checking validity
 * and then summing separately parses each value twice, and leaves the sum with
 * a "what if it is unreadable" branch that the earlier check has already made
 * unreachable — dead code that looks like caution.
 */
function readWeightages(goals: readonly RecipientGoal[]): SheetWeightages {
  const values: number[] = [];

  for (const [index, goal] of goals.entries()) {
    const parsed = parseNumeric(goal.weightage);

    if (parsed.kind !== 'ok') {
      return { ok: false, badIndex: index };
    }
    values.push(parsed.value);
  }

  return { ok: true, values };
}

/** A weightage that cannot be read is a defect, not a zero. */
export class InvalidCascadeError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'InvalidCascadeError';
    this.field = field;
  }
}

/**
 * Plan a cascade without performing it.
 *
 * Each recipient is checked in order of how decisive the reason is, so the
 * answer given is the most fundamental one that applies — someone who is both
 * the owner and at the goal limit is skipped for being the owner, which is the
 * thing the manager needs to understand.
 *
 *   1. Already considered — the same recipient listed twice.
 *   2. The owner, who holds the primary instance already.
 *   3. Already has this goal, so a second copy would be a duplicate.
 *   4. Their sheet is locked, so nothing can be added to it at all.
 *   5. Has a weightage on their sheet that cannot be read.
 *   6. Already at the goal limit.
 *   7. Would go over 100% weightage.
 *
 * The weightage headroom uses the same total and tolerance as
 * `validateWeightages` (W2-02), so a sheet this planner accepts is a sheet that
 * validation accepts — the two cannot disagree.
 *
 * @throws {InvalidCascadeError} when the shared goal's own weightage is unusable.
 */
export function planCascade(
  goal: CascadableGoal,
  recipients: readonly CascadeRecipient[],
): CascadePlan {
  const parsedWeightage = parseNumeric(goal.weightage);

  if (parsedWeightage.kind !== 'ok') {
    throw new InvalidCascadeError(
      `Shared goal ${goal.id} has a weightage of ${String(goal.weightage)}, which is not a number.`,
      'weightage',
    );
  }
  if (parsedWeightage.value <= 0) {
    throw new InvalidCascadeError(
      `Shared goal ${goal.id} has a weightage of ${String(parsedWeightage.value)}; a cascaded goal must carry weight.`,
      'weightage',
    );
  }

  const weightage = parsedWeightage.value;
  const willReceive: string[] = [];
  const skipped: CascadeSkip[] = [];
  const seen = new Set<string>();

  const skip = (userId: string, reason: CascadeSkipReason, detail: string): void => {
    skipped.push({ userId, reason, detail });
  };

  for (const recipient of recipients) {
    if (seen.has(recipient.userId)) {
      skip(recipient.userId, 'DUPLICATE_RECIPIENT', 'Listed more than once in this cascade.');
      continue;
    }
    seen.add(recipient.userId);

    // Compared by id. The prototype compared display names, so a rename broke
    // ownership and a namesake inherited it (F-05).
    if (recipient.userId === goal.ownerUserId) {
      skip(recipient.userId, 'IS_OWNER', 'Owns this goal already, and holds the primary instance.');
      continue;
    }

    if (recipient.goals.some((existing) => existing.sharedGoalId === goal.id)) {
      skip(recipient.userId, 'ALREADY_HAS_GOAL', 'Already has this goal on their sheet.');
      continue;
    }

    /* Checked after "already has it" on purpose: someone whose locked sheet
       already carries this goal is not blocked by the lock, and telling them
       so would send the manager looking for a problem that is not there. */
    if (recipient.sheetIsEditable === false) {
      skip(
        recipient.userId,
        'SHEET_NOT_EDITABLE',
        'Their goal sheet is approved and locked, so nothing can be added to it.',
      );
      continue;
    }

    const sheet = readWeightages(recipient.goals);
    if (!sheet.ok) {
      skip(
        recipient.userId,
        'INVALID_WEIGHTAGE',
        `Goal ${String(sheet.badIndex + 1)} on their sheet has an unreadable weightage, so the headroom cannot be calculated.`,
      );
      continue;
    }

    if (recipient.goals.length >= MAX_GOALS_PER_SHEET) {
      skip(
        recipient.userId,
        'WOULD_EXCEED_GOAL_LIMIT',
        `Already has ${String(recipient.goals.length)} goals; the limit is ${String(MAX_GOALS_PER_SHEET)}.`,
      );
      continue;
    }

    const assigned = sheet.values.reduce((sum, value) => sum + value, 0);
    const projected = roundTo(assigned + weightage, 4);

    if (projected > WEIGHTAGE_TOTAL + WEIGHTAGE_TOTAL_TOLERANCE) {
      skip(
        recipient.userId,
        'WOULD_EXCEED_WEIGHTAGE',
        `Would reach ${String(roundTo(projected, 2))}%, over the ${String(WEIGHTAGE_TOTAL)}% limit.`,
      );
      continue;
    }

    willReceive.push(recipient.userId);
  }

  return { sharedGoalId: goal.id, weightage, willReceive, skipped };
}

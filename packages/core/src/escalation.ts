/**
 * Deciding what a missed deadline warrants — and nothing else.
 *
 * `evaluate` returns *intent*: which tier a breach has reached and whether
 * someone should be told. It sends no email, writes no row and reads no clock.
 * The nightly job in Wave 5 does the sending, having been told what to send.
 *
 * The prototype's escalation engine (PLAN.md F-08) had three problems, and the
 * shape of this module is a response to each:
 *
 *   - It had no deadlines to compare against, so it floored every result at
 *     four days with `Math.max(elapsed, 4)`. Here the deadline is a parameter
 *     and the count comes from `./deadlines.ts`, which has no floor.
 *   - It ran only when an admin clicked a button. A pure function of
 *     `(state, thresholds, now)` can be run on a schedule, re-run safely, and
 *     tested at any instant.
 *   - Its "notification chain" was a string in a document — a record of what
 *     *would* have been sent. Nothing was. `notifiedAt` is a real list of real
 *     sends, and this module reads it to decide whether to add another.
 */

import {
  DEFAULT_TIME_ZONE,
  daysOverdue as computeDaysOverdue,
  isOverdue,
  sameCivilDay,
} from './deadlines.js';

export const ESCALATION_RULES = [
  'GOALS_NOT_SUBMITTED',
  'APPROVAL_OVERDUE',
  'CHECK_IN_MISSING',
  'SELF_APPRAISAL_OVERDUE',
  'MANAGER_RATING_OVERDUE',
] as const;
export type EscalationRule = (typeof ESCALATION_RULES)[number];

/** How far up the reporting chain a breach has travelled (PRD US-902). */
export const ESCALATION_TIERS = ['EMPLOYEE', 'MANAGER', 'SKIP_LEVEL_HR'] as const;
export type EscalationTier = (typeof ESCALATION_TIERS)[number];

export const ESCALATION_STATUSES = ['ACTIVE', 'RESOLVED'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/**
 * Day counts at which a breach climbs to the next tier, configured per cycle
 * (PRD US-204) and stored on `ReviewCycle.escalationRules`.
 *
 * Read as "at or after this many days overdue", so `manager: 3` means the
 * third day is when a manager hears about it, not the fourth.
 */
export type EscalationThresholds = {
  readonly manager: number;
  readonly skipLevelHr: number;
};

export const DEFAULT_ESCALATION_THRESHOLDS: EscalationThresholds = {
  manager: 3,
  skipLevelHr: 7,
};

/** What the caller knows about a breach before this function runs. */
export type EscalationState = {
  readonly rule: EscalationRule;
  readonly subjectUserId: string;
  /** The real deadline, from the cycle's phase dates. */
  readonly dueAt: Date;
  readonly status: EscalationStatus;
  /** The tier already recorded, so a climb can be distinguished from a hold. */
  readonly tier: EscalationTier;
  /** One entry per notification actually sent. Order does not matter. */
  readonly notifiedAt: readonly Date[];
};

/**
 * Why the evaluator reached its conclusion.
 *
 * Carried on every decision, including the negative ones. An escalation job
 * that silently does nothing is indistinguishable from an escalation job that
 * is broken, which is exactly what the prototype's was.
 */
export const ESCALATION_REASONS = [
  'RESOLVED',
  'NOT_OVERDUE',
  'FIRST_BREACH',
  'TIER_RAISED',
  'DAILY_REMINDER',
  'ALREADY_NOTIFIED_TODAY',
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export type EscalationDecision = {
  readonly rule: EscalationRule;
  readonly subjectUserId: string;
  readonly overdue: boolean;
  /** Real whole calendar days late. Zero is a legitimate answer. */
  readonly daysOverdue: number;
  /** The tier this breach should now be at. */
  readonly tier: EscalationTier;
  /** True when {@link EscalationDecision.tier} differs from the recorded one. */
  readonly tierChanged: boolean;
  readonly notify: boolean;
  readonly reason: EscalationReason;
};

function assertThresholds(thresholds: EscalationThresholds): void {
  const { manager, skipLevelHr } = thresholds;

  if (!Number.isInteger(manager) || !Number.isInteger(skipLevelHr)) {
    throw new RangeError('Escalation thresholds must be whole numbers of days.');
  }
  if (manager < 0 || skipLevelHr < 0) {
    throw new RangeError('Escalation thresholds cannot be negative.');
  }
  if (skipLevelHr < manager) {
    throw new RangeError(
      `Escalation thresholds are inverted: skipLevelHr (${String(skipLevelHr)}) is below manager (${String(manager)}).`,
    );
  }
}

/**
 * The tier a breach of `days` warrants.
 *
 * Monotonic by construction: more days never means a lower tier. The tests
 * assert that across the whole range rather than at the boundaries only.
 */
export function tierFor(days: number, thresholds: EscalationThresholds): EscalationTier {
  assertThresholds(thresholds);

  if (days >= thresholds.skipLevelHr) {
    return 'SKIP_LEVEL_HR';
  }
  if (days >= thresholds.manager) {
    return 'MANAGER';
  }
  return 'EMPLOYEE';
}

/** The most recent send, or `null` if nobody has been told yet. */
function lastNotifiedAt(notifiedAt: readonly Date[]): Date | null {
  return notifiedAt.reduce<Date | null>(
    (latest, sent) => (latest === null || sent.getTime() > latest.getTime() ? sent : latest),
    null,
  );
}

/**
 * What a single breach warrants at `now`.
 *
 * Notification policy, in order:
 *
 *   1. A resolved breach is never notified and never climbs. Resolution is the
 *      end of the matter, not a pause in it.
 *   2. A deadline that has not passed is not a breach.
 *   3. Nobody has been told yet — tell them.
 *   4. The tier has climbed — tell the new tier, whatever was sent earlier
 *      today. Reaching HR is not something to hold until tomorrow.
 *   5. The last send was on an earlier date — send the daily reminder.
 *   6. Otherwise stay quiet.
 *
 * Rules 5 and 6 are what make the nightly job safe to re-run: a second pass on
 * the same date, over state that records the first pass, decides to say
 * nothing. Note that this function is pure, so *re-running it against unchanged
 * state returns the unchanged answer* — idempotency comes from the caller
 * recording the send, and both halves of that are tested.
 */
export function evaluate(
  state: EscalationState,
  thresholds: EscalationThresholds,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): EscalationDecision {
  assertThresholds(thresholds);

  const overdue = isOverdue(state.dueAt, now);
  const days = computeDaysOverdue(state.dueAt, now, timeZone);

  const base = {
    rule: state.rule,
    subjectUserId: state.subjectUserId,
    overdue,
    daysOverdue: days,
  } as const;

  if (state.status === 'RESOLVED') {
    return { ...base, tier: state.tier, tierChanged: false, notify: false, reason: 'RESOLVED' };
  }

  if (!overdue) {
    return { ...base, tier: 'EMPLOYEE', tierChanged: false, notify: false, reason: 'NOT_OVERDUE' };
  }

  const tier = tierFor(days, thresholds);
  const tierChanged = tier !== state.tier;
  const last = lastNotifiedAt(state.notifiedAt);

  if (last === null) {
    return { ...base, tier, tierChanged, notify: true, reason: 'FIRST_BREACH' };
  }
  if (tierChanged) {
    return { ...base, tier, tierChanged, notify: true, reason: 'TIER_RAISED' };
  }
  if (!sameCivilDay(last, now, timeZone)) {
    return { ...base, tier, tierChanged, notify: true, reason: 'DAILY_REMINDER' };
  }

  return { ...base, tier, tierChanged, notify: false, reason: 'ALREADY_NOTIFIED_TODAY' };
}

/**
 * Evaluate a batch, preserving input order.
 *
 * The nightly job's shape: hand it everything outstanding, get back a decision
 * per item. Filtering to `notify` is the caller's job, so the decisions that
 * came to nothing are still available to log.
 */
export function evaluateAll(
  states: readonly EscalationState[],
  thresholds: EscalationThresholds,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): readonly EscalationDecision[] {
  return states.map((state) => evaluate(state, thresholds, now, timeZone));
}

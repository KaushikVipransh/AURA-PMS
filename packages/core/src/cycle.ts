/**
 * Where a review cycle is in time, and what that permits.
 *
 * This replaces `GLOBAL_ACTIVE_PERIOD`, the module-level string the prototype
 * used to track the current phase (PLAN.md F-03). That variable had two
 * failure modes. It reset on every Vercel cold start, so two concurrent
 * instances could disagree about what period it was. And changing it ran
 * `updateMany({}, { $set: { quarter } })`, stamping the new period onto every
 * sheet ever created — the entire history rewritten by a dropdown.
 *
 * The replacement is dated windows on rows, read against an instant the caller
 * supplies. Nothing here reads a clock: `at` is always a parameter, which is
 * what makes "what happens at 23:59 on the deadline" a test rather than a
 * hope.
 *
 * **Phases are half-open — `[startsAt, endsAt)`.** An instant exactly equal to
 * `startsAt` is inside the phase; an instant exactly equal to `endsAt` is not,
 * it belongs to whatever comes next. This is the only convention under which
 * back-to-back phases tile a cycle with neither a gap nor an overlap, and it
 * means a phase that ends "on 31 March" is stored as ending at 1 April
 * 00:00 in the org's timezone. Every boundary test below pins this down.
 */

export const CYCLE_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/** In the order a cycle runs through them. */
export const PHASE_KEYS = [
  'GOAL_SETTING',
  'CHECK_IN',
  'APPRAISAL',
  'CALIBRATION',
  'RESULTS',
] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];

export type Phase = {
  readonly key: PhaseKey;
  readonly startsAt: Date;
  readonly endsAt: Date;
};

export type Cycle = {
  readonly status: CycleStatus;
  readonly phases: readonly Phase[];
};

/**
 * Things whose *timing* the cycle governs.
 *
 * Only state changes appear here. Reading is never time-gated — an employee
 * looking at last year's published results is a permission question, and
 * putting it in this table would mean a closed cycle became invisible.
 *
 * This answers "is it the right time", nothing more. "Is this the right
 * person" is `can()` in `./policy.ts` (W2-06), and an endpoint must satisfy
 * both. Keeping them apart is what stops a manager's authority from being
 * mistaken for an open window, which is how the prototype allowed check-in
 * writes against a locked sheet (F-04).
 */
export const CYCLE_ACTIONS = [
  'CREATE_GOAL_SHEET',
  'EDIT_GOALS',
  'SUBMIT_GOAL_SHEET',
  'APPROVE_GOAL_SHEET',
  'RECORD_CHECK_IN',
  'SUBMIT_SELF_APPRAISAL',
  'SUBMIT_MANAGER_APPRAISAL',
  'CALIBRATE',
  'PUBLISH_RESULTS',
] as const;
export type CycleAction = (typeof CYCLE_ACTIONS)[number];

/**
 * Which phases each action belongs to.
 *
 * Exported because W3-09's endpoint matrix and the UI's disabled states must
 * both read the same table rather than each re-deriving it.
 */
export const ACTION_PHASES: Readonly<Record<CycleAction, readonly PhaseKey[]>> = {
  CREATE_GOAL_SHEET: ['GOAL_SETTING'],
  EDIT_GOALS: ['GOAL_SETTING'],
  SUBMIT_GOAL_SHEET: ['GOAL_SETTING'],
  APPROVE_GOAL_SHEET: ['GOAL_SETTING'],
  RECORD_CHECK_IN: ['CHECK_IN'],
  SUBMIT_SELF_APPRAISAL: ['APPRAISAL'],
  SUBMIT_MANAGER_APPRAISAL: ['APPRAISAL'],
  CALIBRATE: ['CALIBRATION'],
  PUBLISH_RESULTS: ['RESULTS'],
};

/** Two phases whose windows intersect. A cycle should never have any. */
export type PhaseOverlap = {
  readonly earlier: PhaseKey;
  readonly later: PhaseKey;
  /** The instant the intersection begins, inclusive. */
  readonly from: Date;
  /** The instant it ends, exclusive. */
  readonly until: Date;
};

/**
 * An invalid `Date` compares false against everything, so it would quietly
 * produce "no active phase" rather than an error. Named rather than silent.
 */
function assertValidDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError(`${label} is not a valid date.`);
  }
}

/** Half-open containment: `startsAt <= at < endsAt`. */
function contains(phase: Phase, at: Date): boolean {
  assertValidDate(phase.startsAt, `${phase.key}.startsAt`);
  assertValidDate(phase.endsAt, `${phase.key}.endsAt`);

  return at.getTime() >= phase.startsAt.getTime() && at.getTime() < phase.endsAt.getTime();
}

function byStart(a: Phase, b: Phase): number {
  return a.startsAt.getTime() - b.startsAt.getTime();
}

/**
 * The phase a cycle is in at `at`, or `null` if it is between phases, outside
 * them entirely, or not running.
 *
 * A `DRAFT` or `CLOSED` cycle has no active phase whatever its dates say — the
 * dates describe a plan, and the status says whether the plan is in force.
 *
 * If phases overlap (which {@link phasesOverlap} exists to prevent before they
 * are ever persisted), the earliest-starting match wins. That is a defined,
 * deterministic answer to a malformed question, not an endorsement of it.
 */
export function activePhase(cycle: Cycle, at: Date): Phase | null {
  assertValidDate(at, 'at');

  if (cycle.status !== 'ACTIVE') {
    return null;
  }

  return cycle.phases.filter((phase) => contains(phase, at)).sort(byStart)[0] ?? null;
}

/**
 * The next phase due to open strictly after `at`, or `null` if none remain.
 *
 * Deliberately not gated on cycle status: "goal setting opens on 1 April" is
 * exactly what a `DRAFT` cycle needs to be able to say.
 */
export function nextPhase(cycle: Cycle, at: Date): Phase | null {
  assertValidDate(at, 'at');

  return (
    cycle.phases
      .filter((phase) => {
        assertValidDate(phase.startsAt, `${phase.key}.startsAt`);
        return phase.startsAt.getTime() > at.getTime();
      })
      .sort(byStart)[0] ?? null
  );
}

/**
 * Whether the cycle's clock permits `action` at `at`.
 *
 * False on a draft or closed cycle, false between phases, and false during a
 * phase the action does not belong to. Says nothing about who is asking.
 */
export function isActionAllowed(action: CycleAction, cycle: Cycle, at: Date): boolean {
  const phase = activePhase(cycle, at);

  return phase !== null && ACTION_PHASES[action].includes(phase.key);
}

/**
 * Every pair of phases whose windows intersect, with the intersection.
 *
 * Returned as data rather than a boolean so the caller can tell the admin
 * *which* two windows collide and *where*, which is the only form of this
 * answer anyone can act on.
 */
export function findPhaseOverlaps(phases: readonly Phase[]): readonly PhaseOverlap[] {
  const ordered = [...phases].sort(byStart);
  const overlaps: PhaseOverlap[] = [];

  // Iterated by entry rather than by index: an indexed read would be
  // `Phase | undefined` under noUncheckedIndexedAccess, and the guard for a
  // case that cannot happen would be an untestable branch.
  for (const [index, earlier] of ordered.entries()) {
    assertValidDate(earlier.startsAt, `${earlier.key}.startsAt`);
    assertValidDate(earlier.endsAt, `${earlier.key}.endsAt`);

    for (const later of ordered.slice(index + 1)) {
      assertValidDate(later.startsAt, `${later.key}.startsAt`);
      assertValidDate(later.endsAt, `${later.key}.endsAt`);

      const from = Math.max(earlier.startsAt.getTime(), later.startsAt.getTime());
      const until = Math.min(earlier.endsAt.getTime(), later.endsAt.getTime());

      // Half-open, so touching at a single instant is adjacency, not overlap.
      if (from < until) {
        overlaps.push({
          earlier: earlier.key,
          later: later.key,
          from: new Date(from),
          until: new Date(until),
        });
      }
    }
  }

  return overlaps;
}

/** Whether any two phase windows intersect. See {@link findPhaseOverlaps}. */
export function phasesOverlap(phases: readonly Phase[]): boolean {
  return findPhaseOverlaps(phases).length > 0;
}

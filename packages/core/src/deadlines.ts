/**
 * When things are due, and how late they are.
 *
 * The prototype's escalation engine computed overdue days as
 * `Math.max(elapsedDays, 4)` — a floor of four days applied to everything,
 * so a task that became due an hour ago was reported as four days overdue and
 * escalated accordingly (PLAN.md F-08). Every number in this module is real.
 * If nothing is late, the answer is 0, and 0 is a legitimate answer.
 *
 * Nothing here reads a clock. `now` is always a parameter, which is what makes
 * "what does this say at 00:00 on the deadline" a test rather than a hope.
 */

import { ACTION_PHASES, assertValidDate, type Cycle, type CycleAction } from './cycle.js';

/**
 * The default timezone for calendar arithmetic.
 *
 * Organisations get their own — the constant exists so that a caller who has
 * not got one yet is obviously falling back rather than silently using the
 * server's local zone, which is the classic way this goes wrong in production.
 */
export const DEFAULT_TIME_ZONE = 'UTC';

/**
 * When `action` is due on this cycle, or `null` if the cycle has no phase for
 * it.
 *
 * The deadline is the phase's `endsAt`, which under the half-open convention in
 * `./cycle.ts` is the first instant at which the action is no longer permitted
 * — so it is also the first instant at which it is late. The two definitions
 * agree by construction, which is the point of using one boundary for both.
 *
 * Status is not consulted: a `DRAFT` cycle still has planned deadlines, and
 * being able to show them before the cycle opens is the whole use for them.
 */
export function deadlineFor(action: CycleAction, cycle: Cycle): Date | null {
  const keys = ACTION_PHASES[action];

  const ends = cycle.phases
    .filter((phase) => keys.includes(phase.key))
    .map((phase) => {
      assertValidDate(phase.endsAt, `${phase.key}.endsAt`);
      return phase.endsAt.getTime();
    });

  // An action spanning several phases is due when the last of them closes.
  return ends.length === 0 ? null : new Date(Math.max(...ends));
}

/**
 * Whether the deadline has passed at `now`.
 *
 * Distinct from `daysOverdue(...) > 0` on purpose: something due at midnight
 * and read at 09:00 is *late* but is *0 days* late. Collapsing the two would
 * mean either treating a fresh miss as not-late, or inflating it to a day —
 * which is the smaller cousin of the bug this module replaces.
 */
export function isOverdue(dueAt: Date, now: Date): boolean {
  assertValidDate(dueAt, 'dueAt');
  assertValidDate(now, 'now');

  return now.getTime() >= dueAt.getTime();
}

/**
 * The civil date of an instant in a timezone, expressed as the UTC midnight of
 * that date.
 *
 * Reducing both instants to civil dates before subtracting is what makes the
 * arithmetic DST-proof: UTC midnights are exactly 86,400,000 ms apart with no
 * exceptions, whereas local midnights are 23 or 25 hours apart twice a year.
 *
 * `Intl` is a pure lookup, not I/O — no network, no filesystem, no clock — so
 * it sits comfortably inside this package's purity rule. It throws a
 * `RangeError` on construction for an unknown timezone, which is why nothing
 * below needs to re-check the parts it returns.
 */
function civilDayStart(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);

  const values = new Map(parts.map((part) => [part.type, part.value]));

  return Date.UTC(
    Number(values.get('year')),
    Number(values.get('month')) - 1,
    Number(values.get('day')),
  );
}

/**
 * How many whole calendar days late something is, in the given timezone.
 *
 * **Calendar days, not 24-hour periods**, and that is a decision rather than an
 * implementation detail. When someone reads "3 days overdue" in an escalation
 * email they mean three dates have turned over, not that 72 hours have elapsed.
 * Counting elapsed hours instead would report 0 across a spring-forward — the
 * deadline was yesterday lunchtime, it is lunchtime again, and only 23 hours
 * have passed. The DST tests pin exactly that case.
 *
 * Returns 0 when the deadline has not passed, and 0 for the remainder of the
 * day on which it passed. There is no floor, no minimum, and no rounding up:
 * a thing that is not late is 0 days late.
 */
export function daysOverdue(dueAt: Date, now: Date, timeZone: string = DEFAULT_TIME_ZONE): number {
  assertValidDate(dueAt, 'dueAt');
  assertValidDate(now, 'now');

  if (now.getTime() <= dueAt.getTime()) {
    return 0;
  }

  // Both instants are reduced in the same zone, so `civilDayStart` is monotonic
  // across them and the difference is a whole number of UTC midnights. The
  // rounding settles nothing but floating-point dust.
  const elapsed = civilDayStart(now, timeZone) - civilDayStart(dueAt, timeZone);

  return Math.round(elapsed / 86_400_000);
}

/**
 * How late an action is on a cycle, or 0 if it has no deadline or is not late.
 *
 * The convenience form the escalation evaluator (W2-05) actually calls, so
 * that "which phase does this action belong to" is not re-derived at every
 * call site.
 */
export function daysOverdueFor(
  action: CycleAction,
  cycle: Cycle,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  const dueAt = deadlineFor(action, cycle);

  return dueAt === null ? 0 : daysOverdue(dueAt, now, timeZone);
}

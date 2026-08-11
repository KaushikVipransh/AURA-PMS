import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ESCALATION_THRESHOLDS,
  ESCALATION_TIERS,
  evaluate,
  evaluateAll,
  tierFor,
  type EscalationState,
  type EscalationThresholds,
  type EscalationTier,
} from './escalation.js';

const at = (iso: string): Date => new Date(iso);

const DUE = at('2026-04-16T00:00:00Z');
const THRESHOLDS = DEFAULT_ESCALATION_THRESHOLDS;

function breach(overrides: Partial<EscalationState> = {}): EscalationState {
  return {
    rule: 'GOALS_NOT_SUBMITTED',
    subjectUserId: 'user-1',
    dueAt: DUE,
    status: 'ACTIVE',
    tier: 'EMPLOYEE',
    notifiedAt: [],
    ...overrides,
  };
}

/** `days` whole calendar days after the deadline, at 09:00 UTC. */
const dayAfter = (days: number): Date =>
  at(`2026-04-${String(16 + days).padStart(2, '0')}T09:00:00Z`);

describe('tierFor · thresholds', () => {
  it.each<[number, EscalationTier]>([
    [0, 'EMPLOYEE'],
    [1, 'EMPLOYEE'],
    [2, 'EMPLOYEE'],
    [3, 'MANAGER'],
    [4, 'MANAGER'],
    [6, 'MANAGER'],
    [7, 'SKIP_LEVEL_HR'],
    [8, 'SKIP_LEVEL_HR'],
    [90, 'SKIP_LEVEL_HR'],
  ])('%i days overdue is tier %s', (days, expected) => {
    expect(tierFor(days, THRESHOLDS)).toBe(expected);
  });

  it('reads a threshold as "at or after", so day three is when the manager hears', () => {
    expect(tierFor(THRESHOLDS.manager - 1, THRESHOLDS)).toBe('EMPLOYEE');
    expect(tierFor(THRESHOLDS.manager, THRESHOLDS)).toBe('MANAGER');
    expect(tierFor(THRESHOLDS.skipLevelHr - 1, THRESHOLDS)).toBe('MANAGER');
    expect(tierFor(THRESHOLDS.skipLevelHr, THRESHOLDS)).toBe('SKIP_LEVEL_HR');
  });

  it('never goes down as the days go up', () => {
    const ranks = new Map(ESCALATION_TIERS.map((tier, index) => [tier, index]));
    let previous = -1;

    for (let days = 0; days <= 30; days += 1) {
      const rank = ranks.get(tierFor(days, THRESHOLDS)) ?? -1;

      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it('honours per-cycle thresholds rather than the defaults', () => {
    const strict: EscalationThresholds = { manager: 1, skipLevelHr: 2 };

    expect(tierFor(1, strict)).toBe('MANAGER');
    expect(tierFor(2, strict)).toBe('SKIP_LEVEL_HR');
  });

  it('allows a zero threshold, escalating on the day of the breach', () => {
    expect(tierFor(0, { manager: 0, skipLevelHr: 5 })).toBe('MANAGER');
  });

  it.each<[string, EscalationThresholds]>([
    ['inverted', { manager: 7, skipLevelHr: 3 }],
    ['negative', { manager: -1, skipLevelHr: 7 }],
    ['negative skip-level', { manager: 3, skipLevelHr: -7 }],
    ['fractional', { manager: 1.5, skipLevelHr: 7 }],
    ['fractional skip-level', { manager: 3, skipLevelHr: 7.5 }],
  ])('rejects %s thresholds', (_label, thresholds) => {
    expect(() => tierFor(3, thresholds)).toThrow(RangeError);
  });
});

describe('evaluate · nothing is overdue', () => {
  it('is not a breach before the deadline', () => {
    const decision = evaluate(breach(), THRESHOLDS, at('2026-04-15T23:59:59.999Z'));

    expect(decision).toMatchObject({
      overdue: false,
      daysOverdue: 0,
      tier: 'EMPLOYEE',
      notify: false,
      reason: 'NOT_OVERDUE',
    });
  });

  it('becomes a breach at the exact instant of the deadline', () => {
    const decision = evaluate(breach(), THRESHOLDS, DUE);

    expect(decision.overdue).toBe(true);
    expect(decision.daysOverdue).toBe(0);
    expect(decision.notify).toBe(true);
    expect(decision.reason).toBe('FIRST_BREACH');
  });
});

describe('evaluate · resolved items are excluded', () => {
  it('never notifies a resolved breach, however late it is', () => {
    const decision = evaluate(
      breach({ status: 'RESOLVED', tier: 'MANAGER' }),
      THRESHOLDS,
      dayAfter(10),
    );

    expect(decision.notify).toBe(false);
    expect(decision.reason).toBe('RESOLVED');
  });

  it('does not climb a resolved breach past the tier it was resolved at', () => {
    const decision = evaluate(
      breach({ status: 'RESOLVED', tier: 'EMPLOYEE' }),
      THRESHOLDS,
      dayAfter(10),
    );

    expect(decision.tier).toBe('EMPLOYEE');
    expect(decision.tierChanged).toBe(false);
  });

  it('still reports the real day count, because resolved is not the same as untrue', () => {
    const decision = evaluate(breach({ status: 'RESOLVED' }), THRESHOLDS, dayAfter(10));

    expect(decision.daysOverdue).toBe(10);
    expect(decision.overdue).toBe(true);
  });

  it('excludes resolved items from a batch while keeping them in the output', () => {
    const decisions = evaluateAll(
      [
        breach({ subjectUserId: 'a' }),
        breach({ subjectUserId: 'b', status: 'RESOLVED' }),
        breach({ subjectUserId: 'c' }),
      ],
      THRESHOLDS,
      dayAfter(4),
    );

    expect(decisions).toHaveLength(3);
    expect(decisions.filter((decision) => decision.notify).map((d) => d.subjectUserId)).toEqual([
      'a',
      'c',
    ]);
  });
});

describe('evaluate · the first breach', () => {
  it('notifies when nobody has been told yet', () => {
    const decision = evaluate(breach(), THRESHOLDS, dayAfter(1));

    expect(decision).toMatchObject({ notify: true, reason: 'FIRST_BREACH', tier: 'EMPLOYEE' });
  });

  it('reports the tier the breach has already reached, not the tier it started at', () => {
    // A job that has not run for a week finds a breach already at HR level.
    const decision = evaluate(breach(), THRESHOLDS, dayAfter(9));

    expect(decision.tier).toBe('SKIP_LEVEL_HR');
    expect(decision.tierChanged).toBe(true);
    expect(decision.reason).toBe('FIRST_BREACH');
  });
});

describe('evaluate · climbing a tier', () => {
  it('notifies immediately on a climb, even having already spoken today', () => {
    const today = dayAfter(3);
    const decision = evaluate(
      breach({ tier: 'EMPLOYEE', notifiedAt: [at('2026-04-19T02:00:00Z')] }),
      THRESHOLDS,
      today,
    );

    expect(decision.tier).toBe('MANAGER');
    expect(decision.tierChanged).toBe(true);
    expect(decision.notify).toBe(true);
    expect(decision.reason).toBe('TIER_RAISED');
  });

  it('climbs to HR at the second threshold', () => {
    const decision = evaluate(
      breach({ tier: 'MANAGER', notifiedAt: [dayAfter(6)] }),
      THRESHOLDS,
      dayAfter(7),
    );

    expect(decision.tier).toBe('SKIP_LEVEL_HR');
    expect(decision.reason).toBe('TIER_RAISED');
  });

  it('holds steady once the top tier is reached', () => {
    const decision = evaluate(
      breach({ tier: 'SKIP_LEVEL_HR', notifiedAt: [dayAfter(9)] }),
      THRESHOLDS,
      dayAfter(9),
    );

    expect(decision.tier).toBe('SKIP_LEVEL_HR');
    expect(decision.tierChanged).toBe(false);
    expect(decision.notify).toBe(false);
  });
});

describe('evaluate · idempotency across a repeated run', () => {
  const today = dayAfter(1);

  it('stays quiet when the last send was earlier the same day', () => {
    const decision = evaluate(
      breach({ notifiedAt: [at('2026-04-17T02:00:00Z')] }),
      THRESHOLDS,
      today,
    );

    expect(decision.notify).toBe(false);
    expect(decision.reason).toBe('ALREADY_NOTIFIED_TODAY');
  });

  it('is quiet for the second pass of a job that recorded its first', () => {
    // The nightly job, run twice. The first pass decides to notify; the caller
    // records the send; the second pass over that state decides to stay quiet.
    const before = breach();
    const first = evaluate(before, THRESHOLDS, today);
    expect(first.notify).toBe(true);

    const after: EscalationState = { ...before, notifiedAt: [today], tier: first.tier };
    const second = evaluate(after, THRESHOLDS, today);

    expect(second.notify).toBe(false);
    expect(second.reason).toBe('ALREADY_NOTIFIED_TODAY');
  });

  it('returns the identical answer for identical input, because it is pure', () => {
    // Worth stating plainly: re-running this against *unchanged* state repeats
    // the decision. Idempotency comes from the caller recording the send.
    const state = breach();

    expect(evaluate(state, THRESHOLDS, today)).toEqual(evaluate(state, THRESHOLDS, today));
  });

  it('speaks again the next day', () => {
    const decision = evaluate(breach({ notifiedAt: [dayAfter(1)] }), THRESHOLDS, dayAfter(2));

    expect(decision.notify).toBe(true);
    expect(decision.reason).toBe('DAILY_REMINDER');
  });

  it('measures the day by the calendar, not by elapsed hours', () => {
    // 23:00 and 01:00 are two hours apart and two different days.
    const decision = evaluate(
      breach({ notifiedAt: [at('2026-04-17T23:00:00Z')] }),
      THRESHOLDS,
      at('2026-04-18T01:00:00Z'),
    );

    expect(decision.reason).toBe('DAILY_REMINDER');
  });

  it('uses the most recent send, not the first or the array order', () => {
    const decision = evaluate(
      // Oldest first would read yesterday and send a reminder; the max is today.
      breach({
        notifiedAt: [at('2026-04-16T09:00:00Z'), dayAfter(1), at('2026-04-16T20:00:00Z')],
      }),
      THRESHOLDS,
      dayAfter(1),
    );

    expect(decision.reason).toBe('ALREADY_NOTIFIED_TODAY');
  });

  it('reads "today" in the org timezone', () => {
    const sent = at('2026-04-17T23:00:00Z');
    const now = at('2026-04-18T01:00:00Z');

    // UTC crosses a midnight between the two; UTC-4 does not.
    expect(evaluate(breach({ notifiedAt: [sent] }), THRESHOLDS, now).reason).toBe('DAILY_REMINDER');
    expect(
      evaluate(breach({ notifiedAt: [sent] }), THRESHOLDS, now, 'America/New_York').reason,
    ).toBe('ALREADY_NOTIFIED_TODAY');
  });
});

describe('evaluate · it decides, it does not act', () => {
  it('carries a reason on every decision, including the silent ones', () => {
    const decisions = evaluateAll(
      [
        breach({ subjectUserId: 'not-late', dueAt: at('2027-01-01T00:00:00Z') }),
        breach({ subjectUserId: 'resolved', status: 'RESOLVED' }),
        breach({ subjectUserId: 'quiet', notifiedAt: [dayAfter(1)] }),
      ],
      THRESHOLDS,
      dayAfter(1),
    );

    expect(decisions.map((decision) => decision.reason)).toEqual([
      'NOT_OVERDUE',
      'RESOLVED',
      'ALREADY_NOTIFIED_TODAY',
    ]);
    expect(decisions.every((decision) => !decision.notify)).toBe(true);
  });

  it('does not mutate the state it is given', () => {
    const state = breach({ notifiedAt: [dayAfter(1)] });
    const snapshot = JSON.stringify(state);

    evaluate(state, THRESHOLDS, dayAfter(2));

    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('preserves batch order', () => {
    const ids = ['e', 'd', 'c', 'b', 'a'];
    const decisions = evaluateAll(
      ids.map((subjectUserId) => breach({ subjectUserId })),
      THRESHOLDS,
      dayAfter(1),
    );

    expect(decisions.map((decision) => decision.subjectUserId)).toEqual(ids);
  });

  it('handles an empty batch', () => {
    expect(evaluateAll([], THRESHOLDS, dayAfter(1))).toEqual([]);
  });

  it('rejects misconfigured thresholds before deciding anything', () => {
    expect(() => evaluate(breach(), { manager: 9, skipLevelHr: 2 }, dayAfter(1))).toThrow(
      RangeError,
    );
  });
});

describe('evaluate · F-08 regression', () => {
  it.each<[number, number]>([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
  ])('reports %i day(s) overdue as %i, never a floor of four', (days, expected) => {
    expect(evaluate(breach(), THRESHOLDS, dayAfter(days)).daysOverdue).toBe(expected);
  });

  it('keeps a fresh breach below the manager threshold', () => {
    // Under the prototype's floor of four, this breach would have been reported
    // as four days late and escalated straight past the employee.
    const decision = evaluate(breach(), THRESHOLDS, at('2026-04-16T01:00:00Z'));

    expect(decision.daysOverdue).toBe(0);
    expect(decision.tier).toBe('EMPLOYEE');
  });
});

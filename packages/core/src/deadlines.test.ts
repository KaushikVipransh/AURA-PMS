import { describe, expect, it } from 'vitest';

import type { Cycle, Phase } from './cycle.js';
import {
  DEFAULT_TIME_ZONE,
  daysOverdue,
  daysOverdueFor,
  deadlineFor,
  isOverdue,
} from './deadlines.js';

const at = (iso: string): Date => new Date(iso);

const PHASES: readonly Phase[] = [
  { key: 'GOAL_SETTING', startsAt: at('2026-04-01T00:00:00Z'), endsAt: at('2026-04-16T00:00:00Z') },
  { key: 'CHECK_IN', startsAt: at('2026-07-01T00:00:00Z'), endsAt: at('2026-07-16T00:00:00Z') },
  { key: 'APPRAISAL', startsAt: at('2026-10-01T00:00:00Z'), endsAt: at('2026-10-16T00:00:00Z') },
  { key: 'CALIBRATION', startsAt: at('2026-10-16T00:00:00Z'), endsAt: at('2026-11-01T00:00:00Z') },
  { key: 'RESULTS', startsAt: at('2026-11-01T00:00:00Z'), endsAt: at('2026-11-16T00:00:00Z') },
];

const cycle: Cycle = { status: 'ACTIVE', phases: PHASES };

describe('deadlineFor', () => {
  it('is the end of the phase the action belongs to', () => {
    expect(deadlineFor('EDIT_GOALS', cycle)).toEqual(at('2026-04-16T00:00:00Z'));
    expect(deadlineFor('RECORD_CHECK_IN', cycle)).toEqual(at('2026-07-16T00:00:00Z'));
    expect(deadlineFor('CALIBRATE', cycle)).toEqual(at('2026-11-01T00:00:00Z'));
  });

  it('uses the same boundary that closes the window, so late begins where allowed ends', () => {
    // isActionAllowed goes false at exactly this instant (cycle.ts), and
    // isOverdue goes true at exactly this instant. One boundary, two readings.
    const boundary = at('2026-04-16T00:00:00Z');

    expect(deadlineFor('EDIT_GOALS', cycle)).toEqual(boundary);
    expect(isOverdue(boundary, boundary)).toBe(true);
    expect(isOverdue(boundary, at('2026-04-15T23:59:59.999Z'))).toBe(false);
  });

  it('returns null when the cycle has no phase for the action', () => {
    const partial: Cycle = { status: 'ACTIVE', phases: PHASES.slice(0, 1) };

    expect(deadlineFor('CALIBRATE', partial)).toBeNull();
  });

  it('returns null for a cycle with no phases at all', () => {
    expect(deadlineFor('EDIT_GOALS', { status: 'ACTIVE', phases: [] })).toBeNull();
  });

  it('reports planned deadlines on a draft cycle', () => {
    expect(deadlineFor('EDIT_GOALS', { status: 'DRAFT', phases: PHASES })).toEqual(
      at('2026-04-16T00:00:00Z'),
    );
  });

  it('rejects an unreadable phase end rather than returning a nonsense date', () => {
    const broken: Cycle = {
      status: 'ACTIVE',
      phases: [{ key: 'GOAL_SETTING', startsAt: at('2026-04-01T00:00:00Z'), endsAt: new Date('x') }],
    };

    expect(() => deadlineFor('EDIT_GOALS', broken)).toThrow(/GOAL_SETTING\.endsAt/);
  });
});

describe('isOverdue', () => {
  const due = at('2026-04-16T00:00:00Z');

  it('is false before the deadline', () => {
    expect(isOverdue(due, at('2026-04-15T23:59:59.999Z'))).toBe(false);
  });

  it('is true at the exact instant of the deadline', () => {
    expect(isOverdue(due, due)).toBe(true);
  });

  it('is true after the deadline', () => {
    expect(isOverdue(due, at('2026-04-20T00:00:00Z'))).toBe(true);
  });

  it('is distinct from being a whole day late', () => {
    const justAfter = at('2026-04-16T09:00:00Z');

    expect(isOverdue(due, justAfter)).toBe(true);
    expect(daysOverdue(due, justAfter)).toBe(0);
  });

  it.each<[string, Date, Date]>([
    ['dueAt', new Date('x'), at('2026-04-16T00:00:00Z')],
    ['now', at('2026-04-16T00:00:00Z'), new Date('x')],
  ])('rejects an invalid %s', (_label, a, b) => {
    expect(() => isOverdue(a, b)).toThrow(RangeError);
  });
});

describe('daysOverdue · nothing is late', () => {
  const due = at('2026-04-16T00:00:00Z');

  it('is 0 well before the deadline', () => {
    expect(daysOverdue(due, at('2026-04-01T00:00:00Z'))).toBe(0);
  });

  it('is 0 one millisecond before the deadline', () => {
    expect(daysOverdue(due, at('2026-04-15T23:59:59.999Z'))).toBe(0);
  });

  it('is 0 at the exact instant of the deadline', () => {
    expect(daysOverdue(due, due)).toBe(0);
  });
});

describe('daysOverdue · exact midnight boundaries', () => {
  const due = at('2026-04-16T00:00:00Z');

  it.each<[string, number]>([
    ['2026-04-16T00:00:01Z', 0],
    ['2026-04-16T12:00:00Z', 0],
    ['2026-04-16T23:59:59.999Z', 0],
    ['2026-04-17T00:00:00Z', 1],
    ['2026-04-17T23:59:59.999Z', 1],
    ['2026-04-18T00:00:00Z', 2],
    ['2026-04-26T00:00:00Z', 10],
  ])('at %s reports %i day(s)', (now, expected) => {
    expect(daysOverdue(due, at(now))).toBe(expected);
  });

  it('turns over at local midnight, not at a rolling 24 hours', () => {
    const dueAtNoon = at('2026-04-16T12:00:00Z');

    // 12 hours later is the next date, so one day. 11 hours later is not.
    expect(daysOverdue(dueAtNoon, at('2026-04-16T23:00:00Z'))).toBe(0);
    expect(daysOverdue(dueAtNoon, at('2026-04-17T00:00:00Z'))).toBe(1);
  });
});

describe('daysOverdue · F-08 regression: no floor', () => {
  const due = at('2026-04-16T00:00:00Z');

  it.each<[string, number]>([
    ['2026-04-16T01:00:00Z', 0],
    ['2026-04-17T01:00:00Z', 1],
    ['2026-04-18T01:00:00Z', 2],
    ['2026-04-19T01:00:00Z', 3],
    ['2026-04-20T01:00:00Z', 4],
  ])('reports the real count at %s, not a minimum of four', (now, expected) => {
    // The prototype computed Math.max(elapsedDays, 4), so every one of these
    // read as "4 days overdue" and escalated on that basis.
    expect(daysOverdue(due, at(now))).toBe(expected);
  });

  it('never inflates a fresh miss into an escalation-worthy number', () => {
    const oneHourLate = daysOverdue(due, at('2026-04-16T01:00:00Z'));

    expect(oneHourLate).toBe(0);
    expect(oneHourLate).toBeLessThan(4);
  });
});

describe('daysOverdue · daylight saving transitions', () => {
  const NEW_YORK = 'America/New_York';

  it('counts a day across spring forward, where only 23 hours elapse', () => {
    // US DST begins 2026-03-08. Due at noon EST on the 7th, read at noon EDT
    // on the 8th: the same wall-clock time on the next date, 23 hours later.
    const due = at('2026-03-07T17:00:00Z');
    const now = at('2026-03-08T16:00:00Z');

    expect(now.getTime() - due.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(daysOverdue(due, now, NEW_YORK)).toBe(1);
  });

  it('is the case a 24-hour count gets wrong', () => {
    const due = at('2026-03-07T17:00:00Z');
    const now = at('2026-03-08T16:00:00Z');

    // The naive implementation. It says nothing is a day late yet.
    expect(Math.floor((now.getTime() - due.getTime()) / 86_400_000)).toBe(0);
    expect(daysOverdue(due, now, NEW_YORK)).toBe(1);
  });

  it('counts one day across fall back, where 25 hours elapse', () => {
    // US DST ends 2026-11-01. Noon EDT on 31 October to noon EST on 1 November.
    const due = at('2026-10-31T16:00:00Z');
    const now = at('2026-11-01T17:00:00Z');

    expect(now.getTime() - due.getTime()).toBe(25 * 60 * 60 * 1000);
    expect(daysOverdue(due, now, NEW_YORK)).toBe(1);
  });

  it('stays consistent across a whole DST week', () => {
    const due = at('2026-03-07T17:00:00Z');

    expect(daysOverdue(due, at('2026-03-09T16:00:00Z'), NEW_YORK)).toBe(2);
    expect(daysOverdue(due, at('2026-03-10T16:00:00Z'), NEW_YORK)).toBe(3);
    expect(daysOverdue(due, at('2026-03-14T16:00:00Z'), NEW_YORK)).toBe(7);
  });
});

describe('daysOverdue · the timezone is the org’s, not the server’s', () => {
  const due = at('2026-04-16T22:00:00Z');
  const now = at('2026-04-17T02:00:00Z');

  it('counts a turned-over date in UTC', () => {
    expect(daysOverdue(due, now, 'UTC')).toBe(1);
  });

  it('counts none in a zone where both instants fall on the same date', () => {
    // UTC-4: 18:00 and 22:00 on the 16th. Same day, so not yet a day late.
    expect(daysOverdue(due, now, 'America/New_York')).toBe(0);
  });

  it('counts one in a zone whose midnight also falls between the two instants', () => {
    // BST is UTC+1 in April: 23:00 on the 16th and 03:00 on the 17th.
    expect(daysOverdue(due, now, 'Europe/London')).toBe(1);
  });

  it('counts none in a far-eastern zone where both land on the same date', () => {
    // JST is UTC+9: 07:00 and 11:00, both on the 17th. Being ahead of UTC does
    // not mean being further overdue — it depends where the midnight falls.
    expect(daysOverdue(due, now, 'Asia/Tokyo')).toBe(0);
  });

  it('defaults to UTC rather than falling back to the server zone', () => {
    expect(DEFAULT_TIME_ZONE).toBe('UTC');
    expect(daysOverdue(due, now)).toBe(daysOverdue(due, now, 'UTC'));
  });

  it('rejects an unknown timezone instead of silently using UTC', () => {
    expect(() => daysOverdue(due, now, 'Mars/Olympus_Mons')).toThrow(RangeError);
  });

  it('handles a half-hour offset zone', () => {
    // UTC+5:30. 03:30 on the 17th and 07:30 on the 17th: same date.
    expect(daysOverdue(due, now, 'Asia/Kolkata')).toBe(0);
  });
});

describe('daysOverdue · malformed dates', () => {
  it.each<[string, Date, Date]>([
    ['dueAt', new Date('x'), at('2026-04-16T00:00:00Z')],
    ['now', at('2026-04-16T00:00:00Z'), new Date('x')],
  ])('rejects an invalid %s', (_label, a, b) => {
    expect(() => daysOverdue(a, b)).toThrow(RangeError);
  });
});

describe('daysOverdueFor', () => {
  it('resolves the action to its phase and measures from that deadline', () => {
    expect(daysOverdueFor('EDIT_GOALS', cycle, at('2026-04-19T00:00:00Z'))).toBe(3);
  });

  it('is 0 while the window is still open', () => {
    expect(daysOverdueFor('EDIT_GOALS', cycle, at('2026-04-10T00:00:00Z'))).toBe(0);
  });

  it('is 0 when the cycle has no phase for the action', () => {
    const partial: Cycle = { status: 'ACTIVE', phases: PHASES.slice(0, 1) };

    expect(daysOverdueFor('CALIBRATE', partial, at('2027-01-01T00:00:00Z'))).toBe(0);
  });

  it('honours the timezone it is given', () => {
    const shifted: Cycle = {
      status: 'ACTIVE',
      phases: [
        {
          key: 'GOAL_SETTING',
          startsAt: at('2026-04-01T00:00:00Z'),
          endsAt: at('2026-04-16T22:00:00Z'),
        },
      ],
    };
    const now = at('2026-04-17T02:00:00Z');

    // UTC crosses a midnight between these two instants; UTC-4 does not.
    expect(daysOverdueFor('EDIT_GOALS', shifted, now, 'UTC')).toBe(1);
    expect(daysOverdueFor('EDIT_GOALS', shifted, now, 'America/New_York')).toBe(0);
  });
});

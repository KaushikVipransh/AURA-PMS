import { describe, expect, it } from 'vitest';

import {
  ACTION_PHASES,
  CYCLE_ACTIONS,
  PHASE_KEYS,
  activePhase,
  findPhaseOverlaps,
  isActionAllowed,
  nextPhase,
  phasesOverlap,
  type Cycle,
  type CycleStatus,
  type Phase,
  type PhaseKey,
} from './cycle.js';

const at = (iso: string): Date => new Date(iso);

/**
 * A realistic FY27 cycle. Note the shape deliberately mixes both cases:
 * GOAL_SETTING → CHECK_IN → APPRAISAL have gaps between them, while
 * APPRAISAL → CALIBRATION → RESULTS run back to back with none.
 */
const PHASES: readonly Phase[] = [
  { key: 'GOAL_SETTING', startsAt: at('2026-04-01T00:00:00Z'), endsAt: at('2026-04-16T00:00:00Z') },
  { key: 'CHECK_IN', startsAt: at('2026-07-01T00:00:00Z'), endsAt: at('2026-07-16T00:00:00Z') },
  { key: 'APPRAISAL', startsAt: at('2026-10-01T00:00:00Z'), endsAt: at('2026-10-16T00:00:00Z') },
  { key: 'CALIBRATION', startsAt: at('2026-10-16T00:00:00Z'), endsAt: at('2026-11-01T00:00:00Z') },
  { key: 'RESULTS', startsAt: at('2026-11-01T00:00:00Z'), endsAt: at('2026-11-16T00:00:00Z') },
];

const cycle = (status: CycleStatus = 'ACTIVE', phases: readonly Phase[] = PHASES): Cycle => ({
  status,
  phases,
});

const phase = (key: PhaseKey, startsAt: string, endsAt: string): Phase => ({
  key,
  startsAt: at(startsAt),
  endsAt: at(endsAt),
});

/** An instant comfortably inside the given phase, for the action tables. */
const DURING: Readonly<Record<PhaseKey, Date>> = {
  GOAL_SETTING: at('2026-04-08T12:00:00Z'),
  CHECK_IN: at('2026-07-08T12:00:00Z'),
  APPRAISAL: at('2026-10-08T12:00:00Z'),
  CALIBRATION: at('2026-10-24T12:00:00Z'),
  RESULTS: at('2026-11-08T12:00:00Z'),
};

describe('activePhase · where the cycle is', () => {
  it('finds the phase containing the instant', () => {
    expect(activePhase(cycle(), at('2026-04-08T12:00:00Z'))?.key).toBe('GOAL_SETTING');
    expect(activePhase(cycle(), at('2026-07-08T12:00:00Z'))?.key).toBe('CHECK_IN');
  });

  it('returns null before the first phase opens', () => {
    expect(activePhase(cycle(), at('2026-03-31T23:59:59.999Z'))).toBeNull();
  });

  it('returns null in the gap between two phases', () => {
    expect(activePhase(cycle(), at('2026-05-15T12:00:00Z'))).toBeNull();
  });

  it('returns null after the last phase closes', () => {
    expect(activePhase(cycle(), at('2026-11-16T00:00:00Z'))).toBeNull();
    expect(activePhase(cycle(), at('2027-06-01T00:00:00Z'))).toBeNull();
  });
});

describe('activePhase · boundaries are half-open', () => {
  it('includes the instant a phase starts', () => {
    expect(activePhase(cycle(), at('2026-04-01T00:00:00Z'))?.key).toBe('GOAL_SETTING');
  });

  it('includes the last representable instant before a phase ends', () => {
    expect(activePhase(cycle(), at('2026-04-15T23:59:59.999Z'))?.key).toBe('GOAL_SETTING');
  });

  it('excludes the instant a phase ends', () => {
    expect(activePhase(cycle(), at('2026-04-16T00:00:00Z'))).toBeNull();
  });

  it('hands over cleanly where two phases meet, with no overlap and no gap', () => {
    // The single instant 2026-10-16T00:00:00Z: APPRAISAL ends, CALIBRATION
    // begins. Exactly one of them owns it, and it is the later one.
    expect(activePhase(cycle(), at('2026-10-15T23:59:59.999Z'))?.key).toBe('APPRAISAL');
    expect(activePhase(cycle(), at('2026-10-16T00:00:00Z'))?.key).toBe('CALIBRATION');
  });
});

describe('activePhase · status governs whether the dates are in force', () => {
  it.each<CycleStatus>(['DRAFT', 'CLOSED'])(
    'returns null on a %s cycle even mid-phase',
    (status) => {
      expect(activePhase(cycle(status), at('2026-04-08T12:00:00Z'))).toBeNull();
    },
  );

  it('returns a phase on an active cycle at the same instant', () => {
    expect(activePhase(cycle('ACTIVE'), at('2026-04-08T12:00:00Z'))?.key).toBe('GOAL_SETTING');
  });

  it('returns null for a cycle with no phases at all', () => {
    expect(activePhase(cycle('ACTIVE', []), at('2026-04-08T12:00:00Z'))).toBeNull();
  });
});

describe('activePhase · malformed dates are named, not swallowed', () => {
  it('rejects an invalid instant rather than reporting "no active phase"', () => {
    expect(() => activePhase(cycle(), new Date('not a date'))).toThrow(RangeError);
  });

  it('names the phase whose bound is unreadable', () => {
    const broken = cycle('ACTIVE', [phase('CHECK_IN', 'nonsense', '2026-07-16T00:00:00Z')]);

    expect(() => activePhase(broken, at('2026-07-08T12:00:00Z'))).toThrow(/CHECK_IN\.startsAt/);
  });

  it('names an unreadable end bound too', () => {
    const broken = cycle('ACTIVE', [phase('CHECK_IN', '2026-07-01T00:00:00Z', 'nonsense')]);

    expect(() => activePhase(broken, at('2026-07-08T12:00:00Z'))).toThrow(/CHECK_IN\.endsAt/);
  });
});

describe('activePhase · overlapping phases resolve deterministically', () => {
  const overlapping: readonly Phase[] = [
    phase('CALIBRATION', '2026-10-10T00:00:00Z', '2026-10-20T00:00:00Z'),
    phase('APPRAISAL', '2026-10-01T00:00:00Z', '2026-10-16T00:00:00Z'),
  ];

  it('picks the earliest-starting match regardless of array order', () => {
    // Malformed data — phasesOverlap is what stops this being persisted. The
    // answer still has to be the same one every time it is asked.
    const subject = activePhase(cycle('ACTIVE', overlapping), at('2026-10-12T00:00:00Z'));

    expect(subject?.key).toBe('APPRAISAL');
    expect(phasesOverlap(overlapping)).toBe(true);
  });
});

describe('nextPhase', () => {
  it('reports the first phase before the cycle opens', () => {
    expect(nextPhase(cycle(), at('2026-01-01T00:00:00Z'))?.key).toBe('GOAL_SETTING');
  });

  it('reports the following phase from inside one', () => {
    expect(nextPhase(cycle(), at('2026-04-08T12:00:00Z'))?.key).toBe('CHECK_IN');
  });

  it('is strict, so standing on a start boundary looks past that phase', () => {
    expect(nextPhase(cycle(), at('2026-04-01T00:00:00Z'))?.key).toBe('CHECK_IN');
  });

  it('reports the next phase from within a gap', () => {
    expect(nextPhase(cycle(), at('2026-05-15T12:00:00Z'))?.key).toBe('CHECK_IN');
  });

  it('returns null once the last phase has begun', () => {
    expect(nextPhase(cycle(), at('2026-11-08T12:00:00Z'))).toBeNull();
  });

  it('still answers on a draft cycle — "goal setting opens 1 April"', () => {
    expect(nextPhase(cycle('DRAFT'), at('2026-01-01T00:00:00Z'))?.key).toBe('GOAL_SETTING');
  });

  it('returns null for a cycle with no phases', () => {
    expect(nextPhase(cycle('ACTIVE', []), at('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('rejects an invalid instant', () => {
    expect(() => nextPhase(cycle(), new Date('not a date'))).toThrow(RangeError);
  });

  it('names an unreadable start bound', () => {
    const broken = cycle('ACTIVE', [phase('RESULTS', 'nonsense', '2026-11-16T00:00:00Z')]);

    expect(() => nextPhase(broken, at('2026-01-01T00:00:00Z'))).toThrow(/RESULTS\.startsAt/);
  });
});

describe('isActionAllowed · every action against every phase', () => {
  const combinations = CYCLE_ACTIONS.flatMap((action) =>
    PHASE_KEYS.map((key) => ({
      action,
      key,
      expected: ACTION_PHASES[action].includes(key),
    })),
  );

  it('covers the full grid', () => {
    expect(combinations).toHaveLength(CYCLE_ACTIONS.length * PHASE_KEYS.length);
  });

  it.each(combinations)('$action during $key is $expected', ({ action, key, expected }) => {
    expect(isActionAllowed(action, cycle(), DURING[key])).toBe(expected);
  });

  it('permits exactly one action group per phase, so nothing is universally open', () => {
    for (const key of PHASE_KEYS) {
      const allowed = CYCLE_ACTIONS.filter((action) => isActionAllowed(action, cycle(), DURING[key]));

      expect(allowed.length).toBeGreaterThan(0);
      expect(allowed.length).toBeLessThan(CYCLE_ACTIONS.length);
    }
  });
});

describe('isActionAllowed · the clock says no', () => {
  it.each(CYCLE_ACTIONS)('refuses %s between phases', (action) => {
    expect(isActionAllowed(action, cycle(), at('2026-05-15T12:00:00Z'))).toBe(false);
  });

  it.each(CYCLE_ACTIONS)('refuses %s on a draft cycle', (action) => {
    expect(isActionAllowed(action, cycle('DRAFT'), DURING.GOAL_SETTING)).toBe(false);
  });

  it.each(CYCLE_ACTIONS)('refuses %s on a closed cycle', (action) => {
    expect(isActionAllowed(action, cycle('CLOSED'), DURING.RESULTS)).toBe(false);
  });

  it('refuses a check-in write during goal setting — F-04 was a locked sheet accepting one', () => {
    expect(isActionAllowed('RECORD_CHECK_IN', cycle(), DURING.GOAL_SETTING)).toBe(false);
    expect(isActionAllowed('RECORD_CHECK_IN', cycle(), DURING.CHECK_IN)).toBe(true);
  });

  it('refuses goal edits once the check-in window opens', () => {
    expect(isActionAllowed('EDIT_GOALS', cycle(), DURING.CHECK_IN)).toBe(false);
  });

  it('closes at the exact instant the phase ends', () => {
    expect(isActionAllowed('EDIT_GOALS', cycle(), at('2026-04-15T23:59:59.999Z'))).toBe(true);
    expect(isActionAllowed('EDIT_GOALS', cycle(), at('2026-04-16T00:00:00Z'))).toBe(false);
  });
});

describe('phasesOverlap', () => {
  it('accepts a well-formed cycle', () => {
    expect(phasesOverlap(PHASES)).toBe(false);
    expect(findPhaseOverlaps(PHASES)).toEqual([]);
  });

  it('treats phases that merely touch as adjacent, not overlapping', () => {
    const touching = [
      phase('APPRAISAL', '2026-10-01T00:00:00Z', '2026-10-16T00:00:00Z'),
      phase('CALIBRATION', '2026-10-16T00:00:00Z', '2026-11-01T00:00:00Z'),
    ];

    expect(phasesOverlap(touching)).toBe(false);
  });

  it('accepts an empty list and a single phase', () => {
    expect(phasesOverlap([])).toBe(false);
    expect(phasesOverlap(PHASES.slice(0, 1))).toBe(false);
  });

  it('detects a partial overlap and reports the intersection', () => {
    const clashing = [
      phase('APPRAISAL', '2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z'),
      phase('CALIBRATION', '2026-10-16T00:00:00Z', '2026-11-01T00:00:00Z'),
    ];

    expect(findPhaseOverlaps(clashing)).toEqual([
      {
        earlier: 'APPRAISAL',
        later: 'CALIBRATION',
        from: at('2026-10-16T00:00:00Z'),
        until: at('2026-10-20T00:00:00Z'),
      },
    ]);
  });

  it('detects one phase entirely inside another, and reports the inner window', () => {
    const nested = [
      phase('APPRAISAL', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'),
      phase('CALIBRATION', '2026-10-10T00:00:00Z', '2026-10-20T00:00:00Z'),
    ];

    expect(findPhaseOverlaps(nested)).toEqual([
      {
        earlier: 'APPRAISAL',
        later: 'CALIBRATION',
        from: at('2026-10-10T00:00:00Z'),
        until: at('2026-10-20T00:00:00Z'),
      },
    ]);
  });

  it('detects two identical windows', () => {
    const duplicated = [
      phase('APPRAISAL', '2026-10-01T00:00:00Z', '2026-10-16T00:00:00Z'),
      phase('CALIBRATION', '2026-10-01T00:00:00Z', '2026-10-16T00:00:00Z'),
    ];

    expect(findPhaseOverlaps(duplicated)).toHaveLength(1);
  });

  it('reports the same result whatever order the phases arrive in', () => {
    const clashing = [
      phase('CALIBRATION', '2026-10-16T00:00:00Z', '2026-11-01T00:00:00Z'),
      phase('APPRAISAL', '2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z'),
    ];

    expect(findPhaseOverlaps(clashing)[0]?.earlier).toBe('APPRAISAL');
  });

  it('finds every colliding pair, not just the first', () => {
    const messy = [
      phase('GOAL_SETTING', '2026-04-01T00:00:00Z', '2026-05-01T00:00:00Z'),
      phase('CHECK_IN', '2026-04-10T00:00:00Z', '2026-05-10T00:00:00Z'),
      phase('APPRAISAL', '2026-04-20T00:00:00Z', '2026-05-20T00:00:00Z'),
    ];

    expect(findPhaseOverlaps(messy)).toHaveLength(3);
  });

  it('rejects an unreadable bound rather than reporting no overlap', () => {
    expect(() =>
      findPhaseOverlaps([
        phase('GOAL_SETTING', 'nonsense', '2026-05-01T00:00:00Z'),
        phase('CHECK_IN', '2026-04-10T00:00:00Z', '2026-05-10T00:00:00Z'),
      ]),
    ).toThrow(RangeError);
  });

  it('rejects an unreadable bound on the later phase of a pair', () => {
    expect(() =>
      findPhaseOverlaps([
        phase('GOAL_SETTING', '2026-04-01T00:00:00Z', '2026-05-01T00:00:00Z'),
        phase('CHECK_IN', '2026-04-10T00:00:00Z', 'nonsense'),
      ]),
    ).toThrow(/CHECK_IN\.endsAt/);
  });
});

describe('the phase table itself', () => {
  it('assigns every action to at least one phase', () => {
    for (const action of CYCLE_ACTIONS) {
      expect(ACTION_PHASES[action].length).toBeGreaterThan(0);
    }
  });

  it('references only phases that exist', () => {
    for (const action of CYCLE_ACTIONS) {
      for (const key of ACTION_PHASES[action]) {
        expect(PHASE_KEYS).toContain(key);
      }
    }
  });

  it('contains no read-only actions — reading is never time-gated', () => {
    expect(CYCLE_ACTIONS.filter((action) => action.startsWith('VIEW'))).toEqual([]);
  });
});

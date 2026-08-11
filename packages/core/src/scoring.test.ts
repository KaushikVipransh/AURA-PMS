import { describe, expect, it } from 'vitest';

import {
  GOAL_DIRECTIONS,
  GOAL_STATUSES,
  InvalidGoalError,
  TIMELINE_SCORES,
  UOMS,
  clamp01,
  scoreGoal,
  scoreSheet,
  type GoalDirection,
  type ScorableGoal,
  type Uom,
  type WeightedGoal,
} from './scoring.js';

/** Build a goal, overriding only what a case cares about. */
function goal(overrides: Partial<ScorableGoal> = {}): ScorableGoal {
  return {
    uom: 'NUMERIC',
    direction: 'HIGHER_IS_BETTER',
    target: 100,
    actualAchievement: 100,
    status: 'NOT_STARTED',
    ...overrides,
  };
}

/** Assert the call fails as a data defect, and names the offending field. */
function expectInvalid(call: () => unknown, field: string): void {
  let caught: unknown;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InvalidGoalError);
  expect((caught as InvalidGoalError).field).toBe(field);
}

type ScoreCase = {
  readonly name: string;
  readonly goal: ScorableGoal;
  readonly expected: number;
};

describe('scoreGoal · NUMERIC and PERCENT, HIGHER_IS_BETTER', () => {
  const cases: readonly ScoreCase[] = [
    { name: 'exactly on target', goal: goal({ actualAchievement: 100 }), expected: 1 },
    { name: 'three quarters of the way', goal: goal({ actualAchievement: 75 }), expected: 0.75 },
    { name: 'nothing achieved', goal: goal({ actualAchievement: 0 }), expected: 0 },
    { name: 'over-delivery clamps to 1', goal: goal({ actualAchievement: 150 }), expected: 1 },
    { name: 'negative actual clamps to 0', goal: goal({ actualAchievement: -50 }), expected: 0 },
    {
      name: 'numeric strings parse, as Prisma stores them',
      goal: goal({ target: '200', actualAchievement: '50' }),
      expected: 0.25,
    },
    {
      name: 'whitespace around a numeric string is tolerated',
      goal: goal({ target: ' 100 ', actualAchievement: ' 40 ' }),
      expected: 0.4,
    },
    {
      name: 'a null actual scores 0 — nothing reported is not nothing wrong',
      goal: goal({ actualAchievement: null }),
      expected: 0,
    },
    {
      name: 'a blank actual scores 0 rather than coercing to a real zero',
      goal: goal({ actualAchievement: '   ' }),
      expected: 0,
    },
    {
      name: 'target 0 is met by any non-negative actual',
      goal: goal({ target: 0, actualAchievement: 5 }),
      expected: 1,
    },
    {
      name: 'target 0 is met by an actual of exactly 0',
      goal: goal({ target: 0, actualAchievement: 0 }),
      expected: 1,
    },
    {
      name: 'target 0 is missed by a negative actual',
      goal: goal({ target: 0, actualAchievement: -1 }),
      expected: 0,
    },
    {
      name: 'a negative target still reads higher-is-better correctly',
      goal: goal({ target: -5, actualAchievement: -8 }),
      expected: 0.4,
    },
    {
      name: 'a negative target beaten upwards clamps to 1',
      goal: goal({ target: -5, actualAchievement: -2 }),
      expected: 1,
    },
    {
      name: 'PERCENT behaves identically — the scale is irrelevant',
      goal: goal({ uom: 'PERCENT', target: 95, actualAchievement: 76 }),
      expected: 0.8,
    },
    {
      name: 'PERCENT fractional targets, e.g. 99.95% uptime',
      goal: goal({ uom: 'PERCENT', target: '99.95', actualAchievement: '99.95' }),
      expected: 1,
    },
  ];

  it.each(cases)('$name', ({ goal: subject, expected }) => {
    expect(scoreGoal(subject)).toBeCloseTo(expected, 10);
  });
});

describe('scoreGoal · NUMERIC and PERCENT, LOWER_IS_BETTER', () => {
  const lower = (overrides: Partial<ScorableGoal> = {}): ScorableGoal =>
    goal({ direction: 'LOWER_IS_BETTER', target: 5, ...overrides });

  const cases: readonly ScoreCase[] = [
    { name: 'exactly on target', goal: lower({ actualAchievement: 5 }), expected: 1 },
    { name: 'comfortably under target', goal: lower({ actualAchievement: 3 }), expected: 1 },
    { name: 'zero is perfect', goal: lower({ actualAchievement: 0 }), expected: 1 },
    { name: 'a negative actual is still perfect', goal: lower({ actualAchievement: -2 }), expected: 1 },
    { name: '20% over target', goal: lower({ actualAchievement: 6 }), expected: 0.8 },
    { name: '50% over target', goal: lower({ actualAchievement: 7.5 }), expected: 0.5 },
    {
      name: 'double the target scores zero — where this departs from the prototype',
      goal: lower({ actualAchievement: 10 }),
      expected: 0,
    },
    {
      name: 'five times the target stays at zero rather than the prototype 0.2',
      goal: lower({ actualAchievement: 25 }),
      expected: 0,
    },
    {
      name: 'a null actual scores 0 even though lower is better',
      goal: lower({ actualAchievement: null }),
      expected: 0,
    },
    {
      name: 'target 0 with a positive actual scores 0',
      goal: lower({ target: 0, actualAchievement: 1 }),
      expected: 0,
    },
    {
      name: 'target 0 with an actual of 0 scores 1',
      goal: lower({ target: 0, actualAchievement: 0 }),
      expected: 1,
    },
    {
      name: 'a negative target undershot is perfect',
      goal: lower({ target: -5, actualAchievement: -8 }),
      expected: 1,
    },
    {
      name: 'a negative target overshot degrades linearly rather than inverting',
      goal: lower({ target: -5, actualAchievement: -2 }),
      expected: 0.4,
    },
    {
      name: 'PERCENT lower-is-better, e.g. attrition',
      goal: lower({ uom: 'PERCENT', target: 10, actualAchievement: 12 }),
      expected: 0.8,
    },
  ];

  it.each(cases)('$name', ({ goal: subject, expected }) => {
    expect(scoreGoal(subject)).toBeCloseTo(expected, 10);
  });
});

describe('scoreGoal · ZERO_BASED', () => {
  const zeroBased = (overrides: Partial<ScorableGoal> = {}): ScorableGoal =>
    goal({ uom: 'ZERO_BASED', direction: 'LOWER_IS_BETTER', target: 0, ...overrides });

  const cases: readonly ScoreCase[] = [
    { name: 'zero incidents scores 1', goal: zeroBased({ actualAchievement: 0 }), expected: 1 },
    {
      name: 'zero as a string scores 1',
      goal: zeroBased({ target: '0', actualAchievement: '0' }),
      expected: 1,
    },
    {
      name: 'an absent target is read as the implied zero',
      goal: zeroBased({ target: null, actualAchievement: 0 }),
      expected: 1,
    },
    { name: 'one incident scores 0', goal: zeroBased({ actualAchievement: 1 }), expected: 0 },
    {
      name: 'many incidents still score 0 — it is binary, not graded',
      goal: zeroBased({ actualAchievement: 47 }),
      expected: 0,
    },
    {
      name: 'a negative actual is at or below zero, so it scores 1',
      goal: zeroBased({ actualAchievement: -1 }),
      expected: 1,
    },
    {
      name: 'an unreported actual scores 0',
      goal: zeroBased({ actualAchievement: null }),
      expected: 0,
    },
  ];

  it.each(cases)('$name', ({ goal: subject, expected }) => {
    expect(scoreGoal(subject)).toBe(expected);
  });

  it('rejects a non-zero target instead of quietly ignoring it', () => {
    expectInvalid(() => scoreGoal(zeroBased({ target: 5 })), 'target');
  });

  it('rejects an unparseable target', () => {
    expectInvalid(() => scoreGoal(zeroBased({ target: 'none' })), 'target');
  });

  it('rejects HIGHER_IS_BETTER — "more incidents is better" is not a goal', () => {
    expectInvalid(
      () => scoreGoal(zeroBased({ direction: 'HIGHER_IS_BETTER', actualAchievement: 0 })),
      'direction',
    );
  });
});

describe('scoreGoal · TIMELINE', () => {
  const cases: readonly ScoreCase[] = GOAL_STATUSES.map((status) => ({
    name: `${status} scores ${String(TIMELINE_SCORES[status])}`,
    goal: goal({ uom: 'TIMELINE', status }),
    expected: TIMELINE_SCORES[status],
  }));

  it.each(cases)('$name', ({ goal: subject, expected }) => {
    expect(scoreGoal(subject)).toBe(expected);
  });

  it('is measured by status alone, so a garbage target and actual cannot break it', () => {
    expect(
      scoreGoal(
        goal({
          uom: 'TIMELINE',
          status: 'COMPLETED',
          target: 'Q3 launch',
          actualAchievement: 'shipped',
        }),
      ),
    ).toBe(1);
  });

  it.each(GOAL_DIRECTIONS)('ignores direction (%s), which does not apply to a milestone', (direction) => {
    expect(scoreGoal(goal({ uom: 'TIMELINE', status: 'ON_TRACK', direction }))).toBe(0.5);
  });
});

describe('scoreGoal · malformed input is rejected, not scored', () => {
  it('rejects a missing target rather than substituting 1 (the prototype `|| 1` bug)', () => {
    expectInvalid(() => scoreGoal(goal({ target: null })), 'target');
  });

  it('rejects a blank target', () => {
    expectInvalid(() => scoreGoal(goal({ target: '' })), 'target');
  });

  it('rejects a text target such as "N/A"', () => {
    expectInvalid(() => scoreGoal(goal({ target: 'N/A' })), 'target');
  });

  it('rejects a non-finite numeric target', () => {
    expectInvalid(() => scoreGoal(goal({ target: Number.POSITIVE_INFINITY })), 'target');
  });

  it('rejects a text actual, which is a defect rather than a zero', () => {
    expectInvalid(() => scoreGoal(goal({ actualAchievement: 'about half' })), 'actualAchievement');
  });

  it('rejects NaN as an actual', () => {
    expectInvalid(() => scoreGoal(goal({ actualAchievement: Number.NaN })), 'actualAchievement');
  });

  it('names the goal in the message when given a label', () => {
    let message = '';
    try {
      scoreGoal(goal({ target: 'N/A' }), 'goal-42');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('goal-42');
  });
});

describe('scoreGoal · F-06 regression: direction is declared, never inferred', () => {
  /* The prototype ran `title.toLowerCase().includes('tat' | 'cost' | 'reduction')`
     and inverted the score on a match. These titles all trip that check. */
  const titles = [
    'Reduce customer TAT',
    'Cost Awareness Training',
    'Complete the reduction programme',
    'Improve job Rotation across the team',
  ];

  it.each(titles)('scores "%s" by its declared direction, not its words', (title) => {
    const subject = { ...goal({ target: 100, actualAchievement: 75 }), title };
    // Inference would have flipped these to 100/75 = 1.33 → clamped to 1.
    expect(scoreGoal(subject)).toBeCloseTo(0.75, 10);
  });

  it('gives opposite scores for the same numbers when the direction differs', () => {
    const numbers = { target: 100, actualAchievement: 200 } as const;
    expect(scoreGoal(goal({ ...numbers, direction: 'HIGHER_IS_BETTER' }))).toBe(1);
    expect(scoreGoal(goal({ ...numbers, direction: 'LOWER_IS_BETTER' }))).toBe(0);
  });
});

describe('scoreSheet', () => {
  const perfect: ScorableGoal = goal({ actualAchievement: 100 });
  const halfway: ScorableGoal = goal({ uom: 'TIMELINE', status: 'ON_TRACK' });
  const missed: ScorableGoal = goal({ actualAchievement: 0 });

  it('weights each goal by its weightage', () => {
    const result = scoreSheet([
      { ...perfect, id: 'a', weightage: 50 },
      { ...halfway, id: 'b', weightage: 30 },
      { ...missed, id: 'c', weightage: 20 },
    ]);

    expect(result.score).toBeCloseTo(0.65, 10);
    expect(result.percent).toBe(65);
    expect(result.totalWeightage).toBe(100);
  });

  it('reports a per-goal breakdown that sums to the sheet score', () => {
    const result = scoreSheet([
      { ...perfect, id: 'a', weightage: 50 },
      { ...halfway, id: 'b', weightage: 30 },
      { ...missed, id: 'c', weightage: 20 },
    ]);

    expect(result.breakdown).toHaveLength(3);
    expect(result.breakdown[0]).toMatchObject({ id: 'a', index: 0, score: 1, weightage: 50 });
    expect(result.breakdown[1]?.contribution).toBeCloseTo(0.15, 10);
    expect(result.breakdown[2]?.contribution).toBe(0);

    const summed = result.breakdown.reduce((total, entry) => total + entry.contribution, 0);
    expect(summed).toBeCloseTo(result.score, 10);
  });

  it('accepts weightages as strings, which is how Prisma Decimal serialises', () => {
    const result = scoreSheet([
      { ...perfect, weightage: '33.34' },
      { ...perfect, weightage: '33.33' },
      { ...missed, weightage: '33.33' },
    ]);

    expect(result.totalWeightage).toBeCloseTo(100, 10);
    expect(result.percent).toBeCloseTo(66.67, 2);
  });

  it('normalises by the actual total, so a draft sheet mid-edit still scores', () => {
    // 60 total, not 100 — validateWeightages (W2-02) is what rejects that.
    const result = scoreSheet([
      { ...perfect, weightage: 30 },
      { ...missed, weightage: 30 },
    ]);

    expect(result.totalWeightage).toBe(60);
    expect(result.score).toBeCloseTo(0.5, 10);
  });

  it('returns zero for an empty sheet rather than dividing by nothing', () => {
    const result = scoreSheet([]);

    expect(result).toEqual({ score: 0, percent: 0, totalWeightage: 0, breakdown: [] });
  });

  it('returns zero, not NaN, when every weightage is zero', () => {
    const result = scoreSheet([
      { ...perfect, weightage: 0 },
      { ...perfect, weightage: 0 },
    ]);

    expect(result.score).toBe(0);
    expect(result.percent).toBe(0);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it('rejects an unparseable weightage', () => {
    expectInvalid(() => scoreSheet([{ ...perfect, weightage: 'heavy' }]), 'weightage');
  });

  it('rejects a negative weightage', () => {
    expectInvalid(() => scoreSheet([{ ...perfect, weightage: -5 }]), 'weightage');
  });

  it('identifies the offending goal by id', () => {
    let message = '';
    try {
      scoreSheet([{ ...perfect, id: 'goal-7', weightage: 'heavy' }]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('goal-7');
  });

  it('falls back to the array index when a goal has no id', () => {
    let message = '';
    try {
      scoreSheet([
        { ...perfect, weightage: 50 },
        { ...perfect, weightage: 'heavy' },
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('goals[1]');
  });

  it('surfaces a malformed goal with the sheet position attached', () => {
    let message = '';
    try {
      scoreSheet([{ ...goal({ target: 'N/A' }), id: 'goal-3', weightage: 100 }]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('goal-3');
    expect(message).toContain('target');
  });
});

describe('clamp01', () => {
  it.each([
    [-1, 0],
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [2, 1],
  ])('maps %s to %s', (input, expected) => {
    expect(clamp01(input)).toBe(expected);
  });
});

describe('exhaustiveness', () => {
  /* If someone adds a UoM to the enum, this fails until scoring handles it —
     rather than the new unit silently falling through to linear numeric. */
  it.each(UOMS)('scores every declared UoM: %s', (uom: Uom) => {
    const direction: GoalDirection = uom === 'ZERO_BASED' ? 'LOWER_IS_BETTER' : 'HIGHER_IS_BETTER';
    const target = uom === 'ZERO_BASED' ? 0 : 10;
    const score = scoreGoal(goal({ uom, direction, target, actualAchievement: 0 }));

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('covers every direction for the graded units', () => {
    const graded: readonly Uom[] = ['NUMERIC', 'PERCENT'];
    const combinations: WeightedGoal[] = graded.flatMap((uom) =>
      GOAL_DIRECTIONS.map((direction) => ({
        ...goal({ uom, direction, target: 10, actualAchievement: 5 }),
        weightage: 25,
      })),
    );

    // HIGHER_IS_BETTER: 5/10 = 0.5. LOWER_IS_BETTER: under target, so 1.
    // Two of each at equal weight averages to 0.75.
    expect(combinations).toHaveLength(4);
    expect(scoreSheet(combinations).score).toBeCloseTo(0.75, 10);
  });
});

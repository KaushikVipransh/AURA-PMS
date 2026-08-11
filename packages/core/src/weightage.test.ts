import { describe, expect, it } from 'vitest';

import {
  MAX_GOALS_PER_SHEET,
  MIN_GOALS_PER_SHEET,
  MIN_GOAL_WEIGHTAGE,
  WEIGHTAGE_TOTAL,
  WEIGHTAGE_TOTAL_TOLERANCE,
  remainingWeightage,
  validateWeightages,
  type WeightableGoal,
  type WeightageIssueCode,
} from './weightage.js';

/** A sheet from a list of weightages, with everything else left blank. */
function sheet(...weightages: readonly (string | number | null)[]): WeightableGoal[] {
  return weightages.map((weightage, index) => ({ id: `goal-${String(index + 1)}`, weightage }));
}

function codes(goals: readonly WeightableGoal[]): WeightageIssueCode[] {
  return validateWeightages(goals).issues.map((issue) => issue.code);
}

describe('validateWeightages · a well-formed sheet', () => {
  it('accepts three goals totalling exactly 100', () => {
    const result = validateWeightages(sheet(34, 33, 33));

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.total).toBe(100);
  });

  it('accepts the maximum of eight goals', () => {
    const result = validateWeightages(sheet(12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5));

    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });

  it('accepts weightages as strings, which is how Prisma Decimal serialises', () => {
    const result = validateWeightages(sheet('34.00', '33.00', '33.00'));

    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });
});

describe('validateWeightages · the total, and its float tolerance', () => {
  it('is not fooled by binary float residue', () => {
    // 10 + 58.01 + 31.99 sums to 99.999999999999985789 in IEEE 754. The
    // prototype's strict `total !== 100` rejected sheets like this one, and
    // its `Math.round(total) !== 100` accepted sheets totalling 99.6 — F-10.
    expect(10 + 58.01 + 31.99).not.toBe(100);

    const result = validateWeightages(sheet(10, 58.01, 31.99));

    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });

  it('still rejects the 99.6 that the prototype rounding accepted', () => {
    const result = validateWeightages(sheet(33.2, 33.2, 33.2));

    expect(Math.round(result.total)).toBe(100);
    expect(result.valid).toBe(false);
  });

  it('accepts 99.995 — inside the tolerance', () => {
    const result = validateWeightages(sheet(33.335, 33.33, 33.33));

    expect(result.total).toBeCloseTo(99.995, 10);
    expect(result.valid).toBe(true);
  });

  it('rejects 99.98 — outside the tolerance', () => {
    const result = validateWeightages(sheet(33.33, 33.33, 33.32));

    expect(result.valid).toBe(false);
    expect(codes(sheet(33.33, 33.33, 33.32))).toContain('TOTAL_MISMATCH');
  });

  it('accepts the tolerance boundary exactly, on the over side', () => {
    const result = validateWeightages(sheet(33.34, 33.34, 33.33));

    expect(result.total).toBeCloseTo(100.01, 10);
    expect(result.valid).toBe(true);
  });

  it('rejects one hundredth beyond the boundary', () => {
    const result = validateWeightages(sheet(33.34, 33.34, 33.34));

    expect(result.total).toBeCloseTo(100.02, 10);
    expect(result.valid).toBe(false);
  });

  it('says by how much and in which direction the sheet is off', () => {
    const under = validateWeightages(sheet(30, 30, 30));
    const over = validateWeightages(sheet(40, 40, 40));

    expect(under.issues[0]?.message).toContain('under');
    expect(under.issues[0]?.message).toContain('90');
    expect(over.issues[0]?.message).toContain('over');
    expect(over.issues[0]?.message).toContain('120');
  });

  it('reports a sheet-level issue with no goal attached', () => {
    const issue = validateWeightages(sheet(30, 30, 30)).issues[0];

    expect(issue?.code).toBe('TOTAL_MISMATCH');
    expect(issue?.goalId).toBeUndefined();
    expect(issue?.goalIndex).toBeUndefined();
  });
});

describe('validateWeightages · goal count', () => {
  it('rejects an empty sheet, and says the total is wrong too', () => {
    const result = validateWeightages([]);

    expect(result.valid).toBe(false);
    expect(result.total).toBe(0);
    expect(result.issues.map((issue) => issue.code)).toEqual(['TOO_FEW_GOALS', 'TOTAL_MISMATCH']);
  });

  it('rejects two goals even when they total 100', () => {
    const result = validateWeightages(sheet(50, 50));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['TOO_FEW_GOALS']);
  });

  it('rejects nine goals', () => {
    const nine = sheet(...Array.from({ length: 9 }, () => 100 / 9));
    const result = validateWeightages(nine);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['TOO_MANY_GOALS']);
  });

  it('names the limits in its messages, rather than hardcoding a number twice', () => {
    const tooFew = validateWeightages(sheet(100));
    const tooMany = validateWeightages(sheet(...Array.from({ length: 9 }, () => 100 / 9)));

    expect(tooFew.issues[0]?.message).toContain(String(MIN_GOALS_PER_SHEET));
    expect(tooMany.issues[0]?.message).toContain(String(MAX_GOALS_PER_SHEET));
  });
});

describe('validateWeightages · per-goal minimum', () => {
  it('rejects a goal below the minimum', () => {
    const result = validateWeightages(sheet(85, 10, 5));

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('WEIGHTAGE_BELOW_MINIMUM');
  });

  it('accepts a goal exactly at the minimum', () => {
    const result = validateWeightages(sheet(80, 10, 10));

    expect(result.valid).toBe(true);
  });

  it('identifies the offending goal by id and index', () => {
    const issue = validateWeightages(sheet(85, 10, 5)).issues[0];

    expect(issue?.goalId).toBe('goal-3');
    expect(issue?.goalIndex).toBe(2);
  });

  it('quotes the title when there is no id', () => {
    const goals: WeightableGoal[] = [
      { title: 'Reduce onboarding time', weightage: 5 },
      { title: 'Grow ARR', weightage: 90 },
      { title: 'Ship the audit log', weightage: 5 },
    ];
    const messages = validateWeightages(goals).issues.map((issue) => issue.message);

    expect(messages[0]).toContain('"Reduce onboarding time"');
    expect(messages[0]).toContain(String(MIN_GOAL_WEIGHTAGE));
  });

  it('falls back to a human-counted position when a draft goal has neither', () => {
    const goals: WeightableGoal[] = [
      { weightage: 90 },
      { weightage: 5 },
      { weightage: 5 },
    ];
    const messages = validateWeightages(goals).issues.map((issue) => issue.message);

    expect(messages[0]).toContain('goal 2');
    expect(messages[1]).toContain('goal 3');
  });

  it('ignores an empty id or title rather than naming a goal ""', () => {
    const goals: WeightableGoal[] = [
      { id: '', title: '', weightage: 5 },
      { weightage: 90 },
      { weightage: 5 },
    ];

    expect(validateWeightages(goals).issues[0]?.message).toContain('goal 1');
  });
});

describe('validateWeightages · unreadable weightages', () => {
  it('reports a missing weightage', () => {
    const result = validateWeightages(sheet(50, 50, null));

    expect(result.issues.map((issue) => issue.code)).toEqual(['WEIGHTAGE_MISSING']);
  });

  it('treats a blank string as missing, not as a zero', () => {
    const result = validateWeightages(sheet(50, 50, '   '));

    expect(result.issues.map((issue) => issue.code)).toEqual(['WEIGHTAGE_MISSING']);
  });

  it('reports a non-numeric weightage', () => {
    const result = validateWeightages(sheet(50, 50, 'ten percent'));

    expect(result.issues.map((issue) => issue.code)).toEqual(['WEIGHTAGE_INVALID']);
    expect(result.issues[0]?.message).toContain('ten percent');
  });

  it('excludes an unreadable weightage from the total instead of counting it as zero', () => {
    // 50 + 50 already totals 100, so the only complaint should be the bad value
    // itself — not a second, confusing "your sheet does not add up".
    const result = validateWeightages(sheet(50, 50, 'ten percent'));

    expect(result.total).toBe(100);
    expect(result.issues).toHaveLength(1);
  });

  it('rejects a non-finite weightage', () => {
    const result = validateWeightages(sheet(50, 50, Number.POSITIVE_INFINITY));

    expect(result.issues.map((issue) => issue.code)).toEqual(['WEIGHTAGE_INVALID']);
  });
});

describe('validateWeightages · reports every problem at once', () => {
  it('does not stop at the first failure', () => {
    const result = validateWeightages(sheet(5, 5));

    expect(result.issues.map((issue) => issue.code)).toEqual([
      'TOO_FEW_GOALS',
      'WEIGHTAGE_BELOW_MINIMUM',
      'WEIGHTAGE_BELOW_MINIMUM',
      'TOTAL_MISMATCH',
    ]);
  });
});

describe('remainingWeightage', () => {
  it('reports what is left to allocate', () => {
    expect(remainingWeightage(sheet(30, 30))).toBe(40);
  });

  it('reports zero on a complete sheet', () => {
    expect(remainingWeightage(sheet(34, 33, 33))).toBe(0);
  });

  it('goes negative when over-allocated, rather than clamping', () => {
    expect(remainingWeightage(sheet(60, 60))).toBe(-20);
  });

  it('settles float residue so the hint reads 0 and not 1.4e-14', () => {
    expect(remainingWeightage(sheet(10, 58.01, 31.99))).toBe(0);
  });

  it('skips weightages it cannot read', () => {
    expect(remainingWeightage(sheet(30, null, 'ten'))).toBe(70);
  });

  it('is the whole allowance for an empty sheet', () => {
    expect(remainingWeightage([])).toBe(WEIGHTAGE_TOTAL);
  });
});

describe('the thresholds are exported so no call site can invent its own', () => {
  it('holds the values the PRD specifies', () => {
    expect(WEIGHTAGE_TOTAL).toBe(100);
    expect(WEIGHTAGE_TOTAL_TOLERANCE).toBe(0.01);
    expect(MIN_GOAL_WEIGHTAGE).toBe(10);
    expect(MIN_GOALS_PER_SHEET).toBe(3);
    expect(MAX_GOALS_PER_SHEET).toBe(8);
  });

  it('leaves the minimum satisfiable at the maximum goal count', () => {
    // 8 goals x 10% is 80, so a full sheet is always reachable. If someone
    // raises MIN_GOAL_WEIGHTAGE past 12.5 this fails, which is the point.
    expect(MAX_GOALS_PER_SHEET * MIN_GOAL_WEIGHTAGE).toBeLessThanOrEqual(WEIGHTAGE_TOTAL);
  });
});

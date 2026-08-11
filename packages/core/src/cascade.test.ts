import { describe, expect, it } from 'vitest';

import {
  CASCADE_SKIP_REASONS,
  InvalidCascadeError,
  planCascade,
  type CascadableGoal,
  type CascadeRecipient,
  type RecipientGoal,
} from './cascade.js';
import { MAX_GOALS_PER_SHEET } from './weightage.js';

const GOAL: CascadableGoal = { id: 'shared-1', ownerUserId: 'marcus', weightage: 20 };

/** A recipient whose sheet holds goals of the given weightages. */
function recipient(userId: string, ...weightages: readonly (string | number | null)[]) {
  return {
    userId,
    goals: weightages.map((weightage): RecipientGoal => ({ sharedGoalId: null, weightage })),
  } satisfies CascadeRecipient;
}

/** A recipient who already holds the goal being cascaded. */
function holder(userId: string): CascadeRecipient {
  return {
    userId,
    goals: [
      { sharedGoalId: GOAL.id, weightage: 20 },
      { sharedGoalId: null, weightage: 30 },
    ],
  };
}

describe('planCascade · the happy path', () => {
  it('plans delivery to everyone with room', () => {
    const plan = planCascade(GOAL, [recipient('priya', 30, 30), recipient('sam', 40)]);

    expect(plan.willReceive).toEqual(['priya', 'sam']);
    expect(plan.skipped).toEqual([]);
  });

  it('reports the goal and weightage it planned for', () => {
    const plan = planCascade(GOAL, [recipient('priya', 30)]);

    expect(plan.sharedGoalId).toBe('shared-1');
    expect(plan.weightage).toBe(20);
  });

  it('plans nothing for an empty audience', () => {
    const plan = planCascade(GOAL, []);

    expect(plan).toEqual({
      sharedGoalId: 'shared-1',
      weightage: 20,
      willReceive: [],
      skipped: [],
    });
  });

  it('accepts a recipient with an empty sheet', () => {
    expect(planCascade(GOAL, [recipient('priya')]).willReceive).toEqual(['priya']);
  });

  it('preserves the order it was given', () => {
    const ids = ['e', 'd', 'c', 'b', 'a'];
    const plan = planCascade(
      GOAL,
      ids.map((id) => recipient(id, 10)),
    );

    expect(plan.willReceive).toEqual(ids);
  });
});

describe('planCascade · the weightage boundary', () => {
  it('accepts a sheet that lands exactly on 100', () => {
    // 80 assigned + a 20-point goal.
    const plan = planCascade(GOAL, [recipient('priya', 40, 40)]);

    expect(plan.willReceive).toEqual(['priya']);
  });

  it('refuses a sheet that would land one point over', () => {
    const plan = planCascade(GOAL, [recipient('priya', 41, 40)]);

    expect(plan.willReceive).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('WOULD_EXCEED_WEIGHTAGE');
  });

  it('allows the same hundredth of tolerance that validation allows', () => {
    // 80.01 + 20 is 100.01, which validateWeightages accepts. A planner that
    // refused it would produce sheets the validator considers fine, and the
    // two would disagree about the same number.
    expect(planCascade(GOAL, [recipient('priya', 80.01)]).willReceive).toEqual(['priya']);
  });

  it('refuses one hundredth beyond the tolerance', () => {
    expect(planCascade(GOAL, [recipient('priya', 80.02)]).willReceive).toEqual([]);
  });

  it('is not fooled by float residue in the recipient’s existing goals', () => {
    // 10 + 58.01 + 11.99 sums with residue; the projected total is exactly 100.
    expect(planCascade(GOAL, [recipient('priya', 10, 58.01, 11.99)]).willReceive).toEqual(['priya']);
  });

  it('says how far over the sheet would go', () => {
    const plan = planCascade(GOAL, [recipient('priya', 95)]);

    expect(plan.skipped[0]?.detail).toContain('115');
  });

  it('treats a full sheet as having no room at all', () => {
    expect(planCascade(GOAL, [recipient('priya', 100)]).skipped[0]?.reason).toBe(
      'WOULD_EXCEED_WEIGHTAGE',
    );
  });
});

describe('planCascade · the goal limit', () => {
  const full = (userId: string): CascadeRecipient =>
    recipient(userId, ...Array.from({ length: MAX_GOALS_PER_SHEET }, () => 1));

  it('refuses a recipient already at the limit', () => {
    const plan = planCascade(GOAL, [full('priya')]);

    expect(plan.willReceive).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('WOULD_EXCEED_GOAL_LIMIT');
  });

  it('accepts a recipient one below the limit', () => {
    const nearlyFull = recipient(
      'priya',
      ...Array.from({ length: MAX_GOALS_PER_SHEET - 1 }, () => 1),
    );

    expect(planCascade(GOAL, [nearlyFull]).willReceive).toEqual(['priya']);
  });

  it('checks the count before the weightage, because it is the harder limit', () => {
    // Eight goals worth 1 point each: plenty of weightage headroom, no room
    // for another goal. Reporting the headroom would be misleading.
    expect(planCascade(GOAL, [full('priya')]).skipped[0]?.reason).toBe('WOULD_EXCEED_GOAL_LIMIT');
  });

  it('names the limit rather than hardcoding a number in the message', () => {
    expect(planCascade(GOAL, [full('priya')]).skipped[0]?.detail).toContain(
      String(MAX_GOALS_PER_SHEET),
    );
  });
});

describe('planCascade · people who should not receive it', () => {
  it('skips the owner, who holds the primary instance', () => {
    const plan = planCascade(GOAL, [recipient('marcus', 10), recipient('priya', 10)]);

    expect(plan.willReceive).toEqual(['priya']);
    expect(plan.skipped).toEqual([
      {
        userId: 'marcus',
        reason: 'IS_OWNER',
        detail: 'Owns this goal already, and holds the primary instance.',
      },
    ]);
  });

  it('skips someone who already has this goal', () => {
    const plan = planCascade(GOAL, [holder('priya')]);

    expect(plan.skipped[0]?.reason).toBe('ALREADY_HAS_GOAL');
  });

  it('does not confuse a different cascaded goal with this one', () => {
    const other: CascadeRecipient = {
      userId: 'priya',
      goals: [{ sharedGoalId: 'shared-other', weightage: 30 }],
    };

    expect(planCascade(GOAL, [other]).willReceive).toEqual(['priya']);
  });

  it('skips a repeated recipient rather than planning two copies', () => {
    const plan = planCascade(GOAL, [recipient('priya', 10), recipient('priya', 10)]);

    expect(plan.willReceive).toEqual(['priya']);
    expect(plan.skipped[0]).toMatchObject({ userId: 'priya', reason: 'DUPLICATE_RECIPIENT' });
  });

  it('skips a recipient whose sheet has an unreadable weightage', () => {
    const plan = planCascade(GOAL, [recipient('priya', 30, 'about a third')]);

    expect(plan.willReceive).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ reason: 'INVALID_WEIGHTAGE' });
    expect(plan.skipped[0]?.detail).toContain('Goal 2');
  });

  it('treats a missing weightage as unreadable rather than as zero', () => {
    // Counting it as zero would silently overstate the headroom and produce
    // an over-100 sheet.
    expect(planCascade(GOAL, [recipient('priya', 30, null)]).skipped[0]?.reason).toBe(
      'INVALID_WEIGHTAGE',
    );
  });
});

describe('planCascade · F-05 regression: ownership is an id, never a name', () => {
  it('does not skip a namesake of the owner', () => {
    // The prototype compared display-name strings. Two people called the same
    // thing shared an identity, and a rename broke the link. Nothing here can
    // see a name: the types do not carry one.
    const plan = planCascade(GOAL, [recipient('marcus-2', 10)]);

    expect(plan.willReceive).toEqual(['marcus-2']);
  });

  it('skips the owner by exact id match only', () => {
    expect(planCascade(GOAL, [recipient('marcus', 10)]).skipped[0]?.reason).toBe('IS_OWNER');
    expect(planCascade(GOAL, [recipient('Marcus', 10)]).willReceive).toEqual(['Marcus']);
  });
});

describe('planCascade · the shared goal itself', () => {
  it.each([null, '', 'a fifth', Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses to plan with a weightage of %o',
    (weightage) => {
      expect(() => planCascade({ ...GOAL, weightage }, [recipient('priya', 10)])).toThrow(
        InvalidCascadeError,
      );
    },
  );

  it.each([0, -5])('refuses a weightage of %i, which would carry no weight', (weightage) => {
    expect(() => planCascade({ ...GOAL, weightage }, [recipient('priya', 10)])).toThrow(
      InvalidCascadeError,
    );
  });

  it('fails before considering anyone, rather than partway through', () => {
    let caught: unknown;
    try {
      planCascade({ ...GOAL, weightage: 'a fifth' }, [recipient('priya', 10)]);
    } catch (error) {
      caught = error;
    }

    expect((caught as InvalidCascadeError).field).toBe('weightage');
  });
});

describe('planCascade · it plans, it does not act', () => {
  it('does not mutate the recipients it was given', () => {
    const recipients = [recipient('priya', 30), holder('sam'), recipient('marcus', 10)];
    const snapshot = JSON.stringify(recipients);

    planCascade(GOAL, recipients);

    expect(JSON.stringify(recipients)).toBe(snapshot);
  });

  it('accounts for every recipient exactly once, in one list or the other', () => {
    const recipients = [
      recipient('priya', 30),
      recipient('marcus', 10),
      holder('dana'),
      recipient('ravi', 100),
    ];
    const plan = planCascade(GOAL, recipients);

    expect(plan.willReceive.length + plan.skipped.length).toBe(recipients.length);
    expect([...plan.willReceive, ...plan.skipped.map((entry) => entry.userId)].sort()).toEqual(
      recipients.map((entry) => entry.userId).sort(),
    );
  });

  it('gives every refusal a reason drawn from the declared set', () => {
    const plan = planCascade(GOAL, [
      recipient('marcus', 10),
      holder('dana'),
      recipient('ravi', 100),
      recipient('ravi', 100),
      recipient('sam', 'unknown'),
    ]);

    expect(plan.skipped).toHaveLength(5);
    for (const entry of plan.skipped) {
      expect(CASCADE_SKIP_REASONS).toContain(entry.reason);
      expect(entry.detail.length).toBeGreaterThan(0);
    }
  });
});

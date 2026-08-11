import { describe, expect, it } from 'vitest';

import { GoalDirection, Role, Uom } from '@aura/db';

/**
 * Proves the generated Prisma client is importable and type-checks from a
 * package other than @aura/db — the cross-package half of W1-01's Done-when.
 *
 * These assertions are not busywork. GoalDirection existing as a real enum is
 * what makes PLAN.md F-06 unrepresentable: the prototype decided scoring
 * direction by substring-matching the goal's title, so "Reduce customer wait
 * time" scored inversely by accident. There is nowhere to put that inference
 * once direction is a column.
 */
describe('@aura/db generated client', () => {
  it('exposes shared enums across package boundaries', () => {
    expect(Role.HR_ADMIN).toBe('HR_ADMIN');
    expect(Uom.ZERO_BASED).toBe('ZERO_BASED');
  });

  it('models scoring direction explicitly rather than inferring it', () => {
    expect(Object.values(GoalDirection)).toStrictEqual([
      'HIGHER_IS_BETTER',
      'LOWER_IS_BETTER',
    ]);
  });
});

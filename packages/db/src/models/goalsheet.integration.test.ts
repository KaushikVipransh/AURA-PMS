import { afterAll, describe, expect, it } from 'vitest';

import { closeTestDb, withTestDb, type TestDb } from '../testing/index.js';

let seq = 0;
const uniq = (prefix: string): string => `${prefix}-${Date.now()}-${++seq}`;

/** An org with one employee and one cycle — the minimum a sheet needs. */
async function scaffold(tx: TestDb) {
  const org = await tx.organization.create({
    data: { name: 'Acme', slug: uniq('acme') },
  });
  const user = await tx.user.create({
    data: { orgId: org.id, email: uniq('e') + '@x.com', name: 'Employee' },
  });
  const cycle = await tx.reviewCycle.create({
    data: { orgId: org.id, name: uniq('FY26'), fiscalYear: 2026 },
  });
  return { org, user, cycle };
}

const baseGoal = {
  thrustArea: 'OPERATIONAL_EXCELLENCE',
  title: 'Improve uptime',
  uom: 'PERCENT',
  direction: 'HIGHER_IS_BETTER',
  target: '99.95',
  weightage: 50,
} as const;

afterAll(async () => {
  await closeTestDb();
});

describe('GoalSheet [W1-06]', () => {
  it('rejects a second sheet for the same user and cycle', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);

      await tx.goalSheet.create({
        data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
      });

      // The prototype had no cycle concept, so a person had one sheet forever,
      // mutated in place (PLAN.md F-03). This constraint is what makes that
      // structurally impossible.
      await expect(
        tx.goalSheet.create({
          data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
        }),
      ).rejects.toThrow();
    });
  });

  it('lets one user hold a sheet in each of two cycles', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const older = await tx.reviewCycle.create({
        data: { orgId: org.id, name: uniq('FY25'), fiscalYear: 2025, status: 'CLOSED' },
      });

      await tx.goalSheet.create({
        data: { orgId: org.id, userId: user.id, cycleId: older.id, status: 'APPROVED' },
      });
      await tx.goalSheet.create({
        data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
      });

      const sheets = await tx.goalSheet.findMany({ where: { userId: user.id } });
      expect(sheets).toHaveLength(2);
    });
  });

  it('starts as an unlocked DRAFT', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const sheet = await tx.goalSheet.create({
        data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
      });

      expect(sheet.status).toBe('DRAFT');
      expect(sheet.lockedAt).toBeNull();
      expect(sheet.approvedAt).toBeNull();
      expect(sheet.revision).toBe(0);
    });
  });

  it('records who approved it', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const manager = await tx.user.create({
        data: { orgId: org.id, email: uniq('m') + '@x.com', name: 'Manager' },
      });

      const sheet = await tx.goalSheet.create({
        data: {
          orgId: org.id,
          userId: user.id,
          cycleId: cycle.id,
          status: 'APPROVED',
          approverId: manager.id,
          approvedAt: new Date(),
          lockedAt: new Date(),
        },
        include: { approver: true },
      });

      // The prototype recorded no approver at all — there was no user to
      // record (PLAN.md F-09).
      expect(sheet.approver?.name).toBe('Manager');
    });
  });
});

describe('Goal [W1-07]', () => {
  it('requires an explicit scoring direction', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const sheet = await tx.goalSheet.create({
        data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
      });

      const goal = await tx.goal.create({
        data: { ...baseGoal, sheetId: sheet.id, direction: 'LOWER_IS_BETTER' },
      });

      expect(goal.direction).toBe('LOWER_IS_BETTER');

      // Prisma's generated types make direction a required field, so omitting
      // it will not compile. Asserting the column has no database-level
      // default guards the other half: nothing can silently pick a direction
      // for the caller, which is what the title-substring inference did
      // (PLAN.md F-06).
      const [column] = await tx.$queryRaw<{ column_default: string | null }[]>`
        SELECT column_default FROM information_schema.columns
        WHERE table_name = 'goals' AND column_name = 'direction'
      `;
      expect(column?.column_default).toBeNull();
    });
  });

  it('keeps weightage exact rather than floating', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const sheet = await tx.goalSheet.create({
        data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
      });

      const goal = await tx.goal.create({
        data: { ...baseGoal, sheetId: sheet.id, weightage: 33.33 },
      });

      // Decimal(5,2), not Float. Float drift is why the prototype had
      // Math.round(t) !== 100 in one route and a strict !== 100 in another
      // (PLAN.md F-10).
      expect(goal.weightage.toString()).toBe('33.33');
    });
  });

  it('deletes goals when the sheet goes', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const sheet = await tx.goalSheet.create({
        data: {
          orgId: org.id,
          userId: user.id,
          cycleId: cycle.id,
          goals: { create: [baseGoal] },
        },
      });

      await tx.goalSheet.delete({ where: { id: sheet.id } });

      expect(await tx.goal.count({ where: { sheetId: sheet.id } })).toBe(0);
    });
  });
});

describe('SharedGoal [W1-08]', () => {
  it('refuses an owner that is not a real user', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);

      // The prototype matched the primary owner by lowercased display name
      // (PLAN.md F-05). A display name cannot be stored in a userId column.
      await expect(
        tx.sharedGoal.create({
          data: {
            orgId: org.id,
            cycleId: cycle.id,
            ownerUserId: 'Vipransh Kaushik',
            createdById: user.id,
            title: 'Security posture',
            thrustArea: 'COMPLIANCE_AND_RISK',
            uom: 'NUMERIC',
            direction: 'HIGHER_IS_BETTER',
            target: '100',
            defaultWeightage: 15,
          },
        }),
      ).rejects.toThrow();
    });
  });

  it('links cascaded instances back to their template', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const sheet = await tx.goalSheet.create({
        data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
      });

      const shared = await tx.sharedGoal.create({
        data: {
          orgId: org.id,
          cycleId: cycle.id,
          ownerUserId: user.id,
          createdById: user.id,
          title: 'Security posture',
          thrustArea: 'COMPLIANCE_AND_RISK',
          uom: 'NUMERIC',
          direction: 'HIGHER_IS_BETTER',
          target: '100',
          defaultWeightage: 15,
        },
      });

      await tx.goal.create({
        data: {
          ...baseGoal,
          sheetId: sheet.id,
          sharedGoalId: shared.id,
          isPrimaryOwner: true,
        },
      });

      const loaded = await tx.sharedGoal.findUniqueOrThrow({
        where: { id: shared.id },
        include: { instances: true, owner: true },
      });

      expect(loaded.instances).toHaveLength(1);
      expect(loaded.owner.id).toBe(user.id);
    });
  });

  it('lands on any one sheet at most once', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const sheet = await tx.goalSheet.create({
        data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
      });
      const shared = await tx.sharedGoal.create({
        data: {
          orgId: org.id,
          cycleId: cycle.id,
          ownerUserId: user.id,
          createdById: user.id,
          title: 'Security posture',
          thrustArea: 'COMPLIANCE_AND_RISK',
          uom: 'NUMERIC',
          direction: 'HIGHER_IS_BETTER',
          target: '100',
          defaultWeightage: 15,
        },
      });

      await tx.goal.create({
        data: { ...baseGoal, sheetId: sheet.id, sharedGoalId: shared.id },
      });

      // Re-broadcasting the same KPI must not duplicate it on a sheet.
      await expect(
        tx.goal.create({
          data: { ...baseGoal, sheetId: sheet.id, sharedGoalId: shared.id },
        }),
      ).rejects.toThrow();
    });
  });

  it('will not let an owner be deleted out from under a live KPI', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const owner = await tx.user.create({
        data: { orgId: org.id, email: uniq('o') + '@x.com', name: 'Owner' },
      });

      await tx.sharedGoal.create({
        data: {
          orgId: org.id,
          cycleId: cycle.id,
          ownerUserId: owner.id,
          createdById: user.id,
          title: 'Security posture',
          thrustArea: 'COMPLIANCE_AND_RISK',
          uom: 'NUMERIC',
          direction: 'HIGHER_IS_BETTER',
          target: '100',
          defaultWeightage: 15,
        },
      });

      // onDelete: Restrict. Deactivate people instead (PRD US-106).
      await expect(tx.user.delete({ where: { id: owner.id } })).rejects.toThrow();
    });
  });
});

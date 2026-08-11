import { afterAll, describe, expect, it } from 'vitest';

import { closeTestDb, withTestDb, type TestDb } from '../testing/index.js';

let seq = 0;
const uniq = (prefix: string): string => `${prefix}-${Date.now()}-${++seq}`;

async function makeOrg(tx: TestDb) {
  return tx.organization.create({ data: { name: 'Acme', slug: uniq('acme') } });
}

const JAN = new Date('2026-01-01T00:00:00Z');
const MAR = new Date('2026-03-31T23:59:59Z');
const APR = new Date('2026-04-01T00:00:00Z');
const JUN = new Date('2026-06-30T23:59:59Z');

afterAll(async () => {
  await closeTestDb();
});

describe('ReviewCycle [W1-05]', () => {
  it('allows two cycles to coexist, so closing one keeps its history', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);

      const closed = await tx.reviewCycle.create({
        data: { orgId: org.id, name: uniq('FY25'), fiscalYear: 2025, status: 'CLOSED' },
      });
      const active = await tx.reviewCycle.create({
        data: { orgId: org.id, name: uniq('FY26'), fiscalYear: 2026, status: 'ACTIVE' },
      });

      const all = await tx.reviewCycle.findMany({ where: { orgId: org.id } });

      // The prototype's period switch ran updateMany({}, {$set:{quarter}}) and
      // overwrote every historical sheet (PLAN.md F-03). Cycles being rows
      // means last year stays exactly as it was.
      expect(all).toHaveLength(2);
      expect(all.map((c) => c.id).sort()).toStrictEqual([closed.id, active.id].sort());
    });
  });

  it('rejects a second ACTIVE cycle in the same organization', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);

      await tx.reviewCycle.create({
        data: { orgId: org.id, name: uniq('first'), fiscalYear: 2026, status: 'ACTIVE' },
      });

      // Partial unique index, enforced by Postgres — no service can open a
      // second active cycle by accident.
      await expect(
        tx.reviewCycle.create({
          data: { orgId: org.id, name: uniq('second'), fiscalYear: 2026, status: 'ACTIVE' },
        }),
      ).rejects.toThrow();
    });
  });

  it('allows many DRAFT and CLOSED cycles alongside the active one', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);

      await tx.reviewCycle.create({
        data: { orgId: org.id, name: uniq('a'), fiscalYear: 2026, status: 'ACTIVE' },
      });

      await expect(
        tx.reviewCycle.createMany({
          data: [
            { orgId: org.id, name: uniq('d1'), fiscalYear: 2027, status: 'DRAFT' },
            { orgId: org.id, name: uniq('d2'), fiscalYear: 2028, status: 'DRAFT' },
            { orgId: org.id, name: uniq('c1'), fiscalYear: 2024, status: 'CLOSED' },
          ],
        }),
      ).resolves.toBeDefined();
    });
  });

  it('lets two organizations each hold an active cycle', async () => {
    await withTestDb(async (tx) => {
      const orgA = await makeOrg(tx);
      const orgB = await makeOrg(tx);

      await tx.reviewCycle.create({
        data: { orgId: orgA.id, name: uniq('a'), fiscalYear: 2026, status: 'ACTIVE' },
      });

      // The index is scoped per organization, not globally.
      await expect(
        tx.reviewCycle.create({
          data: { orgId: orgB.id, name: uniq('b'), fiscalYear: 2026, status: 'ACTIVE' },
        }),
      ).resolves.toBeDefined();
    });
  });

  it('defaults to DRAFT so a cycle is never live by accident', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);
      const cycle = await tx.reviewCycle.create({
        data: { orgId: org.id, name: uniq('new'), fiscalYear: 2026 },
      });

      expect(cycle.status).toBe('DRAFT');
    });
  });
});

describe('CyclePhase [W1-05]', () => {
  it('stores dated windows that deadlines can derive from', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);
      const cycle = await tx.reviewCycle.create({
        data: {
          orgId: org.id,
          name: uniq('FY26'),
          fiscalYear: 2026,
          phases: {
            create: [
              { key: 'GOAL_SETTING', label: 'Goal Setting', startsAt: JAN, endsAt: MAR },
              { key: 'CHECK_IN', label: 'Q1 Check-in', startsAt: APR, endsAt: JUN },
            ],
          },
        },
        include: { phases: true },
      });

      expect(cycle.phases).toHaveLength(2);

      // Real dates are what let the escalation engine report true overdue
      // days. The prototype floored every result at 4 with
      // Math.max(elapsed, 4), so a sheet saved seconds ago read "4 days
      // overdue" (PLAN.md F-08).
      const goalSetting = cycle.phases.find((p) => p.key === 'GOAL_SETTING');
      expect(goalSetting?.endsAt.toISOString()).toBe(MAR.toISOString());
    });
  });

  it('rejects a duplicate phase kind within one cycle', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);
      const cycle = await tx.reviewCycle.create({
        data: { orgId: org.id, name: uniq('FY26'), fiscalYear: 2026 },
      });

      await tx.cyclePhase.create({
        data: { cycleId: cycle.id, key: 'APPRAISAL', label: 'One', startsAt: JAN, endsAt: MAR },
      });

      await expect(
        tx.cyclePhase.create({
          data: { cycleId: cycle.id, key: 'APPRAISAL', label: 'Two', startsAt: APR, endsAt: JUN },
        }),
      ).rejects.toThrow();
    });
  });

  it('removes phases when the cycle is deleted', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);
      const cycle = await tx.reviewCycle.create({
        data: {
          orgId: org.id,
          name: uniq('temp'),
          fiscalYear: 2026,
          phases: {
            create: [{ key: 'RESULTS', label: 'Results', startsAt: JAN, endsAt: MAR }],
          },
        },
      });

      await tx.reviewCycle.delete({ where: { id: cycle.id } });

      expect(await tx.cyclePhase.count({ where: { cycleId: cycle.id } })).toBe(0);
    });
  });
});

import { afterAll, describe, expect, it } from 'vitest';

import { closeTestDb, withTestDb, type TestDb } from '../testing/index.js';

let seq = 0;
const uniq = (prefix: string): string => `${prefix}-${Date.now()}-${++seq}`;

async function scaffold(tx: TestDb) {
  const org = await tx.organization.create({
    data: { name: 'Acme', slug: uniq('acme') },
  });
  const user = await tx.user.create({
    data: { orgId: org.id, email: uniq('e') + '@x.com', name: 'Employee' },
  });
  const manager = await tx.user.create({
    data: { orgId: org.id, email: uniq('m') + '@x.com', name: 'Manager' },
  });
  const cycle = await tx.reviewCycle.create({
    data: { orgId: org.id, name: uniq('FY26'), fiscalYear: 2026 },
  });
  const sheet = await tx.goalSheet.create({
    data: { orgId: org.id, userId: user.id, cycleId: cycle.id },
  });
  return { org, user, manager, cycle, sheet };
}

afterAll(async () => {
  await closeTestDb();
});

describe('SheetRevision [W1-09]', () => {
  it('keeps an immutable snapshot of what was agreed', async () => {
    await withTestDb(async (tx) => {
      const { user, sheet } = await scaffold(tx);

      const snapshot = {
        goals: [{ title: 'Improve uptime', weightage: '100.00', target: '99.95' }],
      };

      await tx.sheetRevision.create({
        data: { sheetId: sheet.id, revision: 1, reason: 'SUBMIT', actorId: user.id, snapshot },
      });

      const loaded = await tx.sheetRevision.findFirstOrThrow({
        where: { sheetId: sheet.id, revision: 1 },
      });

      // The prototype overwrote goals in place, so after any edit "what did we
      // agree to" was unanswerable — the question a disputed rating turns on
      // (PLAN.md F-09).
      expect(loaded.snapshot).toStrictEqual(snapshot);
      expect(loaded.reason).toBe('SUBMIT');
    });
  });

  it('refuses to overwrite an existing revision number', async () => {
    await withTestDb(async (tx) => {
      const { user, sheet } = await scaffold(tx);

      await tx.sheetRevision.create({
        data: { sheetId: sheet.id, revision: 1, reason: 'SUBMIT', actorId: user.id, snapshot: {} },
      });

      // Append-only by construction: a silent overwrite fails rather than
      // passing.
      await expect(
        tx.sheetRevision.create({
          data: {
            sheetId: sheet.id,
            revision: 1,
            reason: 'APPROVE',
            actorId: user.id,
            snapshot: {},
          },
        }),
      ).rejects.toThrow();
    });
  });

  it('records a distinct actor per revision', async () => {
    await withTestDb(async (tx) => {
      const { user, manager, sheet } = await scaffold(tx);

      await tx.sheetRevision.createMany({
        data: [
          { sheetId: sheet.id, revision: 1, reason: 'SUBMIT', actorId: user.id, snapshot: {} },
          { sheetId: sheet.id, revision: 2, reason: 'APPROVE', actorId: manager.id, snapshot: {} },
        ],
      });

      const revisions = await tx.sheetRevision.findMany({
        where: { sheetId: sheet.id },
        orderBy: { revision: 'asc' },
        include: { actor: true },
      });

      expect(revisions.map((r) => r.actor.name)).toStrictEqual(['Employee', 'Manager']);
    });
  });

  it('will not let a revision author be deleted', async () => {
    await withTestDb(async (tx) => {
      const { user, sheet } = await scaffold(tx);

      await tx.sheetRevision.create({
        data: { sheetId: sheet.id, revision: 1, reason: 'SUBMIT', actorId: user.id, snapshot: {} },
      });

      // onDelete: Restrict — an audit trail that loses its actor is not one.
      await expect(tx.user.delete({ where: { id: user.id } })).rejects.toThrow();
    });
  });
});

describe('Appraisal [W1-10]', () => {
  it('carries the full lifecycle from self-assessment to acknowledgement', async () => {
    await withTestDb(async (tx) => {
      const { manager, sheet } = await scaffold(tx);

      const appraisal = await tx.appraisal.create({
        data: {
          sheetId: sheet.id,
          selfRating: 4,
          selfNarrative: 'Hit the uptime target every quarter.',
          selfSubmittedAt: new Date('2026-03-01'),
        },
      });

      await tx.appraisal.update({
        where: { id: appraisal.id },
        data: {
          managerId: manager.id,
          managerRating: 3,
          managerNarrative: 'Strong delivery; scope was narrower than planned.',
          managerSubmittedAt: new Date('2026-03-10'),
        },
      });

      const calibrated = await tx.appraisal.update({
        where: { id: appraisal.id },
        data: {
          finalRating: 4,
          calibratedById: manager.id,
          calibrationReason: 'Aligned with peers carrying comparable scope.',
          releasedAt: new Date('2026-03-20'),
          acknowledgedAt: new Date('2026-03-21'),
        },
      });

      // Every stage keeps its own value. The manager's 3 is still readable
      // after calibration moved the final to 4 (PRD US-802).
      expect(calibrated.selfRating).toBe(4);
      expect(calibrated.managerRating).toBe(3);
      expect(calibrated.finalRating).toBe(4);
      expect(calibrated.calibrationReason).toContain('peers');
    });
  });

  it('allows at most one appraisal per sheet', async () => {
    await withTestDb(async (tx) => {
      const { sheet } = await scaffold(tx);

      await tx.appraisal.create({ data: { sheetId: sheet.id } });

      await expect(tx.appraisal.create({ data: { sheetId: sheet.id } })).rejects.toThrow();
    });
  });

  it('starts entirely empty, so nothing is rated by default', async () => {
    await withTestDb(async (tx) => {
      const { sheet } = await scaffold(tx);
      const appraisal = await tx.appraisal.create({ data: { sheetId: sheet.id } });

      expect(appraisal.selfRating).toBeNull();
      expect(appraisal.managerRating).toBeNull();
      expect(appraisal.finalRating).toBeNull();
      expect(appraisal.releasedAt).toBeNull();
      expect(appraisal.disputedAt).toBeNull();
    });
  });

  it('explains a final score goal by goal', async () => {
    await withTestDb(async (tx) => {
      const { sheet } = await scaffold(tx);

      const goal = await tx.goal.create({
        data: {
          sheetId: sheet.id,
          thrustArea: 'OPERATIONAL_EXCELLENCE',
          title: 'Improve uptime',
          uom: 'PERCENT',
          direction: 'HIGHER_IS_BETTER',
          target: '99.95',
          weightage: 100,
        },
      });

      const appraisal = await tx.appraisal.create({
        data: {
          sheetId: sheet.id,
          goalRatings: {
            create: [{ goalId: goal.id, rating: 4, narrative: 'Exceeded target.' }],
          },
        },
        include: { goalRatings: { include: { goal: true } } },
      });

      expect(appraisal.goalRatings).toHaveLength(1);
      expect(appraisal.goalRatings[0]?.goal.title).toBe('Improve uptime');
    });
  });

  it('rates any one goal at most once per appraisal', async () => {
    await withTestDb(async (tx) => {
      const { sheet } = await scaffold(tx);
      const goal = await tx.goal.create({
        data: {
          sheetId: sheet.id,
          thrustArea: 'BUSINESS_GROWTH',
          title: 'Grow revenue',
          uom: 'NUMERIC',
          direction: 'HIGHER_IS_BETTER',
          target: '1000',
          weightage: 100,
        },
      });
      const appraisal = await tx.appraisal.create({ data: { sheetId: sheet.id } });

      await tx.goalRating.create({ data: { appraisalId: appraisal.id, goalId: goal.id, rating: 3 } });

      await expect(
        tx.goalRating.create({ data: { appraisalId: appraisal.id, goalId: goal.id, rating: 5 } }),
      ).rejects.toThrow();
    });
  });

  it('goes with the sheet when the sheet goes', async () => {
    await withTestDb(async (tx) => {
      const { sheet } = await scaffold(tx);
      await tx.appraisal.create({ data: { sheetId: sheet.id } });

      await tx.goalSheet.delete({ where: { id: sheet.id } });

      expect(await tx.appraisal.count({ where: { sheetId: sheet.id } })).toBe(0);
    });
  });
});

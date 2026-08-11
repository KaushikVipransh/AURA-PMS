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
  const cycle = await tx.reviewCycle.create({
    data: { orgId: org.id, name: uniq('FY26'), fiscalYear: 2026 },
  });
  return { org, user, cycle };
}

const DUE = new Date('2026-03-31T23:59:59Z');

afterAll(async () => {
  await closeTestDb();
});

describe('AuditEvent [W1-11]', () => {
  it('records actor, entity, and a before/after diff', async () => {
    await withTestDb(async (tx) => {
      const { org, user } = await scaffold(tx);

      const event = await tx.auditEvent.create({
        data: {
          orgId: org.id,
          actorId: user.id,
          action: 'goalsheet.approve',
          entityType: 'GoalSheet',
          entityId: 'sheet-1',
          before: { status: 'PENDING' },
          after: { status: 'APPROVED' },
          ip: '203.0.113.7',
        },
        include: { actor: true },
      });

      // The prototype logged one action out of a dozen and attributed it to
      // the literal string "System Compliance Board", because there was no
      // actor to record (PLAN.md F-09).
      expect(event.actor.name).toBe('Employee');
      expect(event.before).toStrictEqual({ status: 'PENDING' });
      expect(event.after).toStrictEqual({ status: 'APPROVED' });
    });
  });

  it('will not let an actor be deleted out of the trail', async () => {
    await withTestDb(async (tx) => {
      const { org, user } = await scaffold(tx);

      await tx.auditEvent.create({
        data: {
          orgId: org.id,
          actorId: user.id,
          action: 'cycle.activate',
          entityType: 'ReviewCycle',
          entityId: 'cycle-1',
        },
      });

      await expect(tx.user.delete({ where: { id: user.id } })).rejects.toThrow();
    });
  });

  it('is queryable by entity, which is what a dispute needs', async () => {
    await withTestDb(async (tx) => {
      const { org, user } = await scaffold(tx);

      await tx.auditEvent.createMany({
        data: [
          { orgId: org.id, actorId: user.id, action: 'goalsheet.submit', entityType: 'GoalSheet', entityId: 'sheet-1' },
          { orgId: org.id, actorId: user.id, action: 'goalsheet.approve', entityType: 'GoalSheet', entityId: 'sheet-1' },
          { orgId: org.id, actorId: user.id, action: 'goalsheet.submit', entityType: 'GoalSheet', entityId: 'sheet-2' },
        ],
      });

      const history = await tx.auditEvent.findMany({
        where: { orgId: org.id, entityType: 'GoalSheet', entityId: 'sheet-1' },
        orderBy: { createdAt: 'asc' },
      });

      expect(history.map((e) => e.action)).toStrictEqual([
        'goalsheet.submit',
        'goalsheet.approve',
      ]);
    });
  });
});

describe('Escalation [W1-11]', () => {
  it('carries a real deadline rather than a synthetic day count', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);

      const escalation = await tx.escalation.create({
        data: {
          orgId: org.id,
          cycleId: cycle.id,
          subjectUserId: user.id,
          rule: 'GOALS_NOT_SUBMITTED',
          dueAt: DUE,
        },
      });

      // dueAt comes from the cycle's phase dates. The prototype had no
      // deadlines at all and floored elapsed days at 4, so a sheet saved
      // seconds earlier read "4 days overdue" (PLAN.md F-08).
      expect(escalation.dueAt.toISOString()).toBe(DUE.toISOString());
      expect(escalation.tier).toBe('EMPLOYEE');
      expect(escalation.status).toBe('ACTIVE');
      expect(escalation.notifiedAt).toStrictEqual([]);
    });
  });

  it('holds one live escalation per person per rule per cycle', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);

      await tx.escalation.create({
        data: {
          orgId: org.id,
          cycleId: cycle.id,
          subjectUserId: user.id,
          rule: 'GOALS_NOT_SUBMITTED',
          dueAt: DUE,
        },
      });

      // The nightly job re-runs. It must update the existing row, not pile up
      // a duplicate every night.
      await expect(
        tx.escalation.create({
          data: {
            orgId: org.id,
            cycleId: cycle.id,
            subjectUserId: user.id,
            rule: 'GOALS_NOT_SUBMITTED',
            dueAt: DUE,
          },
        }),
      ).rejects.toThrow();
    });
  });

  it('allows different rules to breach for the same person at once', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);

      await expect(
        tx.escalation.createMany({
          data: [
            { orgId: org.id, cycleId: cycle.id, subjectUserId: user.id, rule: 'GOALS_NOT_SUBMITTED', dueAt: DUE },
            { orgId: org.id, cycleId: cycle.id, subjectUserId: user.id, rule: 'CHECK_IN_MISSING', dueAt: DUE },
          ],
        }),
      ).resolves.toBeDefined();
    });
  });

  it('appends one timestamp per notification actually sent', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);

      const created = await tx.escalation.create({
        data: {
          orgId: org.id,
          cycleId: cycle.id,
          subjectUserId: user.id,
          rule: 'APPROVAL_OVERDUE',
          dueAt: DUE,
        },
      });

      const escalated = await tx.escalation.update({
        where: { id: created.id },
        data: {
          tier: 'MANAGER',
          notifiedAt: { push: [new Date('2026-04-01'), new Date('2026-04-08')] },
        },
      });

      // The chain is auditable rather than asserted — the prototype's chain
      // was a string in a document and nothing was ever sent (PRD US-1203).
      expect(escalated.notifiedAt).toHaveLength(2);
      expect(escalated.tier).toBe('MANAGER');
    });
  });

  it('records who resolved it and why', async () => {
    await withTestDb(async (tx) => {
      const { org, user, cycle } = await scaffold(tx);
      const hr = await tx.user.create({
        data: { orgId: org.id, email: uniq('hr') + '@x.com', name: 'HR', roles: ['HR_ADMIN'] },
      });

      const created = await tx.escalation.create({
        data: {
          orgId: org.id,
          cycleId: cycle.id,
          subjectUserId: user.id,
          rule: 'SELF_APPRAISAL_OVERDUE',
          dueAt: DUE,
        },
      });

      const resolved = await tx.escalation.update({
        where: { id: created.id },
        data: {
          status: 'RESOLVED',
          resolvedById: hr.id,
          resolvedAt: new Date(),
          resolutionNote: 'On approved medical leave.',
        },
        include: { resolvedBy: true },
      });

      expect(resolved.resolvedBy?.name).toBe('HR');
      expect(resolved.resolutionNote).toContain('leave');
    });
  });
});

describe('Notification [W1-11]', () => {
  it('is a delivery with a status, not a string on a document', async () => {
    await withTestDb(async (tx) => {
      const { org, user } = await scaffold(tx);

      const notification = await tx.notification.create({
        data: {
          orgId: org.id,
          userId: user.id,
          type: 'goalsheet.returned',
          channel: 'EMAIL',
          payload: { sheetId: 'sheet-1', href: '/sheets/sheet-1' },
        },
      });

      expect(notification.status).toBe('PENDING');
      expect(notification.sentAt).toBeNull();
      expect(notification.readAt).toBeNull();
      expect(notification.mandatory).toBe(false);
    });
  });

  it('records a failure reason so delivery problems are visible', async () => {
    await withTestDb(async (tx) => {
      const { org, user } = await scaffold(tx);

      const created = await tx.notification.create({
        data: { orgId: org.id, userId: user.id, type: 'digest.weekly', channel: 'EMAIL' },
      });

      const failed = await tx.notification.update({
        where: { id: created.id },
        data: { status: 'FAILED', failureReason: 'mailbox full' },
      });

      expect(failed.status).toBe('FAILED');
      expect(failed.failureReason).toBe('mailbox full');
    });
  });

  it('supports the unread count the inbox badge needs', async () => {
    await withTestDb(async (tx) => {
      const { org, user } = await scaffold(tx);

      await tx.notification.createMany({
        data: [
          { orgId: org.id, userId: user.id, type: 'a', channel: 'IN_APP', readAt: new Date() },
          { orgId: org.id, userId: user.id, type: 'b', channel: 'IN_APP' },
          { orgId: org.id, userId: user.id, type: 'c', channel: 'IN_APP' },
        ],
      });

      const unread = await tx.notification.count({
        where: { userId: user.id, readAt: null },
      });

      expect(unread).toBe(2);
    });
  });

  it('flags compliance notices that ignore channel preferences', async () => {
    await withTestDb(async (tx) => {
      const { org, user } = await scaffold(tx);

      const notice = await tx.notification.create({
        data: {
          orgId: org.id,
          userId: user.id,
          type: 'escalation.skip_level',
          channel: 'EMAIL',
          mandatory: true,
        },
      });

      // Mandatory notices bypass suppression and are labelled as such in the
      // UI (PRD US-1202).
      expect(notice.mandatory).toBe(true);
    });
  });
});

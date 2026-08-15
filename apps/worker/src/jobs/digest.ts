/**
 * The weekly digest (W5-06).
 *
 * One message a week per person, summarising what is waiting for them. The
 * point is not the summary — it is that **a digest replaces the individual
 * nags**, which is what makes the "manual reminder emails sent by HR: 0" target
 * in PRD §8.2 achievable without burying everyone in mail.
 *
 * Only sent to people who actually have something outstanding. A digest that
 * arrives every week saying "nothing to do" trains people to filter it, and
 * the week it matters it goes to the same folder.
 */

import { prisma } from '@aura/db';

import { QUEUES } from '../boss.js';
import type { JobSender } from './escalations.js';

export type DigestResult = {
  readonly considered: number;
  readonly sent: number;
};

export type DigestItem = {
  readonly userId: string;
  readonly orgId: string;
  readonly sheetsAwaitingMyApproval: number;
  readonly myUnsubmittedSheets: number;
  readonly openEscalations: number;
};

/**
 * What each person has outstanding, counted in one query per cycle.
 *
 * Grouped rather than iterated: one round trip per active cycle, not one per
 * employee. An organization of four hundred would otherwise make this job
 * twelve hundred queries every Monday.
 */
export async function collectDigestItems(): Promise<DigestItem[]> {
  const cycles = await prisma.reviewCycle.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, orgId: true },
  });

  const items = new Map<string, DigestItem>();

  const bump = (userId: string, orgId: string, field: keyof DigestItem, by = 1): void => {
    const existing = items.get(userId) ?? {
      userId,
      orgId,
      sheetsAwaitingMyApproval: 0,
      myUnsubmittedSheets: 0,
      openEscalations: 0,
    };

    items.set(userId, { ...existing, [field]: (existing[field] as number) + by });
  };

  for (const cycle of cycles) {
    const pending = await prisma.goalSheet.findMany({
      where: { orgId: cycle.orgId, cycleId: cycle.id, status: 'PENDING' },
      select: { user: { select: { managerId: true } } },
    });

    for (const sheet of pending) {
      if (sheet.user.managerId !== null) {
        bump(sheet.user.managerId, cycle.orgId, 'sheetsAwaitingMyApproval');
      }
    }

    const unsubmitted = await prisma.goalSheet.groupBy({
      by: ['userId'],
      where: { orgId: cycle.orgId, cycleId: cycle.id, status: { in: ['DRAFT', 'RETURNED'] } },
      _count: { _all: true },
    });

    for (const row of unsubmitted) {
      bump(row.userId, cycle.orgId, 'myUnsubmittedSheets', row._count._all);
    }

    const escalations = await prisma.escalation.groupBy({
      by: ['subjectUserId'],
      where: { orgId: cycle.orgId, cycleId: cycle.id, status: 'ACTIVE' },
      _count: { _all: true },
    });

    for (const row of escalations) {
      bump(row.subjectUserId, cycle.orgId, 'openEscalations', row._count._all);
    }
  }

  return [...items.values()];
}

/** Whether this person has anything worth a message. */
export function hasSomethingToSay(item: DigestItem): boolean {
  return (
    item.sheetsAwaitingMyApproval > 0 || item.myUnsubmittedSheets > 0 || item.openEscalations > 0
  );
}

/**
 * Enqueue a digest for everyone with something outstanding.
 *
 * `boss` is optional so the collection logic can be tested without a queue,
 * for the same reason the escalation sweep takes one that way: the decision is
 * the part with rules in it.
 */
export async function runWeeklyDigest(boss?: JobSender): Promise<DigestResult> {
  const items = await collectDigestItems();
  const worthSending = items.filter(hasSomethingToSay);

  for (const item of worthSending) {
    await boss?.send(QUEUES.notificationDispatch, {
      orgId: item.orgId,
      userId: item.userId,
      type: 'digest.weekly',
      payload: {
        awaitingApproval: String(item.sheetsAwaitingMyApproval),
        unsubmitted: String(item.myUnsubmittedSheets),
        escalations: String(item.openEscalations),
      },
    });
  }

  return { considered: items.length, sent: worthSending.length };
}

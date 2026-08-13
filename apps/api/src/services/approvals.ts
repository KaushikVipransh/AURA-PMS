/**
 * The approval workflow (PRD US-502, US-503, US-305).
 *
 * Three transitions a manager can make on a submitted sheet: approve it,
 * return it for rework, or adjust its weightages before approving. Each one
 * snapshots the sheet first, so "what did we actually agree to" survives every
 * later edit — the question a disputed rating turns on, and the one the
 * prototype could not answer because it overwrote goals in place (PLAN.md F-09,
 * PRD US-1103).
 */

import { validateWeightages, type AuditActor } from '@aura/core';

import type { ScopedPrisma } from '../db/scoped.js';
import type { AuditedTx } from './withAudit.js';
import { withAudit } from './withAudit.js';

const SHEET_VIEW = {
  id: true,
  userId: true,
  cycleId: true,
  status: true,
  submittedAt: true,
  approvedAt: true,
  approverId: true,
  lockedAt: true,
} as const;

const GOAL_VIEW = {
  id: true,
  thrustArea: true,
  title: true,
  uom: true,
  direction: true,
  target: true,
  weightage: true,
  status: true,
} as const;

export class ApprovalStateError extends Error {
  readonly code: 'NOT_PENDING' | 'INVALID_WEIGHTAGES' | 'UNKNOWN_GOAL' | 'SELF_APPROVAL';
  readonly detail: readonly string[];

  constructor(code: ApprovalStateError['code'], message: string, detail: readonly string[] = []) {
    super(message);
    this.name = 'ApprovalStateError';
    this.code = code;
    this.detail = detail;
  }
}

const asNumber = (value: { toString(): string }): number => Number(value.toString());

/**
 * Snapshot the sheet as it stands, and return the revision number used.
 *
 * Taken *before* the change in every caller here. A snapshot written afterwards
 * records the outcome, which the row itself already tells you; the point of a
 * revision is to preserve what is about to stop being true.
 */
async function snapshot(
  tx: AuditedTx,
  sheetId: string,
  reason: 'SUBMIT' | 'APPROVE' | 'ADJUST',
  actorId: string,
  goals: readonly { weightage: { toString(): string } }[],
): Promise<number> {
  const latest = await tx.sheetRevision.findFirst({
    where: { sheetId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });

  const revision = (latest?.revision ?? 0) + 1;

  await tx.sheetRevision.create({
    data: {
      sheetId,
      revision,
      reason,
      actorId,
      snapshot: { goals: goals.map((goal) => ({ ...goal, weightage: asNumber(goal.weightage) })) },
    },
  });

  return revision;
}

/** Queue an in-app notification. W5 turns these into real deliveries. */
async function notify(
  tx: AuditedTx,
  orgId: string,
  userId: string,
  type: string,
  payload: Record<string, string>,
): Promise<void> {
  await tx.notification.create({
    data: { orgId, userId, type, channel: 'IN_APP', payload },
  });
}

/**
 * Approve and lock (US-502).
 *
 * The snapshot, the lock, the audit row and the notification all commit in one
 * transaction. A notification that survived a rolled-back approval would tell
 * someone their goals were approved when they were not.
 */
export async function approveSheet(
  db: ScopedPrisma,
  actor: AuditActor,
  sheetId: string,
) {
  return withAudit(
    db,
    actor,
    { action: 'goalsheet.approve', entityType: 'GoalSheet', entityId: sheetId },
    async (tx) => {
      const before = await tx.goalSheet.findUniqueOrThrow({
        where: { id: sheetId },
        select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
      });

      if (before.status !== 'PENDING') {
        throw new ApprovalStateError(
          'NOT_PENDING',
          `Only a submitted sheet can be approved; this one is ${before.status}.`,
        );
      }

      /*
       * Belt and braces with W2-06, which already refuses SELF on
       * APPROVE_GOAL_SHEET. Repeated here because this service is reachable
       * from a job or a script that never consulted the policy table, and
       * "nobody approves their own goals" is the rule an approval workflow
       * exists to enforce.
       */
      if (before.userId === actor.userId) {
        throw new ApprovalStateError('SELF_APPROVAL', 'A sheet cannot be approved by its owner.');
      }

      await snapshot(tx, sheetId, 'APPROVE', actor.userId, before.goals);

      const now = new Date();
      const after = await tx.goalSheet.update({
        where: { id: sheetId },
        data: { status: 'APPROVED', approvedAt: now, approverId: actor.userId, lockedAt: now },
        select: SHEET_VIEW,
      });

      await notify(tx, actor.orgId, before.userId, 'goalsheet.approved', { sheetId });

      return { value: after, before, after };
    },
  );
}

/**
 * Return for rework (US-305).
 *
 * `reason` is required by the signature, not merely by the schema. A sheet
 * returned with no explanation is the failure this story exists to fix: the
 * employee is told to change something and not what.
 */
export async function returnSheet(
  db: ScopedPrisma,
  actor: AuditActor,
  sheetId: string,
  input: { reason: string; goalIds: readonly string[] },
) {
  return withAudit(
    db,
    actor,
    { action: 'goalsheet.return', entityType: 'GoalSheet', entityId: sheetId },
    async (tx) => {
      const before = await tx.goalSheet.findUniqueOrThrow({
        where: { id: sheetId },
        select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
      });

      if (before.status !== 'PENDING') {
        throw new ApprovalStateError(
          'NOT_PENDING',
          `Only a submitted sheet can be returned; this one is ${before.status}.`,
        );
      }

      const known = new Set(before.goals.map((goal) => goal.id));
      const unknown = input.goalIds.filter((id) => !known.has(id));

      if (unknown.length > 0) {
        throw new ApprovalStateError(
          'UNKNOWN_GOAL',
          'One or more flagged goals do not belong to this sheet.',
          unknown,
        );
      }

      const after = await tx.goalSheet.update({
        where: { id: sheetId },
        data: { status: 'RETURNED', submittedAt: null },
        select: SHEET_VIEW,
      });

      await notify(tx, actor.orgId, before.userId, 'goalsheet.returned', {
        sheetId,
        reason: input.reason,
        goalIds: input.goalIds.join(','),
      });

      return { value: after, before, after };
    },
  );
}

/**
 * Adjust weightages inline before approving (US-503).
 *
 * Re-runs the full W2-02 validation on the *result*, not on the adjustments —
 * a manager who fixes one goal and breaks the total has not fixed anything.
 * The original is preserved as an `ADJUST` revision before the change, and the
 * employee is notified, because a weightage moved without telling them is a
 * change to what they are measured on.
 */
export async function adjustWeightages(
  db: ScopedPrisma,
  actor: AuditActor,
  sheetId: string,
  input: { adjustments: readonly { goalId: string; weightage: number }[]; note: string },
) {
  return withAudit(
    db,
    actor,
    { action: 'goalsheet.adjust', entityType: 'GoalSheet', entityId: sheetId },
    async (tx) => {
      const before = await tx.goalSheet.findUniqueOrThrow({
        where: { id: sheetId },
        select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
      });

      if (before.status !== 'PENDING') {
        throw new ApprovalStateError(
          'NOT_PENDING',
          `Weightages can only be adjusted on a submitted sheet; this one is ${before.status}.`,
        );
      }

      const known = new Map(before.goals.map((goal) => [goal.id, goal]));
      const unknown = input.adjustments.filter((entry) => !known.has(entry.goalId));

      if (unknown.length > 0) {
        throw new ApprovalStateError(
          'UNKNOWN_GOAL',
          'One or more goals do not belong to this sheet.',
          unknown.map((entry) => entry.goalId),
        );
      }

      // Validated against what the sheet WOULD look like, before writing it.
      const proposed = new Map(input.adjustments.map((entry) => [entry.goalId, entry.weightage]));
      const validation = validateWeightages(
        before.goals.map((goal) => ({
          id: goal.id,
          title: goal.title,
          weightage: proposed.get(goal.id) ?? asNumber(goal.weightage),
        })),
      );

      if (!validation.valid) {
        throw new ApprovalStateError(
          'INVALID_WEIGHTAGES',
          'Those adjustments would leave the sheet invalid.',
          validation.issues.map((issue) => issue.message),
        );
      }

      await snapshot(tx, sheetId, 'ADJUST', actor.userId, before.goals);

      for (const entry of input.adjustments) {
        await tx.goal.update({
          where: { id: entry.goalId },
          // One column. A manager adjusting weightage does not get to retitle.
          data: { weightage: entry.weightage },
        });
      }

      const after = await tx.goalSheet.findUniqueOrThrow({
        where: { id: sheetId },
        select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
      });

      await notify(tx, actor.orgId, before.userId, 'goalsheet.adjusted', {
        sheetId,
        note: input.note,
      });

      return { value: after, before, after };
    },
  );
}

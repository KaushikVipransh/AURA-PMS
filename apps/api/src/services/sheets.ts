/**
 * Goal sheet mutations (PRD US-301, US-302, US-601).
 *
 * The check-in path here is the direct replacement for PLAN.md F-04: the
 * prototype's check-in route took the client's entire payload and wrote it over
 * an approved sheet, so a "progress update" could silently rewrite targets and
 * weightages after they had been agreed.
 */

import { validateWeightages, type AuditActor } from '@aura/core';
import type { CheckInRequest, GoalInput } from '@aura/contracts';

import type { ScopedPrisma } from '../db/scoped.js';
import { withAudit } from './withAudit.js';

const SHEET_VIEW = {
  id: true,
  userId: true,
  cycleId: true,
  status: true,
  submittedAt: true,
  approvedAt: true,
} as const;

const GOAL_VIEW = {
  id: true,
  thrustArea: true,
  title: true,
  uom: true,
  direction: true,
  target: true,
  weightage: true,
  actualAchievement: true,
  status: true,
} as const;

export class SheetStateError extends Error {
  readonly code: 'NOT_DRAFT' | 'NOT_APPROVED' | 'INVALID_WEIGHTAGES' | 'UNKNOWN_GOAL';
  readonly detail: readonly string[];

  constructor(code: SheetStateError['code'], message: string, detail: readonly string[] = []) {
    super(message);
    this.name = 'SheetStateError';
    this.code = code;
    this.detail = detail;
  }
}

/** Weightages are `Decimal(5, 2)`; Prisma returns them as Decimal objects. */
const asNumber = (value: { toString(): string }): number => Number(value.toString());

/**
 * Save a draft (US-301).
 *
 * Replaces the whole goal list rather than patching it, because a sheet is
 * edited as a unit and a partial update would need the client to reason about
 * which goals it had seen. Only a `DRAFT` or `RETURNED` sheet is writable.
 */
export async function saveDraft(
  db: ScopedPrisma,
  actor: AuditActor,
  input: { cycleId: string; goals: readonly GoalInput[] },
) {
  return withAudit(db, actor, { action: 'goalsheet.save', entityType: 'GoalSheet' }, async (tx) => {
    const existing = await tx.goalSheet.findFirst({
      where: { userId: actor.userId, cycleId: input.cycleId },
      select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
    });

    if (existing !== null && existing.status !== 'DRAFT' && existing.status !== 'RETURNED') {
      throw new SheetStateError(
        'NOT_DRAFT',
        `This sheet is ${existing.status} and can no longer be edited.`,
      );
    }

    const sheet =
      existing ??
      (await tx.goalSheet.create({
        data: { orgId: actor.orgId, userId: actor.userId, cycleId: input.cycleId },
        select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
      }));

    await tx.goal.deleteMany({ where: { sheetId: sheet.id } });

    await tx.goal.createMany({
      data: input.goals.map((goal) => ({
        sheetId: sheet.id,
        thrustArea: goal.thrustArea,
        title: goal.title,
        uom: goal.uom,
        // No default and no inference. The prototype read direction out of the
        // title with a substring match (F-06).
        direction: goal.direction,
        target: goal.target,
        weightage: goal.weightage,
      })),
    });

    const after = await tx.goalSheet.findUniqueOrThrow({
      where: { id: sheet.id },
      select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
    });

    return { value: after, before: existing ?? {}, after, entityId: sheet.id };
  });
}

/**
 * Submit for approval (US-302).
 *
 * Validation runs against `validateWeightages` from W2-02 — the same function
 * the Zod schema calls and the cascade planner respects — so a sheet the API
 * accepts is a sheet every other part of the system considers valid. The
 * prototype had three different answers to this question (F-10).
 *
 * Writes a `SheetRevision` in the same transaction, so "what did we actually
 * agree to" has an answer even after later edits (US-1103).
 */
export async function submitSheet(db: ScopedPrisma, actor: AuditActor, sheetId: string) {
  return withAudit(
    db,
    actor,
    { action: 'goalsheet.submit', entityType: 'GoalSheet', entityId: sheetId },
    async (tx) => {
      const before = await tx.goalSheet.findUniqueOrThrow({
        where: { id: sheetId },
        select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
      });

      if (before.status !== 'DRAFT' && before.status !== 'RETURNED') {
        throw new SheetStateError(
          'NOT_DRAFT',
          `This sheet is already ${before.status}.`,
        );
      }

      const validation = validateWeightages(
        before.goals.map((goal) => ({
          id: goal.id,
          title: goal.title,
          weightage: asNumber(goal.weightage),
        })),
      );

      if (!validation.valid) {
        throw new SheetStateError(
          'INVALID_WEIGHTAGES',
          'This sheet cannot be submitted yet.',
          validation.issues.map((issue) => issue.message),
        );
      }

      const after = await tx.goalSheet.update({
        where: { id: sheetId },
        data: { status: 'PENDING', submittedAt: new Date() },
        select: SHEET_VIEW,
      });

      /*
       * The revision number is computed inside the transaction, and
       * `@@unique([sheetId, revision])` is what makes that safe: two concurrent
       * submits would both read the same maximum, and the second insert would
       * fail on the constraint rather than silently overwriting the first.
       * A losing submit rolls back whole — which is the correct outcome, since
       * its snapshot would have been wrong anyway.
       */
      const latest = await tx.sheetRevision.findFirst({
        where: { sheetId },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });

      await tx.sheetRevision.create({
        data: {
          sheetId,
          revision: (latest?.revision ?? 0) + 1,
          reason: 'SUBMIT',
          actorId: actor.userId,
          snapshot: {
            goals: before.goals.map((goal) => ({
              ...goal,
              weightage: asNumber(goal.weightage),
            })),
          },
        },
      });

      return { value: after, before, after };
    },
  );
}

/**
 * Record progress (US-601) — **the field whitelist that closes F-04.**
 *
 * Only `actualAchievement` and `status` are written, and they are written
 * field by field rather than by spreading the request. Two independent guards
 * say so: `checkInRequestSchema` has no room for anything else (Zod strips
 * unknown keys), and this function names the two columns explicitly.
 *
 * Either alone would be enough today. Both together mean the protection
 * survives someone loosening the schema without reading this file, or writing
 * a new caller that bypasses HTTP entirely.
 */
export async function recordCheckIn(
  db: ScopedPrisma,
  actor: AuditActor,
  sheetId: string,
  input: CheckInRequest,
) {
  return withAudit(
    db,
    actor,
    { action: 'goalsheet.checkin', entityType: 'GoalSheet', entityId: sheetId },
    async (tx) => {
      const before = await tx.goalSheet.findUniqueOrThrow({
        where: { id: sheetId },
        select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
      });

      if (before.status !== 'APPROVED') {
        throw new SheetStateError(
          'NOT_APPROVED',
          'Progress can only be recorded against an approved sheet.',
        );
      }

      const known = new Set(before.goals.map((goal) => goal.id));
      const unknown = input.updates.filter((update) => !known.has(update.goalId));

      if (unknown.length > 0) {
        // A goal id from another sheet would otherwise be written happily --
        // the org scope stops another tenant's, but not another sheet's.
        throw new SheetStateError(
          'UNKNOWN_GOAL',
          'One or more goals do not belong to this sheet.',
          unknown.map((update) => update.goalId),
        );
      }

      for (const update of input.updates) {
        await tx.goal.update({
          where: { id: update.goalId },
          // Exactly two columns, named. Not a spread of `update`.
          data: {
            actualAchievement: update.actualAchievement,
            status: update.status,
          },
        });
      }

      const after = await tx.goalSheet.findUniqueOrThrow({
        where: { id: sheetId },
        select: { ...SHEET_VIEW, goals: { select: GOAL_VIEW } },
      });

      return { value: after, before, after };
    },
  );
}

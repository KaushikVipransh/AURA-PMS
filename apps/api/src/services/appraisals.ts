/**
 * The appraisal, in stages (PRD US-701, US-702, US-703, US-704).
 *
 * **This is the half of the product the prototype did not have at all**
 * (PLAN.md §6, F-13 through F-15). AuraPMS covered goal setting and check-ins
 * and stopped; in a real performance system the appraisal is the reason the
 * organization bought the tool.
 *
 * Four stages are written side by side and never over each other: the
 * employee's reflection, the manager's rating, calibration's final number, and
 * the employee's acknowledgement. A manager's 3 stays readable after
 * calibration moves the final to 4, which is the difference between a history
 * and a rewrite (US-802).
 *
 * The computed score is never stored. It is recomputed from the goals by the
 * W2-01 engine whenever it is read, because a stored score is a second opinion
 * that goes stale the moment an actual is corrected — the prototype computed it
 * in two JSX components and they could drift with a deploy (F-07).
 */

import {
  scoreSheet,
  type AuditActor,
  type GoalDirection,
  type GoalStatus,
  type Uom,
} from '@aura/core';
import type { ManagerRatingRequest, SelfAppraisalRequest } from '@aura/contracts';

import type { ScopedPrisma } from '../db/scoped.js';
import type { AuditedTx } from './withAudit.js';
import { withAudit } from './withAudit.js';

/** The scale a cycle was created with, snapshotted onto it (US-203). */
export type RatingScale = { readonly min: number; readonly max: number };

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

const APPRAISAL_VIEW = {
  id: true,
  sheetId: true,
  selfRating: true,
  selfNarrative: true,
  selfSubmittedAt: true,
  managerId: true,
  managerRating: true,
  managerNarrative: true,
  managerSubmittedAt: true,
  finalRating: true,
  calibratedById: true,
  calibrationReason: true,
  releasedAt: true,
  acknowledgedAt: true,
  acknowledgementComment: true,
  disputedAt: true,
} as const;

export class AppraisalStateError extends Error {
  readonly code:
    | 'SHEET_NOT_APPROVED'
    | 'ALREADY_SUBMITTED'
    | 'SELF_NOT_READY'
    | 'UNKNOWN_GOAL'
    | 'MISSING_GOAL'
    | 'OFF_SCALE'
    | 'NOT_RATED'
    | 'ALREADY_RELEASED'
    | 'NOT_RELEASED'
    | 'ALREADY_ACKNOWLEDGED';
  readonly detail: readonly string[];

  constructor(code: AppraisalStateError['code'], message: string, detail: readonly string[] = []) {
    super(message);
    this.name = 'AppraisalStateError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Read the rating scale off a cycle, refusing anything unusable.
 *
 * The column is `Json`, so what comes back is whatever was written. A scale
 * that cannot be read is a defect rather than a reason to fall back on a
 * default: a default scale would silently re-scale every rating in the cycle,
 * which is precisely what snapshotting the scale onto the cycle exists to
 * prevent.
 */
export function readScale(value: unknown): RatingScale {
  const scale = value as { min?: unknown; max?: unknown } | null;

  if (
    scale === null ||
    typeof scale.min !== 'number' ||
    typeof scale.max !== 'number' ||
    scale.min >= scale.max
  ) {
    throw new AppraisalStateError(
      'OFF_SCALE',
      'This cycle has no usable rating scale, so nothing can be rated against it.',
    );
  }

  return { min: scale.min, max: scale.max };
}

/** Place a 0–1 computed score onto the cycle's scale, so the two compare. */
export function onScale(score: number, scale: RatingScale): number {
  return scale.min + score * (scale.max - scale.min);
}

function assertOnScale(rating: number, scale: RatingScale, label: string): void {
  if (!Number.isInteger(rating) || rating < scale.min || rating > scale.max) {
    throw new AppraisalStateError(
      'OFF_SCALE',
      `${label} must be a whole number between ${String(scale.min)} and ${String(scale.max)}.`,
    );
  }
}

/**
 * A goal row as the database returns it, in the shape W2-01 wants.
 *
 * `weightage` is typed by what can be done with it rather than as `Decimal`,
 * so this module does not have to name a Prisma runtime type — and so a test
 * can hand it a plain string.
 */
export type ScorableRow = {
  readonly id: string;
  readonly uom: Uom;
  readonly direction: GoalDirection;
  readonly target: string;
  readonly actualAchievement: string | null;
  readonly status: GoalStatus;
  readonly weightage: { toString(): string };
};

/** One mapping from a database row to a scorable goal, used by every caller. */
function toScorable(goal: ScorableRow) {
  return {
    id: goal.id,
    uom: goal.uom,
    direction: goal.direction,
    target: goal.target,
    actualAchievement: goal.actualAchievement,
    status: goal.status,
    weightage: goal.weightage.toString(),
  };
}

/** The W2-01 weighted score for a set of goal rows. */
export function scoreOf(goals: readonly ScorableRow[]): number {
  return scoreSheet(goals.map(toScorable)).score;
}

/**
 * Load a sheet's appraisal, pre-populated (US-701).
 *
 * "Pre-populated" is the whole story: an employee should not start from a blank
 * page. Every goal comes back with its target, its actual and its computed
 * score, alongside whatever has been written about it so far.
 */
export async function readAppraisal(db: ScopedPrisma, sheetId: string) {
  const sheet = await db.goalSheet.findUniqueOrThrow({
    where: { id: sheetId },
    select: {
      id: true,
      orgId: true,
      userId: true,
      cycleId: true,
      status: true,
      goals: { select: GOAL_VIEW, orderBy: { title: 'asc' } },
      cycle: { select: { ratingScale: true, selfAppraisalDueAt: true } },
    },
  });

  const appraisal = await db.appraisal.findUnique({
    where: { sheetId, sheet: { orgId: sheet.orgId } },
    select: { ...APPRAISAL_VIEW, goalRatings: true },
  });

  const scale = readScale(sheet.cycle.ratingScale);
  const scored = scoreSheet(sheet.goals.map(toScorable));

  const byGoal = new Map((appraisal?.goalRatings ?? []).map((row) => [row.goalId, row]));
  const scoreOfGoal = new Map(scored.breakdown.map((row) => [row.id, row.score]));

  return {
    sheetId: sheet.id,
    userId: sheet.userId,
    cycleId: sheet.cycleId,
    scale,
    selfAppraisalDueAt: sheet.cycle.selfAppraisalDueAt,
    computedScore: scored.score,
    computedOnScale: onScale(scored.score, scale),
    appraisal,
    goals: sheet.goals.map((goal) => ({
      id: goal.id,
      thrustArea: goal.thrustArea,
      title: goal.title,
      uom: goal.uom,
      direction: goal.direction,
      target: goal.target,
      weightage: Number(goal.weightage.toString()),
      actualAchievement: goal.actualAchievement,
      status: goal.status,
      /** Computed here, on the server, by the one engine (F-07). */
      computedScore: scoreOfGoal.get(goal.id) ?? 0,
      selfNarrative: byGoal.get(goal.id)?.selfNarrative ?? null,
      managerRating: byGoal.get(goal.id)?.rating ?? null,
      managerNarrative: byGoal.get(goal.id)?.narrative ?? null,
    })),
  };
}

/** Create the appraisal row for a sheet if it has none, and return its id. */
async function ensureAppraisal(tx: AuditedTx, sheetId: string): Promise<string> {
  const existing = await tx.appraisal.findUnique({ where: { sheetId }, select: { id: true } });

  if (existing !== null) {
    return existing.id;
  }

  const created = await tx.appraisal.create({ data: { sheetId }, select: { id: true } });

  return created.id;
}

/** Every goal on the sheet, and the state that decides whether it can move. */
async function loadContext(tx: AuditedTx, sheetId: string) {
  const sheet = await tx.goalSheet.findUniqueOrThrow({
    where: { id: sheetId },
    select: {
      id: true,
      orgId: true,
      userId: true,
      status: true,
      goals: { select: { id: true } },
      cycle: { select: { ratingScale: true, selfAppraisalDueAt: true } },
    },
  });

  const appraisal = await tx.appraisal.findUnique({
    where: { sheetId, sheet: { orgId: sheet.orgId } },
    select: APPRAISAL_VIEW,
  });

  return { sheet, appraisal, scale: readScale(sheet.cycle.ratingScale) };
}

/**
 * Check that a set of entries names every goal on the sheet and no others.
 *
 * Both directions matter. An unknown id would write a rating onto another
 * sheet's goal — org scoping stops another tenant's, not another sheet's — and
 * a missing one would leave a goal silently unrated in a document that reads as
 * complete.
 */
function assertCoversGoals(
  entries: readonly { goalId: string }[],
  goalIds: readonly string[],
): void {
  const known = new Set(goalIds);
  const given = new Set(entries.map((entry) => entry.goalId));
  const unknown = [...given].filter((id) => !known.has(id));
  const missing = goalIds.filter((id) => !given.has(id));

  if (unknown.length > 0) {
    throw new AppraisalStateError(
      'UNKNOWN_GOAL',
      'One or more entries name a goal that is not on this sheet.',
      unknown,
    );
  }

  if (missing.length > 0) {
    throw new AppraisalStateError(
      'MISSING_GOAL',
      'Every goal on the sheet needs an entry.',
      missing,
    );
  }
}

/**
 * US-701 — write the self-appraisal.
 *
 * Saved and submitted are one call with a flag rather than two endpoints,
 * because the difference between them is a single timestamp and splitting it
 * would mean two code paths that must agree about what a valid draft is.
 * Submitting locks it: the story says so, and an appraisal a manager has begun
 * reading should not change underneath them.
 */
export async function writeSelfAppraisal(
  db: ScopedPrisma,
  actor: AuditActor,
  sheetId: string,
  input: SelfAppraisalRequest,
  submit: boolean,
) {
  return withAudit(
    db,
    actor,
    {
      action: submit ? 'appraisal.self.submit' : 'appraisal.self.save',
      entityType: 'Appraisal',
    },
    async (tx) => {
      const { sheet, appraisal, scale } = await loadContext(tx, sheetId);

      /*
       * An appraisal is an assessment of agreed goals. On a sheet that was
       * never approved there is nothing agreed to assess, and writing one
       * would let an employee appraise themselves against goals their manager
       * declined.
       */
      if (sheet.status !== 'APPROVED') {
        throw new AppraisalStateError(
          'SHEET_NOT_APPROVED',
          'A self-appraisal can only be written against an approved sheet.',
        );
      }

      if (appraisal?.selfSubmittedAt != null) {
        throw new AppraisalStateError(
          'ALREADY_SUBMITTED',
          'This self-appraisal has been submitted and can no longer be edited.',
        );
      }

      assertCoversGoals(
        input.entries,
        sheet.goals.map((goal) => goal.id),
      );

      if (input.selfRating !== undefined) {
        assertOnScale(input.selfRating, scale, 'A self-rating');
      }

      const before = appraisal ?? {};
      const appraisalId = await ensureAppraisal(tx, sheetId);

      for (const entry of input.entries) {
        await tx.goalRating.upsert({
          where: { appraisalId_goalId: { appraisalId, goalId: entry.goalId } },
          // One column. The employee writes their own reflection and does not
          // get to set the rating that will be applied to them.
          create: { appraisalId, goalId: entry.goalId, selfNarrative: entry.commentary },
          update: { selfNarrative: entry.commentary },
        });
      }

      const after = await tx.appraisal.update({
        where: { id: appraisalId },
        data: {
          selfNarrative: input.summary,
          selfRating: input.selfRating ?? null,
          ...(submit ? { selfSubmittedAt: new Date() } : {}),
        },
        select: APPRAISAL_VIEW,
      });

      return { value: after, before, after, entityId: appraisalId };
    },
  );
}

/**
 * Whether the manager may rate yet (US-702).
 *
 * Exported and pure, so the route can explain a refusal and a test can pin the
 * boundary down without a database. Two ways through: the employee has spoken,
 * or their deadline has passed. A null deadline means there is no clock, so the
 * manager waits — the alternative failure is rating someone who was never given
 * the chance to speak first.
 */
export function selfAppraisalIsReady(
  selfSubmittedAt: Date | null,
  selfAppraisalDueAt: Date | null,
  now: Date,
): boolean {
  if (selfSubmittedAt !== null) {
    return true;
  }

  return selfAppraisalDueAt !== null && now.getTime() >= selfAppraisalDueAt.getTime();
}

/**
 * US-702 — the manager's rating.
 *
 * `justification` is required by the contract and every goal must carry its own
 * commentary. A rating with no reason is what a disputed appraisal turns on,
 * and making it optional means it is absent exactly when it is needed.
 */
export async function writeManagerRating(
  db: ScopedPrisma,
  actor: AuditActor,
  sheetId: string,
  input: ManagerRatingRequest,
  now: Date = new Date(),
) {
  return withAudit(
    db,
    actor,
    { action: 'appraisal.manager.submit', entityType: 'Appraisal' },
    async (tx) => {
      const { sheet, appraisal, scale } = await loadContext(tx, sheetId);

      if (sheet.status !== 'APPROVED') {
        throw new AppraisalStateError(
          'SHEET_NOT_APPROVED',
          'A rating can only be written against an approved sheet.',
        );
      }

      if (
        !selfAppraisalIsReady(
          appraisal?.selfSubmittedAt ?? null,
          sheet.cycle.selfAppraisalDueAt,
          now,
        )
      ) {
        throw new AppraisalStateError(
          'SELF_NOT_READY',
          'The self-appraisal has not been submitted and its deadline has not passed.',
        );
      }

      assertCoversGoals(
        input.ratings,
        sheet.goals.map((goal) => goal.id),
      );

      for (const rating of input.ratings) {
        assertOnScale(rating.rating, scale, 'A goal rating');
      }
      assertOnScale(input.overallRating, scale, 'The overall rating');

      const before = appraisal ?? {};
      const appraisalId = await ensureAppraisal(tx, sheetId);

      for (const rating of input.ratings) {
        await tx.goalRating.upsert({
          where: { appraisalId_goalId: { appraisalId, goalId: rating.goalId } },
          create: {
            appraisalId,
            goalId: rating.goalId,
            rating: rating.rating,
            narrative: rating.commentary,
          },
          // `selfNarrative` is untouched: the employee's words are theirs, and
          // the point of US-702 is that the manager rates with them visible.
          update: { rating: rating.rating, narrative: rating.commentary },
        });
      }

      const after = await tx.appraisal.update({
        where: { id: appraisalId },
        data: {
          managerId: actor.userId,
          managerRating: input.overallRating,
          managerNarrative: input.justification,
          managerSubmittedAt: new Date(),
          /*
           * The final rating starts as the manager's.
           *
           * Not left null to be filled in later: an appraisal whose final
           * rating is absent unless somebody calibrates it would publish
           * nothing for every employee nobody discussed. Calibration is an
           * adjustment to a decision that has already been made.
           */
          finalRating: input.overallRating,
        },
        select: APPRAISAL_VIEW,
      });

      return { value: after, before, after, entityId: appraisalId };
    },
  );
}

/**
 * US-802 — adjust a rating in calibration, with a mandatory reason.
 *
 * The manager's number is not touched. `managerRating` and `finalRating` are
 * separate columns precisely so both survive, and the audit row carries the
 * pair — "who changed this and from what" is the question a calibration
 * adjustment has to be able to answer months later.
 */
export async function calibrateAppraisal(
  db: ScopedPrisma,
  actor: AuditActor,
  appraisalId: string,
  input: { finalRating: number; reason: string },
) {
  return withAudit(
    db,
    actor,
    { action: 'appraisal.calibrate', entityType: 'Appraisal', entityId: appraisalId },
    async (tx) => {
      const before = await tx.appraisal.findUniqueOrThrow({
        // Filtered through the sheet, because `Appraisal` has no `orgId` of
        // its own and so is NOT covered by the org-scope extension -- exactly
        // the "tenancy travels through a parent" case `ORG_SCOPED_MODELS`
        // names. This function takes an id straight from the request, so
        // without the join it would read and write another tenant's row.
        where: { id: appraisalId, sheet: { orgId: actor.orgId } },
        select: {
          ...APPRAISAL_VIEW,
          sheet: { select: { userId: true, cycle: { select: { ratingScale: true } } } },
        },
      });

      if (before.managerSubmittedAt === null) {
        throw new AppraisalStateError(
          'NOT_RATED',
          'There is no rating to calibrate: the manager has not submitted one.',
        );
      }

      if (before.releasedAt !== null) {
        throw new AppraisalStateError(
          'ALREADY_RELEASED',
          'These results have been released and can no longer be calibrated.',
        );
      }

      assertOnScale(input.finalRating, readScale(before.sheet.cycle.ratingScale), 'A final rating');

      const after = await tx.appraisal.update({
        where: { id: appraisalId },
        data: {
          finalRating: input.finalRating,
          calibratedById: actor.userId,
          calibrationReason: input.reason,
        },
        select: APPRAISAL_VIEW,
      });

      // The manager is told, because a rating they wrote has been changed.
      if (before.managerId !== null) {
        await tx.notification.create({
          data: {
            orgId: actor.orgId,
            userId: before.managerId,
            type: 'appraisal.calibrated',
            channel: 'IN_APP',
            payload: {
              appraisalId,
              from: String(before.managerRating),
              to: String(input.finalRating),
              reason: input.reason,
            },
          },
        });
      }

      return { value: after, before, after };
    },
  );
}

/**
 * US-703 — the employee acknowledges, optionally disagreeing on the record.
 *
 * Disagreement is recorded rather than argued with. `disputedAt` is what makes
 * "I do not accept this" a state HR can find, instead of a comment nobody reads.
 */
export async function acknowledgeAppraisal(
  db: ScopedPrisma,
  actor: AuditActor,
  sheetId: string,
  input: { comment?: string | undefined; dispute: boolean },
) {
  return withAudit(
    db,
    actor,
    { action: 'appraisal.acknowledge', entityType: 'Appraisal' },
    async (tx) => {
      const before = await tx.appraisal.findUniqueOrThrow({
        where: { sheetId, sheet: { orgId: actor.orgId } },
        select: APPRAISAL_VIEW,
      });

      if (before.releasedAt === null) {
        throw new AppraisalStateError(
          'NOT_RELEASED',
          'There is nothing to acknowledge: these results have not been released.',
        );
      }

      if (before.acknowledgedAt !== null) {
        throw new AppraisalStateError(
          'ALREADY_ACKNOWLEDGED',
          'This rating has already been acknowledged.',
        );
      }

      const now = new Date();
      const after = await tx.appraisal.update({
        where: { id: before.id },
        data: {
          acknowledgedAt: now,
          acknowledgementComment: input.comment ?? null,
          disputedAt: input.dispute ? now : null,
        },
        select: APPRAISAL_VIEW,
      });

      return { value: after, before, after, entityId: before.id };
    },
  );
}

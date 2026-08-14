/**
 * Calibration and release (PRD US-801, US-802, US-803, US-704).
 *
 * A calibration meeting is run from one screen, so this builds one response:
 * the org-wide distribution, the same counts split by manager, and the
 * appraisals where the manager's number is far from what the goals actually
 * say. Three endpoints would mean three round trips for one conversation.
 *
 * **`Appraisal` carries no `orgId`**, so it is not covered by the org-scope
 * extension — the "tenancy travels through a parent" case that
 * `ORG_SCOPED_MODELS` names explicitly. Every query here filters through
 * `sheet: { orgId, cycleId }`, and that join is load-bearing rather than
 * decorative.
 */

import type { AuditActor } from '@aura/core';

import type { ScopedPrisma } from '../db/scoped.js';
import { AppraisalStateError, onScale, readScale, scoreOf, type RatingScale } from './appraisals.js';
import { withAudit } from './withAudit.js';

/**
 * How far a manager's mean must sit from the organization's to be an outlier,
 * as a fraction of the scale's range.
 *
 * A fraction rather than a fixed number of points, because "0.4 away" means
 * something different on a 1–3 scale than on a 1–10 one. 15% of the range is
 * about half a point on a five-point scale — far enough to be worth a question,
 * close enough that it does not only fire on the extremes.
 */
export const OUTLIER_FRACTION = 0.15;

/** The default US-704 divergence threshold, also as a fraction of the range. */
export const DIVERGENCE_FRACTION = 0.25;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * US-801, US-704 — everything a calibration meeting is run from.
 *
 * The distribution and the per-manager aggregates are computed by Postgres
 * (`groupBy`), not by pulling every row into Node and counting. The divergence
 * list does load goals, because a computed score is the W2-01 engine's answer
 * and the engine lives in TypeScript — but it loads only the appraisals a
 * manager has actually rated, which is the population the question is about.
 */
export async function calibrationView(
  db: ScopedPrisma,
  orgId: string,
  cycleId: string,
  options: { divergenceThreshold?: number } = {},
) {
  const cycle = await db.reviewCycle.findUniqueOrThrow({
    where: { id: cycleId },
    select: { ratingScale: true },
  });

  const scale = readScale(cycle.ratingScale);
  const range = scale.max - scale.min;
  const scope = { sheet: { orgId, cycleId } } as const;

  const [byRating, byManagerRows, total] = await Promise.all([
    db.appraisal.groupBy({
      by: ['finalRating'],
      where: { ...scope, finalRating: { not: null } },
      _count: { _all: true },
    }),
    db.appraisal.groupBy({
      by: ['managerId'],
      where: { ...scope, finalRating: { not: null } },
      _count: { _all: true },
      _avg: { finalRating: true },
    }),
    db.appraisal.count({ where: { ...scope, finalRating: { not: null } } }),
  ]);

  const counts = new Map(byRating.map((row) => [row.finalRating, row._count._all]));
  const distribution = Array.from({ length: range + 1 }, (_, index) => ({
    rating: scale.min + index,
    // Every point on the scale appears, including the ones nobody scored. A
    // distribution with holes in it reads as missing data rather than as zero.
    count: counts.get(scale.min + index) ?? 0,
  }));

  const managers = await db.user.findMany({
    where: { id: { in: byManagerRows.flatMap((row) => (row.managerId === null ? [] : [row.managerId])) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(managers.map((manager) => [manager.id, manager.name]));

  const weighted = byManagerRows.reduce(
    (sum, row) => sum + (row._avg.finalRating ?? 0) * row._count._all,
    0,
  );
  const orgMean = total === 0 ? 0 : weighted / total;

  const byManager = byManagerRows.map((row) => {
    const mean = row._avg.finalRating ?? 0;

    return {
      managerId: row.managerId,
      managerName: row.managerId === null ? 'Unassigned' : (nameOf.get(row.managerId) ?? 'Unknown'),
      count: row._count._all,
      mean: round2(mean),
      outlier: Math.abs(mean - orgMean) > OUTLIER_FRACTION * range,
    };
  });

  return {
    cycleId,
    scale,
    distribution,
    byManager,
    orgMean: round2(orgMean),
    divergences: await divergences(db, orgId, cycleId, scale, options.divergenceThreshold),
    total,
  };
}

/**
 * US-704 — appraisals where the manager and the engine disagree markedly.
 *
 * The computed score is put on the cycle's scale first, so the comparison is
 * between two numbers that mean the same thing. Comparing a 0–1 score with a
 * 1–5 rating directly would flag every appraisal ever written.
 */
async function divergences(
  db: ScopedPrisma,
  orgId: string,
  cycleId: string,
  scale: RatingScale,
  threshold?: number,
) {
  const limit = threshold ?? DIVERGENCE_FRACTION * (scale.max - scale.min);

  const rated = await db.appraisal.findMany({
    where: { sheet: { orgId, cycleId }, managerRating: { not: null } },
    select: {
      id: true,
      managerId: true,
      managerRating: true,
      sheet: {
        select: {
          id: true,
          userId: true,
          user: { select: { name: true } },
          goals: {
            select: {
              id: true,
              uom: true,
              direction: true,
              target: true,
              actualAchievement: true,
              status: true,
              weightage: true,
            },
          },
        },
      },
    },
  });

  return rated
    .flatMap((appraisal) => {
      const managerRating = appraisal.managerRating;

      if (managerRating === null) {
        return [];
      }

      const computedScore = scoreOf(appraisal.sheet.goals);
      const computedOnScale = onScale(computedScore, scale);
      const gap = Math.abs(computedOnScale - managerRating);

      if (gap <= limit) {
        return [];
      }

      return [
        {
          appraisalId: appraisal.id,
          sheetId: appraisal.sheet.id,
          userId: appraisal.sheet.userId,
          userName: appraisal.sheet.user.name,
          managerId: appraisal.managerId,
          computedScore: round2(computedScore),
          computedOnScale: round2(computedOnScale),
          managerRating,
          divergence: round2(gap),
        },
      ];
    })
    .sort((a, b) => b.divergence - a.divergence);
}

/**
 * US-803 — lock calibration and release results, in one action.
 *
 * Refuses outright when any appraisal in the cycle has no final rating.
 * Releasing an unrated appraisal publishes an empty result to someone who has
 * been waiting for it, and "release everything except the ones that are not
 * ready" is a state nobody can describe afterwards. The unfinished ones come
 * back named, which is the pre-release report the story asks for.
 *
 * Atomic: every `releasedAt`, every notification and the audit row commit
 * together. A half-released cycle would mean some people learned their rating
 * and others were told the results were out and shown nothing.
 */
export async function releaseResults(db: ScopedPrisma, actor: AuditActor, cycleId: string) {
  return withAudit(
    db,
    actor,
    { action: 'cycle.release', entityType: 'ReviewCycle', entityId: cycleId },
    async (tx) => {
      const scope = { sheet: { orgId: actor.orgId, cycleId } } as const;

      const incomplete = await tx.appraisal.findMany({
        where: { ...scope, finalRating: null, releasedAt: null },
        select: { sheetId: true, sheet: { select: { user: { select: { name: true } } } } },
      });

      if (incomplete.length > 0) {
        throw new AppraisalStateError(
          'NOT_RATED',
          'Some appraisals have no final rating, so results cannot be released.',
          incomplete.map((row) => row.sheet.user.name),
        );
      }

      const pending = await tx.appraisal.findMany({
        where: { ...scope, releasedAt: null },
        select: { id: true, sheet: { select: { userId: true } } },
      });

      if (pending.length === 0) {
        throw new AppraisalStateError(
          'ALREADY_RELEASED',
          'There is nothing left to release in this cycle.',
        );
      }

      const releasedAt = new Date();

      await tx.appraisal.updateMany({
        where: { id: { in: pending.map((row) => row.id) } },
        data: { releasedAt },
      });

      for (const appraisal of pending) {
        await tx.notification.create({
          data: {
            orgId: actor.orgId,
            userId: appraisal.sheet.userId,
            type: 'appraisal.released',
            channel: 'IN_APP',
            payload: { appraisalId: appraisal.id, cycleId },
          },
        });
      }

      const value = { released: pending.length, incomplete: [] as { sheetId: string; userName: string }[] };

      return {
        value,
        before: { releasedCount: 0 },
        after: { releasedCount: pending.length, releasedAt },
      };
    },
  );
}

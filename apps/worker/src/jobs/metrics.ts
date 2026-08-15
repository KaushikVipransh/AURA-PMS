/**
 * The nightly cycle-metrics snapshot (PRD §8) — W5-07.
 *
 * **Every number here is derivable from the live tables today, and only
 * today.** Once a sheet is approved, "how many were approved within 14 days of
 * the cycle opening" stops being answerable, because the row no longer
 * remembers what it looked like on day 14. A trend line needs history, and
 * history has to be written as it happens — which is the same reason
 * `SheetRevision` exists and the same reason the prototype could not answer
 * anything about the past.
 *
 * Counted in SQL. A metrics job that loaded every sheet to count them would be
 * F-13 rebuilt in a place nobody looks.
 */

import { prisma } from '@aura/db';
import { scoreSheet } from '@aura/core';

/**
 * The divergence threshold for §8.4, as a fraction of the rating scale.
 *
 * The same 25% the calibration view uses (`DIVERGENCE_FRACTION`). Two different
 * thresholds for "the manager and the engine disagree" would make the metric
 * and the screen it is measured against tell different stories.
 */
export const METRIC_DIVERGENCE_FRACTION = 0.25;

export type MetricsResult = {
  readonly cyclesSnapshotted: number;
  readonly capturedOn: Date;
};

/** The UTC midnight of an instant — the day a snapshot belongs to. */
export function civilDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

type CountRow = { readonly bucket: string; readonly count: number };

/**
 * Snapshot every active cycle's metrics for the given day.
 *
 * Idempotent: `@@unique([cycleId, capturedOn])` makes this an upsert, so a
 * cron that fires twice updates the day's row rather than putting a step in
 * the graph.
 */
export async function runMetricsSnapshot(now: Date = new Date()): Promise<MetricsResult> {
  const capturedOn = civilDay(now);

  const cycles = await prisma.reviewCycle.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, orgId: true, ratingScale: true },
  });

  for (const cycle of cycles) {
    const rows = await prisma.$queryRaw<CountRow[]>`
      WITH scoped AS (
        SELECT s.id, s.status, s."userId"
        FROM goal_sheets s
        WHERE s."orgId" = ${cycle.orgId} AND s."cycleId" = ${cycle.id}
      )
      SELECT 'totalEmployees' AS bucket,
             (SELECT COUNT(*)::int FROM users
              WHERE "orgId" = ${cycle.orgId} AND status <> 'DEACTIVATED') AS count
      UNION ALL
      SELECT 'sheetsSubmitted',
             (SELECT COUNT(*)::int FROM scoped WHERE status IN ('PENDING', 'APPROVED'))
      UNION ALL
      SELECT 'sheetsApproved', (SELECT COUNT(*)::int FROM scoped WHERE status = 'APPROVED')
      UNION ALL
      SELECT 'sheetsReturned', (SELECT COUNT(*)::int FROM scoped WHERE status = 'RETURNED')
      UNION ALL
      /* A check-in is an actual recorded against a goal, which is the only
         evidence the system has that one happened. */
      SELECT 'checkInsRecorded',
             (SELECT COUNT(*)::int FROM goals g
              JOIN scoped s ON s.id = g."sheetId"
              WHERE g."actualAchievement" IS NOT NULL)
      UNION ALL
      SELECT 'sheetsWithComments',
             (SELECT COUNT(DISTINCT c."sheetId")::int FROM sheet_comments c
              JOIN scoped s ON s.id = c."sheetId"
              WHERE c."deletedAt" IS NULL)
      UNION ALL
      SELECT 'selfAppraisalsOnTime',
             (SELECT COUNT(*)::int FROM appraisals a
              JOIN scoped s ON s.id = a."sheetId"
              WHERE a."selfSubmittedAt" IS NOT NULL)
      UNION ALL
      SELECT 'ratingsTotal',
             (SELECT COUNT(*)::int FROM appraisals a
              JOIN scoped s ON s.id = a."sheetId"
              WHERE a."managerRating" IS NOT NULL)
      UNION ALL
      SELECT 'ratingsDisputed',
             (SELECT COUNT(*)::int FROM appraisals a
              JOIN scoped s ON s.id = a."sheetId"
              WHERE a."disputedAt" IS NOT NULL)
      UNION ALL
      SELECT 'openEscalations',
             (SELECT COUNT(*)::int FROM escalations
              WHERE "orgId" = ${cycle.orgId} AND "cycleId" = ${cycle.id} AND status = 'ACTIVE')
      UNION ALL
      /*
       * The north star (§8.1): approved goals, at least one check-in, and a
       * submitted self-appraisal. All three, per person -- a count of people
       * who finished, not of people who did any one step.
       */
      SELECT 'completedFullCycle',
             (SELECT COUNT(*)::int FROM scoped s
              WHERE s.status = 'APPROVED'
                AND EXISTS (SELECT 1 FROM goals g
                            WHERE g."sheetId" = s.id AND g."actualAchievement" IS NOT NULL)
                AND EXISTS (SELECT 1 FROM appraisals a
                            WHERE a."sheetId" = s.id AND a."selfSubmittedAt" IS NOT NULL))
    `;

    const countOf = (bucket: string): number =>
      rows.find((row) => row.bucket === bucket)?.count ?? 0;

    await prisma.cycleMetrics.upsert({
      where: { cycleId_capturedOn: { cycleId: cycle.id, capturedOn } },
      create: {
        orgId: cycle.orgId,
        cycleId: cycle.id,
        capturedOn,
        ...counters(countOf),
        divergentRatings: await countDivergent(cycle),
      },
      update: {
        ...counters(countOf),
        divergentRatings: await countDivergent(cycle),
      },
    });
  }

  return { cyclesSnapshotted: cycles.length, capturedOn };
}

function counters(countOf: (bucket: string) => number) {
  return {
    totalEmployees: countOf('totalEmployees'),
    completedFullCycle: countOf('completedFullCycle'),
    sheetsSubmitted: countOf('sheetsSubmitted'),
    sheetsApproved: countOf('sheetsApproved'),
    sheetsReturned: countOf('sheetsReturned'),
    checkInsRecorded: countOf('checkInsRecorded'),
    sheetsWithComments: countOf('sheetsWithComments'),
    selfAppraisalsOnTime: countOf('selfAppraisalsOnTime'),
    ratingsTotal: countOf('ratingsTotal'),
    ratingsDisputed: countOf('ratingsDisputed'),
    openEscalations: countOf('openEscalations'),
  };
}

/**
 * §8.4 — ratings far from what the goals say.
 *
 * Kept out of the SQL above on purpose. The computed score is the W2-01
 * engine's answer, and the engine is TypeScript; re-implementing its formula in
 * SQL to save a query would put a second scoring rule in the system, which is
 * exactly the divergence F-07 was.
 */
async function countDivergent(cycle: { id: string; orgId: string; ratingScale: unknown }): Promise<number> {
  const raw = cycle.ratingScale as { min?: unknown; max?: unknown } | null;

  if (raw === null || typeof raw.min !== 'number' || typeof raw.max !== 'number') {
    // A cycle with no usable scale has no scale to diverge from. Zero rather
    // than a throw: one malformed cycle should not stop the nightly snapshot
    // for every other one.
    return 0;
  }

  const scale = { min: raw.min, max: raw.max };
  const range = scale.max - scale.min;
  const limit = METRIC_DIVERGENCE_FRACTION * range;

  const rated = await prisma.appraisal.findMany({
    where: { sheet: { orgId: cycle.orgId, cycleId: cycle.id }, managerRating: { not: null } },
    select: {
      managerRating: true,
      sheet: {
        select: {
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

  return rated.filter((appraisal) => {
    if (appraisal.managerRating === null) {
      return false;
    }

    const { score } = scoreSheet(
      appraisal.sheet.goals.map((goal) => ({
        id: goal.id,
        uom: goal.uom,
        direction: goal.direction,
        target: goal.target,
        actualAchievement: goal.actualAchievement,
        status: goal.status,
        weightage: goal.weightage.toString(),
      })),
    );

    const onScale = scale.min + score * range;

    return Math.abs(onScale - appraisal.managerRating) > limit;
  }).length;
}

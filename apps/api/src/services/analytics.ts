/**
 * Analytics (PRD US-1001) — **closes F-13**.
 *
 * The prototype answered this by pulling every sheet into Node and counting
 * with `forEach`, which is O(rows) memory in a serverless function and gets
 * slower in exactly the situation analytics matters: a large organization at
 * the end of a cycle. Counting is what a database is for.
 *
 * Everything here is one query. Not three, and not one per dimension: a
 * `UNION ALL` of grouped selects returns every distribution in a single round
 * trip, and Postgres scans the join once per branch rather than the client
 * paying network latency four times. The gate on this task is 10,000 sheets in
 * under 500 ms, and the shape of the query is what makes that unremarkable.
 *
 * **Raw SQL is outside the org-scope extension** — see the same warning in
 * `orgchart.ts`. `orgId` is a required parameter and appears in the `WHERE`
 * clause, alongside the cycle.
 */

import type { ScopedPrisma } from '../db/scoped.js';

export type AnalyticsFilters = {
  readonly teamId?: string | undefined;
  readonly managerId?: string | undefined;
};

type Row = { readonly dimension: string; readonly bucket: string; readonly count: number };

export type AnalyticsBucket = { readonly bucket: string; readonly count: number };

/**
 * Distribution across thrust area, unit of measure, goal status and sheet
 * status, for one cycle.
 *
 * `teamId` and `managerId` are applied to the sheet's *owner*, not to the
 * sheet, because "my team's goals" means the goals of the people on my team.
 * Both are interpolated as parameters and both are nullable in the SQL, which
 * is how one query serves the filtered and unfiltered cases without building
 * the string by hand — a query assembled from concatenated fragments is how
 * injection gets in, and there is no reason to write one here.
 */
export async function cycleAnalytics(
  db: ScopedPrisma,
  orgId: string,
  cycleId: string,
  filters: AnalyticsFilters = {},
) {
  const teamId = filters.teamId ?? null;
  const managerId = filters.managerId ?? null;

  const rows = await db.$queryRaw<Row[]>`
    WITH scoped AS (
      SELECT s.id, s.status
      FROM goal_sheets s
      JOIN users u ON u.id = s."userId"
      WHERE s."orgId" = ${orgId}
        AND s."cycleId" = ${cycleId}
        AND (${teamId}::text IS NULL OR u."teamId" = ${teamId})
        AND (${managerId}::text IS NULL OR u."managerId" = ${managerId})
    ),
    scoped_goals AS (
      SELECT g."thrustArea", g.uom, g.status
      FROM goals g
      JOIN scoped s ON s.id = g."sheetId"
    )
    SELECT 'thrustArea' AS dimension, "thrustArea"::text AS bucket, COUNT(*)::int AS count
    FROM scoped_goals GROUP BY "thrustArea"
    UNION ALL
    SELECT 'uom', uom::text, COUNT(*)::int FROM scoped_goals GROUP BY uom
    UNION ALL
    SELECT 'goalStatus', status::text, COUNT(*)::int FROM scoped_goals GROUP BY status
    UNION ALL
    SELECT 'sheetStatus', status::text, COUNT(*)::int FROM scoped GROUP BY status
    UNION ALL
    SELECT 'total', 'sheets', COUNT(*)::int FROM scoped
    UNION ALL
    SELECT 'total', 'goals', COUNT(*)::int FROM scoped_goals
  `;

  const pick = (dimension: string): AnalyticsBucket[] =>
    rows
      .filter((row) => row.dimension === dimension)
      .map((row) => ({ bucket: row.bucket, count: row.count }))
      .sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket));

  const totalOf = (bucket: string): number =>
    rows.find((row) => row.dimension === 'total' && row.bucket === bucket)?.count ?? 0;

  return {
    cycleId,
    totalSheets: totalOf('sheets'),
    totalGoals: totalOf('goals'),
    byThrustArea: pick('thrustArea'),
    byUom: pick('uom'),
    byGoalStatus: pick('goalStatus'),
    bySheetStatus: pick('sheetStatus'),
  };
}

/**
 * US-903 — the live compliance dashboard for a cycle.
 *
 * Counts only, and again in one query. A dashboard that loaded the rows it was
 * counting would be the same mistake as F-13 wearing a different name.
 */
export async function complianceSummary(db: ScopedPrisma, orgId: string, cycleId: string) {
  const rows = await db.$queryRaw<Row[]>`
    WITH scoped AS (
      SELECT s.id, s.status
      FROM goal_sheets s
      WHERE s."orgId" = ${orgId} AND s."cycleId" = ${cycleId}
    )
    SELECT 'count' AS dimension, 'users' AS bucket,
           (SELECT COUNT(*)::int FROM users WHERE "orgId" = ${orgId} AND status <> 'DEACTIVATED') AS count
    UNION ALL
    SELECT 'count', 'submitted',
           (SELECT COUNT(*)::int FROM scoped WHERE status IN ('PENDING', 'APPROVED'))
    UNION ALL
    SELECT 'count', 'approved', (SELECT COUNT(*)::int FROM scoped WHERE status = 'APPROVED')
    UNION ALL
    SELECT 'count', 'selfAppraisals',
           (SELECT COUNT(*)::int FROM appraisals a
            JOIN scoped s ON s.id = a."sheetId"
            WHERE a."selfSubmittedAt" IS NOT NULL)
    UNION ALL
    SELECT 'count', 'managerRatings',
           (SELECT COUNT(*)::int FROM appraisals a
            JOIN scoped s ON s.id = a."sheetId"
            WHERE a."managerSubmittedAt" IS NOT NULL)
    UNION ALL
    SELECT 'tier', tier::text, COUNT(*)::int
    FROM escalations
    WHERE "orgId" = ${orgId} AND "cycleId" = ${cycleId} AND status = 'ACTIVE'
    GROUP BY tier
  `;

  const countOf = (bucket: string): number =>
    rows.find((row) => row.dimension === 'count' && row.bucket === bucket)?.count ?? 0;

  const byTier = Object.fromEntries(
    rows.filter((row) => row.dimension === 'tier').map((row) => [row.bucket, row.count]),
  );

  return {
    cycleId,
    totalUsers: countOf('users'),
    sheetsSubmitted: countOf('submitted'),
    sheetsApproved: countOf('approved'),
    selfAppraisalsComplete: countOf('selfAppraisals'),
    managerRatingsComplete: countOf('managerRatings'),
    openEscalations: Object.values(byTier).reduce((sum, count) => sum + count, 0),
    byTier,
  };
}

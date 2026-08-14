/**
 * The reporting tree, walked in the database rather than in Node (W4-04).
 *
 * Both queries here are `WITH RECURSIVE` CTEs, and that is the point of the
 * task. The version this replaces — still visible in `git log` as the loop
 * inside `loadSheetWithChain` — issued one `findUnique` per level, so resolving
 * a five-deep chain cost five round trips and a fifteen-deep one cost fifteen.
 * The tree is the database's natural unit of work; asking for it a row at a
 * time is asking the wrong question quickly.
 *
 * **Raw SQL is not covered by the org-scope extension** (`db/scoped.ts`). The
 * extension intercepts Prisma's model operations, and `$queryRaw` goes past it
 * to the driver. So `orgId` is a required parameter of every function in this
 * file and appears in the `WHERE` clause of **both** the anchor and the
 * recursive term — the second one matters, because filtering only the anchor
 * would let the walk step through a manager in another organization and out
 * the other side, which is F-02 with extra steps.
 *
 * Only ids come back. The rows themselves are fetched through the scoped client
 * by the callers, so the tenancy filter that this file has to state by hand is
 * still enforced by the query pipeline for everything a client actually reads.
 */

import type { ScopedPrisma } from '../db/scoped.js';

/**
 * Anything that can run a raw query — the scoped client or a transaction of it.
 *
 * Narrowed to the one method these functions use, so a caller inside
 * `withAudit` can pass its transactional client and have the walk join the same
 * transaction as the write it informs.
 */
export type RawClient = Pick<ScopedPrisma, '$queryRaw'>;

/**
 * How far either walk will go before giving up.
 *
 * A recursive CTE over cyclic data does not terminate on its own, and
 * `A → B → A` is a legal state: the composite foreign key stops a manager from
 * another organization, but nothing stops two people managing each other after
 * a badly ordered reorganisation. The visited-set guard below already breaks
 * such a cycle; this is the second line, for the case where the guard is the
 * thing that is wrong.
 */
export const MAX_CHAIN_DEPTH = 50;

type WalkRow = { readonly id: string; readonly depth: number };
type SubtreeRow = WalkRow & { readonly managerId: string | null };

export type OrgChartEntry = {
  readonly userId: string;
  /** Steps from the root of the walk. The root itself is 0. */
  readonly depth: number;
  /**
   * Their manager, carried so the caller can reconstruct any path inside the
   * subtree without going back to the database. `can()` needs a real reporting
   * chain to tell DIRECT_REPORT from INDIRECT_REPORT, and asking for one per
   * person would put the N+1 back that this file exists to remove.
   */
  readonly managerId: string | null;
};

/**
 * Everyone above someone in the reporting line, nearest manager first.
 *
 * This is what `can()` needs to tell DIRECT_REPORT from INDIRECT_REPORT from
 * SAME_ORG (W2-06) — the difference between "a manager" and "*their* manager",
 * which is the whole of the approval permission model.
 *
 * The subject is excluded. A chain that contained the person themselves would
 * make everyone their own manager, and `relationshipOf` would answer
 * DIRECT_REPORT for a self-approval.
 */
export async function reportingChain(
  db: RawClient,
  orgId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<WalkRow[]>`
    WITH RECURSIVE chain AS (
      SELECT u.id, u."managerId", 0 AS depth, ARRAY[u.id] AS seen
      FROM users u
      WHERE u.id = ${userId} AND u."orgId" = ${orgId}

      UNION ALL

      SELECT m.id, m."managerId", c.depth + 1, c.seen || m.id
      FROM users m
      JOIN chain c ON m.id = c."managerId"
      WHERE m."orgId" = ${orgId}
        AND NOT (m.id = ANY(c.seen))
        AND c.depth < ${MAX_CHAIN_DEPTH}::int
    )
    SELECT id, depth FROM chain WHERE depth > 0 ORDER BY depth ASC
  `;

  return rows.map((row) => row.id);
}

/**
 * Someone and everyone who reports to them, however far down (US-1003).
 *
 * The root is included at depth 0, because a rollup that excluded the manager
 * asking for it would not add up to their team.
 */
export async function reportingSubtree(
  db: RawClient,
  orgId: string,
  rootId: string,
): Promise<OrgChartEntry[]> {
  const rows = await db.$queryRaw<SubtreeRow[]>`
    WITH RECURSIVE subtree AS (
      SELECT u.id, u."managerId", 0 AS depth, ARRAY[u.id] AS seen
      FROM users u
      WHERE u.id = ${rootId} AND u."orgId" = ${orgId}

      UNION ALL

      SELECT r.id, r."managerId", s.depth + 1, s.seen || r.id
      FROM users r
      JOIN subtree s ON r."managerId" = s.id
      WHERE r."orgId" = ${orgId}
        AND NOT (r.id = ANY(s.seen))
        AND s.depth < ${MAX_CHAIN_DEPTH}::int
    )
    SELECT id, "managerId", depth FROM subtree ORDER BY depth ASC, id ASC
  `;

  return rows.map((row) => ({ userId: row.id, depth: row.depth, managerId: row.managerId }));
}

/**
 * The reporting path from someone up to the root of a subtree already walked.
 *
 * Pure, and takes the walk's own output — so it costs nothing beyond the one
 * query that produced it. Returns `[]` for anyone outside the subtree, which is
 * the correct chain to hand `can()` for a colleague: no reporting line between
 * them means `SAME_ORG`, not a weaker version of `INDIRECT_REPORT`.
 */
export function chainWithin(
  entries: readonly OrgChartEntry[],
  userId: string,
  rootId: string,
): string[] {
  const managerOf = new Map(entries.map((entry) => [entry.userId, entry.managerId]));

  if (!managerOf.has(userId) || userId === rootId) {
    return [];
  }

  const chain: string[] = [];
  let current = managerOf.get(userId) ?? null;

  while (current !== null && chain.length < MAX_CHAIN_DEPTH) {
    chain.push(current);

    if (current === rootId) {
      break;
    }
    current = managerOf.get(current) ?? null;
  }

  return chain;
}

/**
 * A team and every team nested beneath it.
 *
 * Used by the shared-goal cascade when a manager opts into `includeSubTeams`
 * (US-401). The same guards apply for the same reasons: `Team.parentTeam` is a
 * self-relation with no cycle constraint, so `A → B → A` is representable and
 * a naive CTE over it would never return.
 */
export async function descendantTeamIds(
  db: RawClient,
  orgId: string,
  rootTeamId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<WalkRow[]>`
    WITH RECURSIVE tree AS (
      SELECT t.id, 0 AS depth, ARRAY[t.id] AS seen
      FROM teams t
      WHERE t.id = ${rootTeamId} AND t."orgId" = ${orgId}

      UNION ALL

      SELECT c.id, p.depth + 1, p.seen || c.id
      FROM teams c
      JOIN tree p ON c."parentTeamId" = p.id
      WHERE c."orgId" = ${orgId}
        AND NOT (c.id = ANY(p.seen))
        AND p.depth < ${MAX_CHAIN_DEPTH}::int
    )
    SELECT id, depth FROM tree ORDER BY depth ASC, id ASC
  `;

  return rows.map((row) => row.id);
}

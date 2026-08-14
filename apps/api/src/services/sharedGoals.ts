/**
 * Shared goals and the cascade (PRD US-401, US-402, US-403) — closes F-05.
 *
 * Three things the prototype got wrong, and what replaces each:
 *
 *   - It resolved the primary owner by lowercased display-name comparison, so
 *     two people called "A. Kumar" both became owner and a rename broke the
 *     link silently. Ownership here is a `userId` throughout; no function in
 *     this file ever compares a name.
 *   - It resolved the audience by scanning every record it could find. The
 *     audience here is a named team, a named role, or a listed set of people —
 *     there is deliberately no "everyone" option in the contract — and it is
 *     then narrowed to the people the actor is actually permitted to reach.
 *   - It wrote the instances row by row with no prior check, so a push to
 *     twelve people could leave four of them holding an invalid sheet with no
 *     record of which four. `planCascade` (W2-07) decides the whole thing
 *     before a single row is written.
 *
 * **Preview and commit cannot disagree**, because `resolvePlan` below is the
 * only implementation of "who would receive this" and both paths call it. A
 * preview using different arithmetic to the commit would be worse than no
 * preview: it would be a promise the system does not keep.
 */

import {
  can,
  planCascade,
  type Actor,
  type AuditActor,
  type CascadePlan,
  type CascadeSkip,
} from '@aura/core';
import type { CreateSharedGoalRequest, SharedGoalAudience } from '@aura/contracts';

import type { ScopedPrisma } from '../db/scoped.js';
import { chainWithin, descendantTeamIds, reportingSubtree } from './orgchart.js';
import type { AuditedTx } from './withAudit.js';
import { withAudit } from './withAudit.js';

/**
 * The id a plan is built against before the goal has one.
 *
 * `planCascade` compares it to the `sharedGoalId` on each existing goal to spot
 * a duplicate. Every real id is a cuid, so this sentinel cannot collide with
 * one — and a goal that does not exist yet is on nobody's sheet anyway, which
 * is why the preview and the commit reach the same answer despite using
 * different ids.
 */
const UNSAVED = '__unsaved__';

/** A sheet that can still take a new goal. Anything else is locked (US-403). */
const EDITABLE_SHEET_STATUSES = new Set(['DRAFT', 'RETURNED']);

const SHARED_GOAL_VIEW = {
  id: true,
  orgId: true,
  cycleId: true,
  ownerUserId: true,
  createdById: true,
  title: true,
  thrustArea: true,
  uom: true,
  direction: true,
  target: true,
  defaultWeightage: true,
} as const;

export class CascadeRefusedError extends Error {
  readonly code:
    | 'UNKNOWN_OWNER'
    | 'UNKNOWN_CYCLE'
    | 'EMPTY_AUDIENCE'
    | 'NO_REACH'
    | 'OWNER_OUT_OF_REACH'
    | 'OWNER_HAS_NO_ROOM';
  readonly detail: readonly string[];

  constructor(code: CascadeRefusedError['code'], message: string, detail: readonly string[] = []) {
    super(message);
    this.name = 'CascadeRefusedError';
    this.code = code;
    this.detail = detail;
  }
}

/** The scoped client, or a transaction of it. Both can read and walk trees. */
type Db = ScopedPrisma | AuditedTx;

const ids = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

/**
 * Turn an audience into a list of user ids.
 *
 * Deactivated people are excluded. Cascading a goal to someone who has left is
 * how a compliance dashboard ends up permanently red over a sheet nobody will
 * ever fill in (US-901).
 */
export async function resolveAudience(
  db: Db,
  orgId: string,
  audience: SharedGoalAudience,
): Promise<string[]> {
  if (audience.kind === 'USERS') {
    return ids(
      await db.user.findMany({
        where: { id: { in: [...audience.userIds] }, status: { not: 'DEACTIVATED' } },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );
  }

  if (audience.kind === 'ROLE') {
    return ids(
      await db.user.findMany({
        where: { roles: { has: audience.role }, status: { not: 'DEACTIVATED' } },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );
  }

  const teamIds = audience.includeSubTeams
    ? await descendantTeamIds(db, orgId, audience.teamId)
    : [audience.teamId];

  return ids(
    await db.user.findMany({
      where: { teamId: { in: teamIds }, status: { not: 'DEACTIVATED' } },
      select: { id: true },
      orderBy: { id: 'asc' },
    }),
  );
}

/**
 * Split an audience into the people this actor may cascade to, and the rest.
 *
 * One recursive walk of the actor's own subtree answers it for everybody:
 * `chainWithin` reconstructs each recipient's real reporting path from that
 * single result, so `can()` is asked the same question it is asked everywhere
 * else, with real data, and without a query per person.
 *
 * The actor themselves is always permitted. `CASCADE_SHARED_GOAL` excludes
 * `SELF` — pushing work onto your own manager's sheet is not a thing — but
 * putting a goal on your *own* sheet is `EDIT_GOAL_SHEET`, which everyone has,
 * and a manager who owns the departmental KPI they are cascading is the normal
 * case rather than the exception.
 */
async function partitionByReach(
  db: Db,
  actor: Actor,
  userIds: readonly string[],
): Promise<{ permitted: string[]; refused: CascadeSkip[] }> {
  const subtree = await reportingSubtree(db, actor.orgId, actor.userId);
  const permitted: string[] = [];
  const refused: CascadeSkip[] = [];

  for (const userId of userIds) {
    const allowed =
      userId === actor.userId ||
      can(actor, 'CASCADE_SHARED_GOAL', {
        orgId: actor.orgId,
        subjectUserId: userId,
        managerChainIds: chainWithin(subtree, userId, actor.userId),
      });

    if (allowed) {
      permitted.push(userId);
    } else {
      refused.push({
        userId,
        reason: 'NOT_IN_YOUR_LINE',
        detail: 'They do not report to you, so you cannot put a goal on their sheet.',
      });
    }
  }

  return { permitted, refused };
}

type SheetSummary = {
  readonly id: string | null;
  readonly editable: boolean;
  readonly goals: readonly { sharedGoalId: string | null; weightage: string }[];
};

/** Every candidate's sheet for the cycle, in one query rather than N. */
async function sheetsFor(
  db: Db,
  cycleId: string,
  userIds: readonly string[],
): Promise<Map<string, SheetSummary>> {
  const sheets = await db.goalSheet.findMany({
    where: { cycleId, userId: { in: [...userIds] } },
    select: {
      id: true,
      userId: true,
      status: true,
      goals: { select: { sharedGoalId: true, weightage: true } },
    },
  });

  const byUser = new Map<string, SheetSummary>();

  for (const sheet of sheets) {
    byUser.set(sheet.userId, {
      id: sheet.id,
      editable: EDITABLE_SHEET_STATUSES.has(sheet.status),
      goals: sheet.goals.map((goal) => ({
        sharedGoalId: goal.sharedGoalId,
        weightage: goal.weightage.toString(),
      })),
    });
  }

  // Someone with no sheet yet has an empty, editable one waiting to be made.
  for (const userId of userIds) {
    if (!byUser.has(userId)) {
      byUser.set(userId, { id: null, editable: true, goals: [] });
    }
  }

  return byUser;
}

type ResolvedPlan = {
  readonly plan: CascadePlan;
  readonly sheets: Map<string, SheetSummary>;
  readonly ownerSheet: SheetSummary;
};

/**
 * Everything both the preview and the commit need to know, decided once.
 *
 * Validates the request, resolves and narrows the audience, loads the sheets
 * and runs the W2-07 planner. Refusals from the reach check are prepended to
 * the planner's own, so the caller sees one list ordered the way a manager
 * would ask about it: "who did not get it, and why".
 */
async function resolvePlan(
  db: Db,
  actor: Actor,
  sharedGoalId: string,
  input: CreateSharedGoalRequest,
): Promise<ResolvedPlan> {
  if ((await db.reviewCycle.count({ where: { id: input.cycleId } })) === 0) {
    throw new CascadeRefusedError('UNKNOWN_CYCLE', 'That cycle is not part of this organization.');
  }

  if ((await db.user.count({ where: { id: input.ownerUserId } })) === 0) {
    throw new CascadeRefusedError('UNKNOWN_OWNER', 'That owner is not part of this organization.');
  }

  const audience = await resolveAudience(db, actor.orgId, input.audience);

  if (audience.length === 0) {
    throw new CascadeRefusedError(
      'EMPTY_AUDIENCE',
      'That audience resolves to nobody. Nothing would be cascaded.',
    );
  }

  const reach = await partitionByReach(db, actor, [
    ...new Set([...audience, input.ownerUserId]),
  ]);

  /*
   * The authorisation gate for the endpoint, expressed as data rather than as
   * a role check at the router.
   *
   * `CASCADE_SHARED_GOAL` grants MANAGER only DIRECT_REPORT and INDIRECT_REPORT,
   * so "may this person cascade at all" has no answer in the abstract — it
   * depends on who they are cascading to. An employee whose audience is their
   * own team reaches nobody in it and is refused here; a manager reaches their
   * line; an administrator reaches the organization. One rule, asked of the
   * actual audience.
   */
  if (reach.permitted.every((userId) => userId === actor.userId)) {
    throw new CascadeRefusedError(
      'NO_REACH',
      'Nobody in that audience reports to you, so there is nobody to cascade to.',
    );
  }

  if (!reach.permitted.includes(input.ownerUserId)) {
    // The owner holds the primary instance, so a goal whose owner is out of
    // reach has nowhere to put the one instance that makes US-403 enforceable.
    throw new CascadeRefusedError(
      'OWNER_OUT_OF_REACH',
      'You cannot create a shared goal owned by someone outside your reporting line.',
    );
  }

  const sheets = await sheetsFor(db, input.cycleId, reach.permitted);
  const planned = planCascade(
    { id: sharedGoalId, ownerUserId: input.ownerUserId, weightage: input.defaultWeightage },
    reach.permitted.map((userId) => {
      const sheet = sheets.get(userId);

      return {
        userId,
        goals: sheet?.goals ?? [],
        sheetIsEditable: sheet?.editable ?? true,
      };
    }),
  );

  return {
    plan: { ...planned, skipped: [...reach.refused, ...planned.skipped] },
    sheets,
    ownerSheet: sheets.get(input.ownerUserId) ?? { id: null, editable: true, goals: [] },
  };
}

/**
 * Can the owner hold their own primary instance?
 *
 * Answered by `planCascade` rather than by a second implementation of the same
 * arithmetic, with the owner id set to something no user can be. That makes
 * every rule — the goal limit, the weightage headroom, the lock — apply to the
 * owner on exactly the terms it applies to everyone else, and leaves no place
 * for the two to drift apart.
 *
 * A shared goal whose owner has no room is refused rather than created
 * ownerless. `Goal.isPrimaryOwner` is what makes "only the owner edits actuals"
 * enforceable (US-403); a shared goal with no primary instance is a rule with
 * nothing to point at.
 */
function ownerCanHoldIt(
  sharedGoalId: string,
  weightage: number,
  ownerUserId: string,
  sheet: SheetSummary,
): { ok: true } | { ok: false; detail: string } {
  const plan = planCascade({ id: sharedGoalId, ownerUserId: '', weightage }, [
    { userId: ownerUserId, goals: sheet.goals, sheetIsEditable: sheet.editable },
  ]);

  const refusal = plan.skipped[0];

  return refusal === undefined ? { ok: true } : { ok: false, detail: refusal.detail };
}

/** Names for the ids a plan returns, so a manager reads people and not cuids. */
async function decorate(db: Db, plan: CascadePlan) {
  const everyone = [...plan.willReceive, ...plan.skipped.map((entry) => entry.userId)];
  const people = await db.user.findMany({
    where: { id: { in: everyone } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(people.map((person) => [person.id, person]));
  const describe = (userId: string) => ({
    userId,
    name: byId.get(userId)?.name ?? '',
    email: byId.get(userId)?.email ?? '',
  });

  return {
    weightage: plan.weightage,
    willReceive: plan.willReceive.map(describe),
    skipped: plan.skipped.map((entry) => ({
      ...describe(entry.userId),
      reason: entry.reason,
      detail: entry.detail,
    })),
  };
}

export type CascadeSummary = Awaited<ReturnType<typeof decorate>>;

/**
 * US-402 — what this cascade would do, without doing any of it.
 *
 * Nothing here writes. The manager sees who receives the goal and who does not,
 * with a reason for every refusal, and decides.
 *
 * Takes the full `Actor` rather than the `AuditActor` the other services take,
 * because reach is an authorisation question and `AuditActor` deliberately
 * carries no roles.
 */
export async function previewCascade(
  db: ScopedPrisma,
  actor: Actor,
  input: CreateSharedGoalRequest,
): Promise<CascadeSummary> {
  const { plan } = await resolvePlan(db, actor, UNSAVED, input);

  return decorate(db, plan);
}

/**
 * US-401, US-403 — create the shared goal and cascade it, atomically.
 *
 * Every instance, the owner's primary one, the sheets created to hold them, the
 * notifications and the audit row commit together or not at all. A partial
 * cascade is the failure this task exists to remove: it leaves some people
 * measured on a goal the others have never heard of, and no record of which
 * group anyone is in.
 */
export async function createSharedGoal(
  db: ScopedPrisma,
  actor: Actor,
  audit: AuditActor,
  input: CreateSharedGoalRequest,
) {
  return withAudit(
    db,
    audit,
    { action: 'sharedgoal.create', entityType: 'SharedGoal' },
    async (tx) => {
      const created = await tx.sharedGoal.create({
        data: {
          orgId: audit.orgId,
          cycleId: input.cycleId,
          ownerUserId: input.ownerUserId,
          createdById: audit.userId,
          title: input.title,
          thrustArea: input.thrustArea,
          uom: input.uom,
          // Inherited by every instance rather than re-derived per sheet. The
          // prototype guessed direction from the title, so one wrong guess
          // scored a whole department backwards (F-06).
          direction: input.direction,
          target: input.target,
          defaultWeightage: input.defaultWeightage,
          // Spread into a fresh object: the parsed value is a readonly
          // discriminated union and Prisma's JSON input type is not.
          audience: { ...input.audience },
        },
        select: SHARED_GOAL_VIEW,
      });

      /*
       * Planned against the real id, inside the transaction that created it.
       * The row does not exist to any other connection until this commits, so
       * a concurrent cascade cannot see half of this one.
       */
      const { plan, sheets, ownerSheet } = await resolvePlan(tx, actor, created.id, input);

      const feasible = ownerCanHoldIt(
        created.id,
        input.defaultWeightage,
        input.ownerUserId,
        ownerSheet,
      );

      if (!feasible.ok) {
        throw new CascadeRefusedError(
          'OWNER_HAS_NO_ROOM',
          'The owner cannot hold this goal, so there would be no primary instance.',
          [feasible.detail],
        );
      }

      await writeInstance(tx, {
        sharedGoalId: created.id,
        orgId: audit.orgId,
        cycleId: input.cycleId,
        userId: input.ownerUserId,
        sheetId: ownerSheet.id,
        isPrimaryOwner: true,
        goal: input,
      });

      for (const userId of plan.willReceive) {
        await writeInstance(tx, {
          sharedGoalId: created.id,
          orgId: audit.orgId,
          cycleId: input.cycleId,
          userId,
          sheetId: sheets.get(userId)?.id ?? null,
          isPrimaryOwner: false,
          goal: input,
        });

        await tx.notification.create({
          data: {
            orgId: audit.orgId,
            userId,
            type: 'sharedgoal.assigned',
            channel: 'IN_APP',
            payload: { sharedGoalId: created.id, title: input.title },
          },
        });
      }

      const cascade = await decorate(tx, plan);
      const instanceCount = await tx.goal.count({ where: { sharedGoalId: created.id } });
      const sharedGoal = {
        ...created,
        defaultWeightage: Number(created.defaultWeightage.toString()),
        instanceCount,
      };

      return { value: { sharedGoal, cascade }, after: sharedGoal, entityId: created.id };
    },
  );
}

/**
 * Put one instance of the goal on one person's sheet, making the sheet if there
 * is none.
 *
 * The sheet is created as a `DRAFT`, which is the only status a cascade may
 * produce: arriving work does not pre-approve itself.
 */
async function writeInstance(
  tx: AuditedTx,
  args: {
    readonly sharedGoalId: string;
    readonly orgId: string;
    readonly cycleId: string;
    readonly userId: string;
    readonly sheetId: string | null;
    readonly isPrimaryOwner: boolean;
    readonly goal: CreateSharedGoalRequest;
  },
): Promise<void> {
  const sheetId =
    args.sheetId ??
    (
      await tx.goalSheet.create({
        data: { orgId: args.orgId, userId: args.userId, cycleId: args.cycleId },
        select: { id: true },
      })
    ).id;

  await tx.goal.create({
    data: {
      sheetId,
      sharedGoalId: args.sharedGoalId,
      isPrimaryOwner: args.isPrimaryOwner,
      thrustArea: args.goal.thrustArea,
      title: args.goal.title,
      uom: args.goal.uom,
      direction: args.goal.direction,
      target: args.goal.target,
      weightage: args.goal.defaultWeightage,
    },
  });
}

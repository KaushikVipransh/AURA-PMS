/**
 * Bulk user import with a dry run (PRD US-205) — closes F-25.
 *
 * The acceptance criterion that shapes everything here is the last one:
 * **"partial import never leaves a broken org chart"**. A loop that creates
 * rows one at a time and stops at the first bad one satisfies "row-level
 * errors" and violates that — it leaves half a hierarchy, with reports whose
 * manager was on the line below the failure.
 *
 * So the work is split. `planImport` is pure: it takes the rows and what the
 * organization already holds, and answers what *would* happen — every row
 * classified, every reason stated. `commitImport` takes a plan and writes it
 * in one transaction. The dry run is not a second code path; it is the plan
 * without the commit, which is the only way a preview can be trusted to
 * describe the real thing.
 *
 * Managers are referenced **by email**, because the person building the
 * spreadsheet has no ids. That means a manager may appear in the same file as
 * their reports, in any order, and it means the planner has to reason about
 * references between rows that do not exist yet — which is where the two
 * interesting failures live: a row whose manager could not be imported, and a
 * set of rows that manage each other in a circle.
 */

import type { AuditActor, Role } from '@aura/core';

import type { ScopedPrisma } from '../db/scoped.js';
import { withAudit } from './withAudit.js';

export type ImportRow = {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly managerEmail: string | null;
  readonly teamName: string | null;
};

/** A row that will be created, with its references already resolved. */
export type PlannedCreate = {
  readonly row: number;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  /** An existing user's id, or null when the manager is elsewhere in the file. */
  readonly managerId: string | null;
  /** Set when the manager is another row; linked in a second pass. */
  readonly managerEmail: string | null;
  readonly teamId: string | null;
};

export type PlannedSkip = {
  readonly row: number;
  readonly email: string;
  readonly reason: string;
};

export type PlannedError = {
  readonly row: number;
  readonly email: string;
  readonly message: string;
};

export type ImportPlan = {
  readonly creates: readonly PlannedCreate[];
  readonly skipped: readonly PlannedSkip[];
  readonly errors: readonly PlannedError[];
};

export type ExistingOrg = {
  /** Everyone already in the organization, active or not. */
  readonly users: readonly { readonly id: string; readonly email: string }[];
  readonly teams: readonly { readonly id: string; readonly name: string }[];
};

/**
 * A guard on the two fixpoints below.
 *
 * Each pass either removes at least one row or stops, so neither loop can run
 * longer than there are rows — and the contract caps a file at 2000. The bound
 * is the second line, for the case where that reasoning is what is wrong.
 */
const MAX_PASSES = 2100;

const lower = (value: string): string => value.trim().toLowerCase();

/**
 * Classify every row without writing anything.
 *
 * Nothing here reads a clock, a database or a request. Given the same rows and
 * the same organization it returns the same plan, which is what makes the
 * preview and the commit the same answer rather than two attempts at one.
 */
export function planImport(rows: readonly ImportRow[], existing: ExistingOrg): ImportPlan {
  const byEmail = new Map(existing.users.map((user) => [lower(user.email), user.id]));
  const teamByName = new Map(existing.teams.map((team) => [lower(team.name), team.id]));

  const errors: PlannedError[] = [];
  const skipped: PlannedSkip[] = [];
  const candidates = new Map<string, PlannedCreate>();

  /* Every email the file mentions, whatever became of it. Used to tell "your
     manager is not in this file" from "your manager is in this file and could
     not be imported" — two different things to fix. */
  const seen = new Map<string, number>();

  rows.forEach((raw, index) => {
    const row = index + 1;
    const email = lower(raw.email);
    const earlier = seen.get(email);

    if (earlier !== undefined) {
      errors.push({
        row,
        email,
        message: `This email already appears at row ${String(earlier)} of this file.`,
      });
      return;
    }

    seen.set(email, row);

    if (byEmail.has(email)) {
      /* Not an error. Re-importing last month's roster with twenty new people
         in it is the normal way this feature gets used, and refusing the whole
         file over rows that are already correct would make it useless. */
      skipped.push({ row, email, reason: 'Already registered in this organization.' });
      return;
    }

    const teamName = raw.teamName === null ? null : lower(raw.teamName);
    const teamId = teamName === null ? null : (teamByName.get(teamName) ?? null);

    if (teamName !== null && teamId === null) {
      errors.push({
        row,
        email,
        message: `There is no team called "${raw.teamName ?? ''}". Create it first — an import does not invent teams.`,
      });
      return;
    }

    const managerEmail = raw.managerEmail === null ? null : lower(raw.managerEmail);

    if (managerEmail !== null && managerEmail === email) {
      errors.push({ row, email, message: 'Somebody cannot be their own manager.' });
      return;
    }

    candidates.set(email, {
      row,
      name: raw.name,
      email,
      role: raw.role,
      managerId: managerEmail === null ? null : (byEmail.get(managerEmail) ?? null),
      managerEmail: managerEmail !== null && !byEmail.has(managerEmail) ? managerEmail : null,
      teamId,
    });
  });

  resolveReferences(candidates, seen, errors);
  peelCycles(candidates, errors);

  return {
    creates: [...candidates.values()].sort((a, b) => a.row - b.row),
    skipped,
    errors: errors.sort((a, b) => a.row - b.row),
  };
}

/**
 * Error every row whose manager cannot be imported, and everything under it.
 *
 * A fixpoint rather than one pass: erroring a row can orphan its reports, and
 * erroring those can orphan theirs. Stopping after the first pass would create
 * users whose manager column pointed at nobody — a broken org chart, arrived
 * at by exactly the route the acceptance criterion names.
 */
function resolveReferences(
  candidates: Map<string, PlannedCreate>,
  seen: Map<string, number>,
  errors: PlannedError[],
): void {
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const orphaned = [...candidates.values()].filter(
      (create) => create.managerEmail !== null && !candidates.has(create.managerEmail),
    );

    if (orphaned.length === 0) {
      return;
    }

    for (const create of orphaned) {
      const manager = create.managerEmail ?? '';

      candidates.delete(create.email);
      errors.push({
        row: create.row,
        email: create.email,
        message: seen.has(manager)
          ? `Their manager (${manager}, row ${String(seen.get(manager) ?? 0)}) could not be imported.`
          : `No user with the email ${manager} is in this file or in the organization.`,
      });
    }
  }
}

/**
 * Error any set of rows that manage each other in a circle.
 *
 * By peeling: a row is *rooted* if it has no manager, or its manager already
 * exists in the organization, or its manager is a rooted row. Everything still
 * standing when that stops growing is inside a loop or hanging off one, and
 * both are the same problem to the person who has to fix the spreadsheet.
 *
 * Worth catching rather than leaving to the database. Nothing in the schema
 * forbids `A → B → A`; the recursive walks in `orgchart.ts` survive it because
 * they carry a visited set, but the chart itself would be nonsense and nobody
 * would ever be told who caused it.
 */
function peelCycles(candidates: Map<string, PlannedCreate>, errors: PlannedError[]): void {
  const rooted = new Set<string>();

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const grown = [...candidates.values()].filter(
      (create) =>
        !rooted.has(create.email) &&
        (create.managerEmail === null || rooted.has(create.managerEmail)),
    );

    if (grown.length === 0) {
      break;
    }
    for (const create of grown) {
      rooted.add(create.email);
    }
  }

  for (const create of [...candidates.values()]) {
    if (!rooted.has(create.email)) {
      candidates.delete(create.email);
      errors.push({
        row: create.row,
        email: create.email,
        message:
          'These people manage each other in a loop, so none of them has a place in the chart.',
      });
    }
  }
}

/**
 * Write a plan.
 *
 * **One transaction, and the manager links go in on a second pass.** Creating
 * a row whose manager is later in the same file needs an id that does not
 * exist yet, and the alternatives are worse: sorting the file into dependency
 * order duplicates the reasoning `peelCycles` already did, and creating each
 * user on demand recurses through a structure the planner has already proved
 * acyclic. Inserting everyone unattached and then attaching them is two
 * statements per row and no reasoning at all.
 *
 * `errors` are not consulted here. A plan's errored rows were removed from
 * `creates` by the planner; asking this function to filter them again would be
 * a second opinion about what is importable, and the point of the split is
 * that there is only one.
 */
export async function commitImport(
  db: ScopedPrisma,
  actor: AuditActor,
  plan: ImportPlan,
): Promise<{ created: number; skipped: number }> {
  if (plan.creates.length === 0) {
    return { created: 0, skipped: plan.skipped.length };
  }

  return withAudit(
    db,
    actor,
    /* One audit row for the import, not one per user. The event names every
       address it created, so "where did these fifty accounts come from" has an
       answer, and a per-row trail would bury the fact that they arrived
       together. */
    { action: 'user.import', entityType: 'Organization', entityId: actor.orgId },
    async (tx) => {
      const ids = new Map<string, string>();

      for (const create of plan.creates) {
        const user = await tx.user.create({
          data: {
            orgId: actor.orgId,
            email: create.email,
            name: create.name,
            roles: [create.role],
            status: 'INVITED',
            // Resolved now if they already existed; linked below if not.
            managerId: create.managerId,
            teamId: create.teamId,
          },
          select: { id: true },
        });

        ids.set(create.email, user.id);
      }

      for (const create of plan.creates) {
        if (create.managerEmail === null) {
          continue;
        }

        await tx.user.update({
          where: { id: ids.get(create.email) },
          data: { managerId: ids.get(create.managerEmail) ?? null },
        });
      }

      return {
        value: { created: plan.creates.length, skipped: plan.skipped.length },
        after: {
          created: plan.creates.length,
          skipped: plan.skipped.length,
          emails: plan.creates.map((create) => create.email).join(', '),
        },
      };
    },
  );
}

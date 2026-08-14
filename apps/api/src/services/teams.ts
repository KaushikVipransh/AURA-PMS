/**
 * Team mutations (PRD US-1003).
 *
 * A team is not decoration. It is the audience a shared goal is cascaded to
 * (US-401), so creating one creates a set of people work can be pushed onto —
 * which is why it is audited like any other change of who-is-accountable-for-
 * what, and why W2-06 grants it to administrators rather than to line managers.
 */

import type { AuditActor } from '@aura/core';

import type { ScopedPrisma } from '../db/scoped.js';
import { withAudit } from './withAudit.js';

const TEAM_VIEW = {
  id: true,
  orgId: true,
  name: true,
  leadId: true,
  parentTeamId: true,
} as const;

export class TeamConflictError extends Error {
  readonly code: 'DUPLICATE_NAME' | 'UNKNOWN_LEAD' | 'UNKNOWN_PARENT' | 'CYCLIC_PARENT';

  constructor(code: TeamConflictError['code'], message: string) {
    super(message);
    this.name = 'TeamConflictError';
    this.code = code;
  }
}

export type CreateTeamInput = {
  readonly name: string;
  readonly leadId: string | null;
  readonly parentTeamId: string | null;
};

/**
 * Create a team (US-1003).
 *
 * The lead and the parent are looked up through the scoped client, so one from
 * another organization reads as absent rather than as forbidden. `Team.lead` is
 * a plain foreign key with no composite tenancy constraint behind it — unlike
 * `User.manager` — so this check is doing real work rather than duplicating
 * one the database would make anyway.
 */
export async function createTeam(db: ScopedPrisma, actor: AuditActor, input: CreateTeamInput) {
  return withAudit(db, actor, { action: 'team.create', entityType: 'Team' }, async (tx) => {
    if ((await tx.team.count({ where: { name: input.name } })) > 0) {
      throw new TeamConflictError(
        'DUPLICATE_NAME',
        `A team called "${input.name}" already exists.`,
      );
    }

    if (input.leadId !== null && (await tx.user.count({ where: { id: input.leadId } })) === 0) {
      throw new TeamConflictError('UNKNOWN_LEAD', 'That lead is not part of this organization.');
    }

    if (
      input.parentTeamId !== null &&
      (await tx.team.count({ where: { id: input.parentTeamId } })) === 0
    ) {
      throw new TeamConflictError(
        'UNKNOWN_PARENT',
        'That parent team is not part of this organization.',
      );
    }

    const created = await tx.team.create({
      data: {
        orgId: actor.orgId,
        name: input.name,
        leadId: input.leadId,
        parentTeamId: input.parentTeamId,
      },
      select: TEAM_VIEW,
    });

    return { value: created, after: created, entityId: created.id };
  });
}

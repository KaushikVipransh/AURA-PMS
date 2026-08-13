/**
 * User mutations, each one audited.
 *
 * The routers hold HTTP concerns — parsing, status codes, permission checks —
 * and the writes live here, where `withAudit` guarantees each one commits
 * alongside its `AuditEvent` or not at all.
 */

import type { Actor, Role } from '@aura/core';
import type { AuditActor } from '@aura/core';

import type { ScopedPrisma } from '../db/scoped.js';
import { withAudit } from './withAudit.js';

/** The fields an audit diff should see. Excludes nothing sensitive by design. */
const USER_VIEW = {
  id: true,
  email: true,
  name: true,
  roles: true,
  status: true,
  managerId: true,
  teamId: true,
} as const;

/** Translate the request's actor into the shape the audit builder wants. */
export function auditActor(actor: Actor, req?: { ip?: string | undefined; userAgent?: string | undefined }): AuditActor {
  return {
    userId: actor.userId,
    orgId: actor.orgId,
    ip: req?.ip ?? null,
    userAgent: req?.userAgent ?? null,
  };
}

export type InviteInput = {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly managerId: string | null;
  readonly teamId: string | null;
};

/** US-101 — create an invited user. */
export async function inviteUser(
  db: ScopedPrisma,
  actor: AuditActor,
  input: InviteInput,
) {
  return withAudit(db, actor, { action: 'user.invite', entityType: 'User' }, async (tx) => {
    const created = await tx.user.create({
      data: {
        orgId: actor.orgId,
        email: input.email,
        name: input.name,
        roles: [input.role],
        status: 'INVITED',
        managerId: input.managerId,
        teamId: input.teamId,
      },
      select: USER_VIEW,
    });

    // `before` is empty: nothing existed. The diff is therefore every field as
    // an addition, which is what "this user was created" should read as.
    return { value: created, after: created, entityId: created.id };
  });
}

/**
 * US-106 — deactivate, and revoke their sessions.
 *
 * Both inside the transaction. A deactivation whose session revocation failed
 * would leave someone signed in with an account marked inactive, which reads
 * as "we removed their access" in every report while being false.
 */
export async function deactivateUser(
  db: ScopedPrisma,
  actor: AuditActor,
  userId: string,
) {
  return withAudit(
    db,
    actor,
    { action: 'user.deactivate', entityType: 'User', entityId: userId },
    async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_VIEW });

      const after = await tx.user.update({
        where: { id: userId },
        data: { status: 'DEACTIVATED' },
        select: USER_VIEW,
      });

      await tx.session.deleteMany({ where: { userId } });

      return { value: after, before, after };
    },
  );
}

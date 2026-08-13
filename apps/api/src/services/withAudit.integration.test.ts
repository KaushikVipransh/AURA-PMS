import { prisma } from '@aura/db';
import { describe, expect, it } from 'vitest';

import { scopedPrisma } from '../db/scoped.js';
import { MissingAuditTargetError, withAudit } from './withAudit.js';
import { deactivateUser, inviteUser } from './users.js';

/**
 * W4-01's proof: the mutation and its audit row commit together, or neither
 * does.
 */

let seq = 0;
const uniqueEmail = (): string => `w4-01-${String(Date.now())}-${String(++seq)}@example.com`;

async function newOrgWithAdmin() {
  const org = await prisma.organization.create({
    data: { name: 'Aura', slug: `aura-${String(Date.now())}-${String(++seq)}` },
  });

  const admin = await prisma.user.create({
    data: {
      orgId: org.id,
      email: uniqueEmail(),
      name: 'Admin',
      roles: ['ORG_ADMIN'],
      status: 'ACTIVE',
    },
  });

  return {
    org,
    admin,
    db: scopedPrisma(org.id),
    actor: { userId: admin.id, orgId: org.id, ip: '203.0.113.7', userAgent: 'vitest' },
  };
}

describe('withAudit · the happy path', () => {
  it('writes the change and an audit row together', async () => {
    const ctx = await newOrgWithAdmin();

    const invited = await inviteUser(ctx.db, ctx.actor, {
      name: 'Priya',
      email: uniqueEmail(),
      role: 'EMPLOYEE',
      managerId: null,
      teamId: null,
    });

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'User', entityId: invited.id },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'user.invite',
      actorId: ctx.admin.id,
      orgId: ctx.org.id,
      ip: '203.0.113.7',
      userAgent: 'vitest',
    });
  });

  it('records a real actor, not a hardcoded string', async () => {
    const ctx = await newOrgWithAdmin();
    const invited = await inviteUser(ctx.db, ctx.actor, {
      name: 'Priya',
      email: uniqueEmail(),
      role: 'EMPLOYEE',
      managerId: null,
      teamId: null,
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: invited.id },
    });

    // The prototype attributed its one logged action to "System Compliance
    // Board" because there was nobody to attribute it to (F-09).
    expect(event.actorId).toBe(ctx.admin.id);
  });

  it('records a field-level diff of what changed', async () => {
    const ctx = await newOrgWithAdmin();
    const invited = await inviteUser(ctx.db, ctx.actor, {
      name: 'Priya',
      email: uniqueEmail(),
      role: 'EMPLOYEE',
      managerId: null,
      teamId: null,
    });

    await deactivateUser(ctx.db, ctx.actor, invited.id);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: invited.id, action: 'user.deactivate' },
    });

    expect(event.before).toMatchObject({ status: 'INVITED' });
    expect(event.after).toMatchObject({ status: 'DEACTIVATED' });
  });
});

describe('withAudit · an audit failure rolls the mutation back', () => {
  it('leaves no user behind when the audit row cannot be written', async () => {
    const ctx = await newOrgWithAdmin();
    const email = uniqueEmail();

    /*
     * Forced by giving the audit row an actor that does not exist.
     * `AuditEvent.actor` is `onDelete: Restrict` against `User`, so Postgres
     * refuses the insert on a foreign key violation — a real database failure
     * rather than a mocked one, which is the only kind that proves a
     * transaction boundary actually holds.
     */
    const ghost = { ...ctx.actor, userId: 'clw0000000000000000000000' };

    await expect(
      inviteUser(ctx.db, ghost, {
        name: 'Priya',
        email,
        role: 'EMPLOYEE',
        managerId: null,
        teamId: null,
      }),
    ).rejects.toThrow();

    // The mutation is gone with it. A user created without a trail is the gap
    // this whole wrapper exists to make impossible.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('leaves the earlier state intact when a later step fails', async () => {
    const ctx = await newOrgWithAdmin();
    const invited = await inviteUser(ctx.db, ctx.actor, {
      name: 'Priya',
      email: uniqueEmail(),
      role: 'EMPLOYEE',
      managerId: null,
      teamId: null,
    });

    await prisma.session.create({
      data: {
        userId: invited.id,
        token: `tok-${String(Date.now())}-${String(++seq)}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const ghost = { ...ctx.actor, userId: 'clw0000000000000000000000' };

    await expect(deactivateUser(ctx.db, ghost, invited.id)).rejects.toThrow();

    // Deactivation and session revocation are in the same transaction as the
    // audit row, so a failure rolls back all three.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: invited.id } });
    expect(after.status).toBe('INVITED');
    expect(await prisma.session.count({ where: { userId: invited.id } })).toBe(1);
  });

  it('writes no audit row of its own for the failed attempt', async () => {
    const ctx = await newOrgWithAdmin();
    const before = await prisma.auditEvent.count({ where: { orgId: ctx.org.id } });
    const ghost = { ...ctx.actor, userId: 'clw0000000000000000000000' };

    await expect(
      inviteUser(ctx.db, ghost, {
        name: 'Priya',
        email: uniqueEmail(),
        role: 'EMPLOYEE',
        managerId: null,
        teamId: null,
      }),
    ).rejects.toThrow();

    expect(await prisma.auditEvent.count({ where: { orgId: ctx.org.id } })).toBe(before);
  });
});

describe('withAudit · refusals', () => {
  it('refuses a mutation that does not say what it changed', async () => {
    const ctx = await newOrgWithAdmin();

    await expect(
      withAudit(ctx.db, ctx.actor, { action: 'thing.do', entityType: 'Thing' }, () =>
        Promise.resolve({ value: 1, after: { a: 1 } }),
      ),
    ).rejects.toThrow(MissingAuditTargetError);
  });

  it('writes no audit row when nothing actually changed', async () => {
    const ctx = await newOrgWithAdmin();
    const before = await prisma.auditEvent.count({ where: { orgId: ctx.org.id } });

    const value = await withAudit(
      ctx.db,
      ctx.actor,
      { action: 'thing.touch', entityType: 'Thing', entityId: 'thing-1' },
      () => Promise.resolve({ value: 'unchanged', before: { a: 1 }, after: { a: 1 } }),
    );

    // A trail that records saves which altered nothing trains people to ignore
    // it, and "who changed this field" stops being answerable by reading.
    expect(value).toBe('unchanged');
    expect(await prisma.auditEvent.count({ where: { orgId: ctx.org.id } })).toBe(before);
  });

  it('propagates the body’s own failure rather than masking it', async () => {
    const ctx = await newOrgWithAdmin();

    await expect(
      withAudit(ctx.db, ctx.actor, { action: 'thing.do', entityType: 'Thing', entityId: 'x' }, () =>
        Promise.reject(new Error('the body itself failed')),
      ),
    ).rejects.toThrow('the body itself failed');
  });
});

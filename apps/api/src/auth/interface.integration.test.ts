import { prisma } from '@aura/db';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createSession, getActor, requireAuth, requireRole, revokeSession } from './index.js';

/**
 * W3-02's proof: the five exported functions behave, and the boundary they
 * exist to protect is worth having.
 */

let seq = 0;
const uniqueEmail = (): string => `w3-02-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

/** A signed-in user, with the cookie needed to act as them. */
async function signedIn(overrides: { roles?: string[]; status?: string } = {}) {
  const org = await prisma.organization.create({
    data: { name: 'Aura', slug: `aura-${String(Date.now())}-${String(++seq)}` },
  });
  const email = uniqueEmail();

  const { auth } = await import('./config.js');
  await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: 'Priya', orgId: org.id },
  });

  const user = await prisma.user.update({
    where: { email },
    data: {
      status: (overrides.status ?? 'ACTIVE') as 'ACTIVE',
      roles: (overrides.roles ?? ['EMPLOYEE']) as 'EMPLOYEE'[],
    },
  });

  const { headers } = await createSession(email, PASSWORD);
  const cookie = headers.get('set-cookie') ?? '';

  return { org, user, email, cookie };
}

/** The smallest thing that satisfies the parts of `Request` we read. */
const requestWith = (cookie: string): Request =>
  ({ headers: { cookie } }) as unknown as Request;

/**
 * A request with `req.actor` already populated, as `requireAuth` would leave it.
 *
 * Note the assignment is conditional rather than `?? undefined`:
 * `exactOptionalPropertyTypes` makes an optional property refuse an explicit
 * `undefined`, which is the strictness doing its job — "absent" and "present
 * and undefined" are different states and the middleware only ever produces
 * the first.
 */
async function authedRequest(cookie: string): Promise<Request> {
  const req = requestWith(cookie);
  const actor = await getActor(req);

  if (actor === null) {
    throw new Error('Expected a valid session while setting up this test.');
  }
  req.actor = actor;

  return req;
}

/** A response recorder, so a middleware's refusal can be inspected. */
function recorder() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;

  return { res, sent };
}

/*
 * No `afterAll(() => prisma.$disconnect())` here, deliberately.
 *
 * `prisma` is a process-wide singleton and these files share it. Disconnecting
 * at the end of one file closed the connection the next file was still using
 * — "Server has closed the connection" from a `create` in a later suite. The
 * container teardown in global setup closes everything anyway.
 */

describe('getActor', () => {
  it('resolves a valid session to an actor', async () => {
    const { user, org, cookie } = await signedIn();

    const actor = await getActor(requestWith(cookie));

    expect(actor).toEqual({
      userId: user.id,
      orgId: org.id,
      roles: ['EMPLOYEE'],
      isActive: true,
    });
  });

  it('returns null with no cookie at all', async () => {
    expect(await getActor(requestWith(''))).toBeNull();
  });

  it('returns null for a forged cookie', async () => {
    expect(
      await getActor(requestWith('better-auth.session_token=not-a-real-token')),
    ).toBeNull();
  });

  it('reads roles from the database, not from the session payload', async () => {
    // A session issued before a promotion should not carry the old roles for
    // up to seven days.
    const { user, cookie } = await signedIn({ roles: ['EMPLOYEE'] });

    await prisma.user.update({
      where: { id: user.id },
      data: { roles: ['EMPLOYEE', 'HR_ADMIN'] },
    });

    const actor = await getActor(requestWith(cookie));

    expect(actor?.roles).toEqual(['EMPLOYEE', 'HR_ADMIN']);
  });

  it('reflects a deactivation immediately, on the session already issued', async () => {
    // US-106. The alternative -- trusting the session -- leaves a departing
    // employee with working access until their cookie happens to expire.
    const { user, cookie } = await signedIn();

    expect((await getActor(requestWith(cookie)))?.isActive).toBe(true);

    await prisma.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED' } });

    expect((await getActor(requestWith(cookie)))?.isActive).toBe(false);
  });

  it('treats an invited-but-not-accepted user as inactive', async () => {
    const { cookie } = await signedIn({ status: 'INVITED' });

    expect((await getActor(requestWith(cookie)))?.isActive).toBe(false);
  });
});

describe('requireAuth', () => {
  it('populates req.actor and continues', async () => {
    const { user, cookie } = await signedIn();
    const req = requestWith(cookie);
    const { res } = recorder();
    const next = vi.fn();

    requireAuth(req, res, next);
    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    expect(req.actor?.userId).toBe(user.id);
  });

  it('answers 401 with no detail about why', async () => {
    const req = requestWith('');
    const { res, sent } = recorder();
    const next = vi.fn();

    requireAuth(req, res, next);
    await vi.waitFor(() => {
      expect(sent.status).toBe(401);
    });

    // Whether the session was missing, expired, or belonged to a deactivated
    // account are all facts about an account the caller has not earned.
    expect(sent.body).toEqual({ error: 'Unauthenticated' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  it('lets a held role through', async () => {
    const { cookie } = await signedIn({ roles: ['HR_ADMIN'] });
    const req = await authedRequest(cookie);
    const { res } = recorder();
    const next = vi.fn();

    requireRole('HR_ADMIN')(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('matches on any held role, not only the first', async () => {
    const { cookie } = await signedIn({ roles: ['EMPLOYEE', 'HR_ADMIN'] });
    const req = await authedRequest(cookie);
    const next = vi.fn();
    requireRole('HR_ADMIN')(req, recorder().res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('answers 403 when no held role qualifies', async () => {
    const { cookie } = await signedIn({ roles: ['EMPLOYEE'] });
    const req = await authedRequest(cookie);
    const { res, sent } = recorder();
    const next = vi.fn();

    requireRole('ORG_ADMIN')(req, res, next);

    expect(sent.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('raises a programming error when used without requireAuth', () => {
    const req = requestWith('');
    const { res, sent } = recorder();
    const next = vi.fn();

    requireRole('ORG_ADMIN')(req, res, next);

    // 403 would hide a broken route behind a plausible-looking response.
    expect(sent.status).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('createSession and revokeSession', () => {
  it('issues a cookie that getActor accepts', async () => {
    const { cookie, user } = await signedIn();

    expect(cookie).toContain('better-auth');
    expect((await getActor(requestWith(cookie)))?.userId).toBe(user.id);
  });

  it('refuses the wrong password', async () => {
    const { email } = await signedIn();

    await expect(createSession(email, 'wrong-password-entirely')).rejects.toThrow();
  });

  it('revokes server-side, so the captured cookie stops working', async () => {
    const { cookie, user } = await signedIn();

    expect((await getActor(requestWith(cookie)))?.userId).toBe(user.id);

    // Signing up issues a session of its own, so this user holds two: the one
    // from sign-up and the one `createSession` just made. Counting to zero
    // would be asserting something untrue about the library.
    const before = await prisma.session.count({ where: { userId: user.id } });
    expect(before).toBeGreaterThan(0);

    await revokeSession(requestWith(cookie));

    // A logout that only clears the cookie leaves a valid session behind, and
    // anyone who captured it stays signed in. The row has to go.
    expect(await getActor(requestWith(cookie))).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(before - 1);
  });

  it('is harmless when there is no session to revoke', async () => {
    await expect(revokeSession(requestWith(''))).resolves.toBeUndefined();
  });
});

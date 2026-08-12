import { prisma } from '@aura/db';
import { describe, expect, it, vi } from 'vitest';

import { auth } from './config.js';

/**
 * W3-01's proof: a user can be created and a session issued.
 *
 * Against real Postgres, because every claim below is a claim about the
 * database. "The password is hashed" is only true if the column says so.
 */

let seq = 0;
const uniqueEmail = (): string => `w3-01-${String(Date.now())}-${String(++seq)}@example.com`;

const PASSWORD = 'correct-horse-battery-staple';

async function makeOrg() {
  return prisma.organization.create({
    data: { name: 'Aura Industries', slug: `aura-${String(Date.now())}-${String(++seq)}` },
  });
}

/*
 * No `$disconnect` here: `prisma` is a process-wide singleton shared with the
 * other integration files, and closing it at the end of this one broke a
 * `create` in the next. The container teardown closes everything.
 */

describe('Better Auth · sign-up', () => {
  it('creates a user carrying the organization it was given', async () => {
    const org = await makeOrg();
    const email = uniqueEmail();

    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: 'Priya Sharma', orgId: org.id },
    });

    const user = await prisma.user.findUnique({ where: { email } });

    // orgId is NOT NULL with no default. A user with no organization is
    // precisely the shape PLAN.md F-02 allowed, so it has to arrive at signup.
    expect(user).not.toBeNull();
    expect(user?.orgId).toBe(org.id);
    expect(user?.name).toBe('Priya Sharma');
  });

  it('leaves roles and status at their server-owned defaults', async () => {
    const org = await makeOrg();
    const email = uniqueEmail();

    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: 'Priya', orgId: org.id },
    });

    const user = await prisma.user.findUnique({ where: { email } });

    // Neither is in `additionalFields`, so a client cannot name its own roles
    // at signup -- which would have made the whole of W2-06 decorative.
    expect(user?.roles).toEqual(['EMPLOYEE']);
    expect(user?.status).toBe('INVITED');
  });

  it('stores a password hash, not the password', async () => {
    const org = await makeOrg();
    const email = uniqueEmail();

    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: 'Priya', orgId: org.id },
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const account = await prisma.account.findFirst({ where: { userId: user.id } });

    expect(account).not.toBeNull();
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toBe(PASSWORD);
    expect(account?.password).not.toContain(PASSWORD);
  });

  it('refuses a duplicate email, because the index is global now', async () => {
    const first = await makeOrg();
    const second = await makeOrg();
    const email = uniqueEmail();

    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: 'Priya', orgId: first.id },
    });

    // W1-03 keyed this per organization, which would have allowed this second
    // signup and made "who is signing in" unanswerable. W3-01 widened it.
    await expect(
      auth.api.signUpEmail({
        body: { email, password: PASSWORD, name: 'Priya Elsewhere', orgId: second.id },
      }),
    ).rejects.toThrow();

    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('refuses a password below the configured minimum', async () => {
    const org = await makeOrg();

    await expect(
      auth.api.signUpEmail({
        body: { email: uniqueEmail(), password: 'short', name: 'Priya', orgId: org.id },
      }),
    ).rejects.toThrow();
  });
});

describe('Better Auth · sessions', () => {
  async function signedUpUser() {
    const org = await makeOrg();
    const email = uniqueEmail();

    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: 'Priya', orgId: org.id },
    });

    return { org, email };
  }

  it('issues a session row on sign-in', async () => {
    const { email } = await signedUpUser();

    const result = await auth.api.signInEmail({ body: { email, password: PASSWORD } });

    expect(result.token).toBeTruthy();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('resolves that session back to the user who owns it', async () => {
    const { email, org } = await signedUpUser();

    const signIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = signIn.headers.get('set-cookie');

    expect(cookie).toBeTruthy();

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie ?? '' }),
    });

    expect(session?.user.email).toBe(email);
    // The organization travels on the session, which is what every org-scoped
    // query in W3-06 will read instead of trusting a request parameter.
    expect((session?.user as { orgId?: string } | undefined)?.orgId).toBe(org.id);
  });

  it('refuses the wrong password', async () => {
    const { email } = await signedUpUser();

    await expect(
      auth.api.signInEmail({ body: { email, password: 'not-the-right-password' } }),
    ).rejects.toThrow();
  });

  it('refuses an unknown email', async () => {
    await expect(
      auth.api.signInEmail({ body: { email: uniqueEmail(), password: PASSWORD } }),
    ).rejects.toThrow();
  });

  it('sets an httpOnly cookie', async () => {
    const { email } = await signedUpUser();

    const signIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = signIn.headers.get('set-cookie') ?? '';

    // A session cookie readable from JavaScript is a session cookie an XSS can
    // steal wholesale.
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
  });
});

describe('Better Auth · configuration', () => {
  it.each(['', 'too-short'])('refuses to construct with a secret of %o', async (secret) => {
    const original = process.env['BETTER_AUTH_SECRET'];
    process.env['BETTER_AUTH_SECRET'] = secret;
    vi.resetModules();

    try {
      // A weak or missing secret breaks nothing visibly: sessions still issue,
      // and they are simply forgeable. Failing at startup is the whole point.
      await expect(import('./config.js')).rejects.toThrow(/BETTER_AUTH_SECRET/);
    } finally {
      if (original === undefined) {
        delete process.env['BETTER_AUTH_SECRET'];
      } else {
        process.env['BETTER_AUTH_SECRET'] = original;
      }
      vi.resetModules();
    }
  });
});

import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

/**
 * W3-03's proof, driven over real HTTP through the real router.
 *
 * Calling the handlers directly would skip the body parser, the CORS layer and
 * the mount order — and mount order is exactly where the auth library's raw
 * body handling goes wrong.
 */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w3-03-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

/**
 * Normalise `Set-Cookie`, which arrives as a string, an array, or not at all.
 *
 * Supertest types it as `string | never[]`, so the array case has to be handled
 * explicitly rather than by `?? []` — which typechecks as `string | never[]`
 * and satisfies neither `.set('Cookie', …)` overload.
 */
function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

/** Sign up an organization and its first admin, returning the session cookie. */
async function signup(email = uniqueEmail()) {
  const response = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura Industries', name: 'Sam Patel', email, password: PASSWORD });

  return { response, email, cookie: cookiesFrom(response) };
}

describe('POST /auth/signup', () => {
  it('creates the organization and its first administrator', async () => {
    const { response, email } = await signup();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      user: { email, roles: expect.arrayContaining(['ORG_ADMIN']) as unknown },
      organization: { name: 'Aura Industries' },
    });
  });

  it('makes the first user an active org admin, decided by the server', async () => {
    const { email } = await signup();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    // `roles` is not an additionalField, so no request body could have asked
    // for this. The first user of a new organization is its administrator by
    // construction.
    expect(user.roles).toEqual(expect.arrayContaining(['ORG_ADMIN', 'EMPLOYEE']));
    expect(user.status).toBe('ACTIVE');
  });

  it('signs the new admin in, so signup is not followed by a login', async () => {
    const { cookie } = await signup();

    expect(cookie.length).toBeGreaterThan(0);

    const session = await request(app).get('/auth/session').set('Cookie', cookie);

    expect(session.status).toBe(200);
  });

  it('refuses an email that is already registered', async () => {
    const { email } = await signup();
    const second = await signup(email);

    expect(second.response.status).toBe(409);
  });

  it('leaves no orphan organization when signup is refused', async () => {
    const { email } = await signup();
    const before = await prisma.organization.count();

    await signup(email);

    // The duplicate is caught before anything is created, so there is no
    // compensating delete to get wrong.
    expect(await prisma.organization.count()).toBe(before);
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['a malformed email', { email: 'not-an-email' }],
    ['a missing organization name', { organizationName: '' }],
  ])('rejects %s with field-level detail', async (_label, override) => {
    const response = await request(app)
      .post('/auth/signup')
      .send({
        organizationName: 'Aura',
        name: 'Sam',
        email: uniqueEmail(),
        password: PASSWORD,
        ...override,
      });

    expect(response.status).toBe(400);
    expect(Object.keys((response.body as { fields?: object }).fields ?? {}).length).toBeGreaterThan(
      0,
    );
  });
});

describe('POST /auth/login', () => {
  it('accepts correct credentials and issues a cookie', async () => {
    const { email } = await signup();

    const response = await request(app).post('/auth/login').send({ email, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']?.length).toBeGreaterThan(0);
    expect((response.body as { user: { orgId: string } }).user.orgId).toBeTruthy();
  });

  it('normalises the email, so a capitalised address still signs in', async () => {
    const { email } = await signup();

    const response = await request(app)
      .post('/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD });

    expect(response.status).toBe(200);
  });

  it('refuses a deactivated user whose password is correct', async () => {
    const { email } = await signup();
    await prisma.user.update({ where: { email }, data: { status: 'DEACTIVATED' } });

    const response = await request(app).post('/auth/login').send({ email, password: PASSWORD });

    // US-106: their password is right, their access is not.
    expect(response.status).toBe(401);
  });

  it('does not leave a session behind for the user it just refused', async () => {
    const { email } = await signup();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.update({ where: { email }, data: { status: 'DEACTIVATED' } });

    await request(app).post('/auth/login').send({ email, password: PASSWORD });

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('POST /auth/login · account enumeration', () => {
  it('answers a wrong password and an unknown address identically', async () => {
    const { email } = await signup();

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email, password: 'definitely-not-the-password' });

    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: uniqueEmail(), password: PASSWORD });

    // Byte-identical. Anything that differs -- status, message, shape -- turns
    // the login form into a tool for listing a company's employees.
    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(JSON.stringify(wrongPassword.body)).toBe(JSON.stringify(unknownEmail.body));
  });

  it('answers a malformed email the same way too', async () => {
    // A 400 with field detail here would say "that address does not even look
    // real", which is a different answer from "those credentials are wrong".
    const malformed = await request(app)
      .post('/auth/login')
      .send({ email: 'not-an-email', password: PASSWORD });

    expect(malformed.status).toBe(401);
    expect(malformed.body).toEqual({ error: 'Invalid email or password' });
  });

  it('sets no cookie on any refusal', async () => {
    const { email } = await signup();

    for (const body of [
      { email, password: 'wrong' },
      { email: uniqueEmail(), password: PASSWORD },
      { email: 'not-an-email', password: PASSWORD },
    ]) {
      const response = await request(app).post('/auth/login').send(body);

      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('takes comparable time for both, within an order of magnitude', async () => {
    const { email } = await signup();

    const time = async (body: object): Promise<number> => {
      const started = performance.now();
      await request(app).post('/auth/login').send(body);
      return performance.now() - started;
    };

    // Averaged over a few runs, and asserted loosely on purpose. A tight bound
    // would flake on a shared CI runner and get "fixed" by deletion. What this
    // catches is the real failure -- an unknown address returning without ever
    // hashing, which is typically 50-100x faster, not 5x.
    const runs = 3;
    let wrong = 0;
    let unknown = 0;

    for (let i = 0; i < runs; i += 1) {
      wrong += await time({ email, password: 'definitely-not-the-password' });
      unknown += await time({ email: uniqueEmail(), password: PASSWORD });
    }

    const ratio = Math.max(wrong, unknown) / Math.max(1, Math.min(wrong, unknown));

    expect(ratio).toBeLessThan(10);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session server-side', async () => {
    const { cookie, email } = await signup();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const before = await prisma.session.count({ where: { userId: user.id } });

    const response = await request(app).post('/auth/logout').set('Cookie', cookie);

    expect(response.status).toBe(204);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(before - 1);
  });

  it('makes the captured cookie stop working', async () => {
    const { cookie } = await signup();

    await request(app).post('/auth/logout').set('Cookie', cookie);

    const session = await request(app).get('/auth/session').set('Cookie', cookie);

    expect(session.status).toBe(401);
  });

  it('is idempotent, and succeeds with no session at all', async () => {
    const { cookie } = await signup();

    await request(app).post('/auth/logout').set('Cookie', cookie);

    expect((await request(app).post('/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await request(app).post('/auth/logout')).status).toBe(204);
  });
});

describe('GET /auth/session', () => {
  it('returns the current actor', async () => {
    const { cookie, email } = await signup();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const response = await request(app).get('/auth/session').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: user.id,
        orgId: user.orgId,
        roles: expect.arrayContaining(['ORG_ADMIN']) as unknown,
        isActive: true,
      },
    });
  });

  it('answers 401 with no session', async () => {
    const response = await request(app).get('/auth/session');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthenticated' });
  });

  it('reflects a deactivation on the session already issued', async () => {
    const { cookie, email } = await signup();
    await prisma.user.update({ where: { email }, data: { status: 'DEACTIVATED' } });

    const response = await request(app).get('/auth/session').set('Cookie', cookie);

    expect((response.body as { user: { isActive: boolean } }).user.isActive).toBe(false);
  });
});

describe('the application shell', () => {
  it('answers /healthz', async () => {
    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('answers 404 as JSON, not as an HTML error page', async () => {
    const response = await request(app).get('/no-such-route');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'Not found' });
  });

  it('rejects an origin that is not on the allowlist', async () => {
    const response = await request(app)
      .get('/healthz')
      .set('Origin', 'https://evil.example');

    // The prototype's bare cors() answered `*` here, which with no
    // authentication behind it meant the whole database (F-01).
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('echoes an allowed origin with credentials enabled', async () => {
    const response = await request(app)
      .get('/healthz')
      .set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});

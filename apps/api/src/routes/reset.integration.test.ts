import { prisma } from '@aura/db';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { resetMailer, setMailer, type OutboundEmail } from '../auth/mailer.js';

/** W3-04's proof: PRD US-103, end to end against real Postgres. */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w3-04-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'an-entirely-different-passphrase';

/** Captures what would have been emailed, so a test can follow the link. */
let outbox: OutboundEmail[] = [];

beforeEach(() => {
  outbox = [];
  setMailer({
    send(email) {
      outbox.push(email);
      return Promise.resolve();
    },
  });
});

afterEach(() => {
  resetMailer();
});

async function signup(email = uniqueEmail()) {
  const response = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name: 'Priya', email, password: PASSWORD });

  const raw = response.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];

  return { email, cookie };
}

/** Ask for a reset and return the token that was emailed. */
async function requestReset(email: string): Promise<string> {
  await request(app).post('/auth/forgot').send({ email });

  const token = outbox.at(-1)?.meta?.['token'];

  if (token === undefined) {
    throw new Error('No reset email was sent.');
  }
  return token;
}

describe('POST /auth/forgot', () => {
  it('accepts a known address and sends a link', async () => {
    const { email } = await signup();

    const response = await request(app).post('/auth/forgot').send({ email });

    expect(response.status).toBe(202);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe(email);
    expect(outbox[0]?.meta?.['url']).toContain('/reset-password');
  });

  it('answers an unknown address identically, and sends nothing', async () => {
    const known = await signup();
    const knownResponse = await request(app).post('/auth/forgot').send({ email: known.email });

    outbox = [];
    const unknownResponse = await request(app)
      .post('/auth/forgot')
      .send({ email: uniqueEmail() });

    // Byte-identical. Unlike login this needs no password to query, so it is
    // the easier of the two endpoints to mine for a staff list.
    expect(unknownResponse.status).toBe(knownResponse.status);
    expect(unknownResponse.body).toEqual(knownResponse.body);
    expect(JSON.stringify(unknownResponse.body)).toBe(JSON.stringify(knownResponse.body));
    expect(outbox).toHaveLength(0);
  });

  it('answers a malformed address the same way too', async () => {
    const response = await request(app).post('/auth/forgot').send({ email: 'not-an-email' });

    expect(response.status).toBe(202);
    expect(outbox).toHaveLength(0);
  });

  it('answers an empty body the same way', async () => {
    expect((await request(app).post('/auth/forgot').send({})).status).toBe(202);
  });

  it('never says whether the address exists', async () => {
    const { email } = await signup();
    const known = await request(app).post('/auth/forgot').send({ email });
    const unknown = await request(app).post('/auth/forgot').send({ email: uniqueEmail() });

    for (const body of [known.body, unknown.body]) {
      expect(JSON.stringify(body)).not.toContain('not found');
      expect(JSON.stringify(body)).not.toContain('no account');
    }
  });
});

describe('POST /auth/reset', () => {
  it('sets the new password and lets it sign in', async () => {
    const { email } = await signup();
    const token = await requestReset(email);

    const response = await request(app)
      .post('/auth/reset')
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(204);

    const login = await request(app).post('/auth/login').send({ email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('stops the old password working', async () => {
    const { email } = await signup();
    const token = await requestReset(email);

    await request(app).post('/auth/reset').send({ token, password: NEW_PASSWORD });

    const login = await request(app).post('/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('rejects a token that has already been used', async () => {
    const { email } = await signup();
    const token = await requestReset(email);

    expect((await request(app).post('/auth/reset').send({ token, password: NEW_PASSWORD })).status).toBe(
      204,
    );

    // Single-use. A reset link sits in an inbox indefinitely, and an inbox is
    // exactly what an attacker with stale access still has.
    const second = await request(app)
      .post('/auth/reset')
      .send({ token, password: 'yet-another-passphrase' });

    expect(second.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    const { email } = await signup();
    const token = await requestReset(email);

    // Wind the stored expiry back rather than waiting an hour. The row is the
    // thing the library checks, so moving it is the honest way to test this.
    await prisma.verification.updateMany({
      where: { identifier: { contains: 'reset' } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await request(app)
      .post('/auth/reset')
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(400);
  });

  it('rejects a forged token', async () => {
    const response = await request(app)
      .post('/auth/reset')
      .send({ token: 'not-a-real-token-at-all', password: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'That reset link is invalid or has expired' });
  });

  it('rejects a new password that is too short, with field detail', async () => {
    const { email } = await signup();
    const token = await requestReset(email);

    const response = await request(app).post('/auth/reset').send({ token, password: 'short' });

    // Field detail is safe here: it is about the password the caller just
    // typed, and says nothing about the token.
    expect(response.status).toBe(400);
    expect(Object.keys((response.body as { fields?: object }).fields ?? {})).toContain('password');
  });

  it('leaves the old password working when the reset is refused', async () => {
    const { email } = await signup();
    const token = await requestReset(email);

    await request(app).post('/auth/reset').send({ token, password: 'short' });

    expect((await request(app).post('/auth/login').send({ email, password: PASSWORD })).status).toBe(
      200,
    );
  });
});

describe('POST /auth/reset · session invalidation', () => {
  it('revokes every existing session', async () => {
    const { email, cookie } = await signup();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    expect(await prisma.session.count({ where: { userId: user.id } })).toBeGreaterThan(0);

    const token = await requestReset(email);
    await request(app).post('/auth/reset').send({ token, password: NEW_PASSWORD });

    // The usual reason to reset a password is that someone else may know it.
    // Leaving their sessions alive preserves precisely the access the reset
    // was meant to remove -- and the library defaults this to false.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    const session = await request(app).get('/auth/session').set('Cookie', cookie);
    expect(session.status).toBe(401);
  });

  it('makes a session captured before the reset stop working', async () => {
    const { email, cookie } = await signup();

    expect((await request(app).get('/auth/session').set('Cookie', cookie)).status).toBe(200);

    const token = await requestReset(email);
    await request(app).post('/auth/reset').send({ token, password: NEW_PASSWORD });

    expect((await request(app).get('/auth/session').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('the reset token itself', () => {
  it('is stored with an expiry about an hour out', async () => {
    const { email } = await signup();
    await requestReset(email);

    const row = await prisma.verification.findFirst({
      where: { identifier: { contains: 'reset' } },
      orderBy: { createdAt: 'desc' },
    });

    expect(row).not.toBeNull();

    const hours = ((row?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(0.9);
    expect(hours).toBeLessThan(1.1);
  });

  it('is not the user’s email or id in disguise', async () => {
    const { email } = await signup();
    const token = await requestReset(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    expect(token).not.toContain(email);
    expect(token).not.toContain(user.id);
    expect(token.length).toBeGreaterThan(16);
  });
});

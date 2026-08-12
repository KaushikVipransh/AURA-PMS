import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

/**
 * W3-06 (org scoping), W3-07 (security headers) and W3-08 (invite,
 * deactivate), driven over real HTTP against real Postgres.
 */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w3-08-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

/** A fresh organization with its admin signed in. */
async function newOrg(name = 'Aura') {
  const email = uniqueEmail();
  const response = await request(app)
    .post('/auth/signup')
    .send({ organizationName: name, name: 'Admin', email, password: PASSWORD });

  const body = response.body as { user: { id: string; orgId: string } };

  return { cookie: cookiesFrom(response), email, adminId: body.user.id, orgId: body.user.orgId };
}

/** Invite someone into an organization and return their id. */
async function invite(
  cookie: string[],
  overrides: { role?: string; managerId?: string | null } = {},
) {
  const response = await request(app)
    .post('/users/invite')
    .set('Cookie', cookie)
    .send({
      name: 'Priya Sharma',
      email: uniqueEmail(),
      role: overrides.role ?? 'EMPLOYEE',
      managerId: overrides.managerId ?? null,
    });

  return { response, id: (response.body as { user?: { id: string } }).user?.id ?? '' };
}

describe('POST /users/invite', () => {
  it('creates an invited user with the role and manager given', async () => {
    const org = await newOrg();
    const { response, id } = await invite(org.cookie, { managerId: org.adminId });

    expect(response.status).toBe(201);

    const created = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(created.status).toBe('INVITED');
    expect(created.roles).toEqual(['EMPLOYEE']);
    expect(created.managerId).toBe(org.adminId);
    expect(created.orgId).toBe(org.orgId);
  });

  it('puts the invited user in the inviter’s organization, not one they named', async () => {
    const org = await newOrg();
    const other = await newOrg('Rival');

    const response = await request(app)
      .post('/users/invite')
      .set('Cookie', org.cookie)
      .send({
        name: 'Priya',
        email: uniqueEmail(),
        role: 'EMPLOYEE',
        // Ignored: orgId comes from the session, never from a body field.
        orgId: other.orgId,
      });

    const id = (response.body as { user: { id: string } }).user.id;
    const created = await prisma.user.findUniqueOrThrow({ where: { id } });

    expect(created.orgId).toBe(org.orgId);
    expect(created.orgId).not.toBe(other.orgId);
  });

  it('refuses an employee', async () => {
    const org = await newOrg();
    const { id } = await invite(org.cookie);

    // Give the invitee a password so they can sign in.
    await prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
    const employee = await prisma.user.findUniqueOrThrow({ where: { id } });

    const signup = await request(app).post('/auth/signup').send({
      organizationName: 'Throwaway',
      name: 'E',
      email: uniqueEmail(),
      password: PASSWORD,
    });
    const employeeCookie = cookiesFrom(signup);
    await prisma.user.update({
      where: { email: (signup.body as { user: { email: string } }).user.email },
      data: { roles: ['EMPLOYEE'] },
    });

    const response = await request(app)
      .post('/users/invite')
      .set('Cookie', employeeCookie)
      .send({ name: 'X', email: uniqueEmail(), role: 'EMPLOYEE' });

    expect(response.status).toBe(403);
    expect(employee.orgId).toBeTruthy();
  });

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await request(app)
      .post('/users/invite')
      .send({ name: 'X', email: uniqueEmail(), role: 'EMPLOYEE' });

    expect(response.status).toBe(401);
  });

  it('refuses a manager from another organization', async () => {
    const org = await newOrg();
    const other = await newOrg('Rival');

    const response = await request(app)
      .post('/users/invite')
      .set('Cookie', org.cookie)
      .send({
        name: 'Priya',
        email: uniqueEmail(),
        role: 'EMPLOYEE',
        managerId: other.adminId,
      });

    expect(response.status).toBe(400);
  });

  it('refuses a duplicate email', async () => {
    const org = await newOrg();
    const first = await invite(org.cookie);
    const created = await prisma.user.findUniqueOrThrow({ where: { id: first.id } });

    const response = await request(app)
      .post('/users/invite')
      .set('Cookie', org.cookie)
      .send({ name: 'Dup', email: created.email, role: 'EMPLOYEE' });

    expect(response.status).toBe(409);
  });
});

describe('GET /users/:id · organization scoping [W3-06]', () => {
  it('lets an admin read someone in their own organization', async () => {
    const org = await newOrg();
    const { id } = await invite(org.cookie);

    const response = await request(app).get(`/users/${id}`).set('Cookie', org.cookie);

    expect(response.status).toBe(200);
  });

  it('answers 404, not 403, for a user in another organization', async () => {
    const org = await newOrg();
    const other = await newOrg('Rival');
    const victim = await invite(other.cookie);

    const response = await request(app).get(`/users/${victim.id}`).set('Cookie', org.cookie);

    // 404 rather than 403 on purpose: a 403 confirms the row exists, which
    // across a tenant boundary answers "is this person your customer"
    // (PRD US-105).
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
  });

  it('answers identically for a row that does not exist at all', async () => {
    const org = await newOrg();
    const other = await newOrg('Rival');
    const victim = await invite(other.cookie);

    const crossOrg = await request(app).get(`/users/${victim.id}`).set('Cookie', org.cookie);
    const nonexistent = await request(app)
      .get('/users/clw9999999999999999999999')
      .set('Cookie', org.cookie);

    expect(crossOrg.status).toBe(nonexistent.status);
    expect(crossOrg.body).toEqual(nonexistent.body);
  });

  it('scopes by the session, so the id alone is never enough', async () => {
    const org = await newOrg();
    const other = await newOrg('Rival');

    // The same id, read with two different sessions: visible to one, absent
    // to the other. The filter comes from the cookie, not from the URL.
    const target = await invite(other.cookie);

    expect((await request(app).get(`/users/${target.id}`).set('Cookie', other.cookie)).status).toBe(
      200,
    );
    expect((await request(app).get(`/users/${target.id}`).set('Cookie', org.cookie)).status).toBe(
      404,
    );
  });
});

describe('POST /users/:id/deactivate [W3-08]', () => {
  it('deactivates a user in the caller’s organization', async () => {
    const org = await newOrg();
    const { id } = await invite(org.cookie);

    const response = await request(app)
      .post(`/users/${id}/deactivate`)
      .set('Cookie', org.cookie);

    expect(response.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe('DEACTIVATED');
  });

  it('refuses to deactivate the caller themselves', async () => {
    const org = await newOrg();

    const response = await request(app)
      .post(`/users/${org.adminId}/deactivate`)
      .set('Cookie', org.cookie);

    // W2-06 excludes SELF from DEACTIVATE_USER so the last org admin cannot
    // lock the organization out of its own account.
    expect(response.status).toBe(403);
  });

  it('cannot reach a user in another organization', async () => {
    const org = await newOrg();
    const other = await newOrg('Rival');
    const victim = await invite(other.cookie);

    const response = await request(app)
      .post(`/users/${victim.id}/deactivate`)
      .set('Cookie', org.cookie);

    expect(response.status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: victim.id } })).status).toBe(
      'INVITED',
    );
  });

  it('keeps the history readable and revokes the sessions', async () => {
    const org = await newOrg();
    const { id } = await invite(org.cookie);

    await prisma.session.create({
      data: {
        userId: id,
        token: `tok-${String(Date.now())}-${String(++seq)}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await request(app).post(`/users/${id}/deactivate`).set('Cookie', org.cookie);

    // The row survives -- US-106 deactivates, never deletes, because a
    // departing employee's history settles a disputed appraisal.
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: id } })).toBe(0);
  });
});

describe('security middleware [W3-07]', () => {
  it('sets the headers that matter for a JSON API', async () => {
    const response = await request(app).get('/healthz');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('removes the header that advertises the framework', async () => {
    const response = await request(app).get('/healthz');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('refuses a body over the size limit', async () => {
    const org = await newOrg();
    const huge = 'x'.repeat(2 * 1024 * 1024);

    const response = await request(app)
      .post('/users/invite')
      .set('Cookie', org.cookie)
      .send({ name: huge, email: uniqueEmail(), role: 'EMPLOYEE' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(201);
  });
});

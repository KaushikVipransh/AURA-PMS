import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createUser } from '../auth/index.js';
import { scopedPrisma } from '../db/scoped.js';
import {
  MAX_CHAIN_DEPTH,
  chainWithin,
  reportingChain,
  reportingSubtree,
} from '../services/orgchart.js';

/** W4-04 — teams, the org chart, and the recursive walks behind them. */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w4-org-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

async function signUp(name: string) {
  const email = uniqueEmail();
  const response = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name, email, password: PASSWORD });

  return {
    cookie: cookiesFrom(response),
    user: (response.body as { user: { id: string; orgId: string } }).user,
    email,
  };
}

type Role = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' | 'ORG_ADMIN';
type MemberOptions = { managerId?: string; roles?: Role[]; teamId?: string };

/** Someone in `orgId`, optionally reporting to `managerId`. */
async function member(orgId: string, name: string, options: MemberOptions = {}) {
  return prisma.user.create({
    data: {
      orgId,
      email: uniqueEmail(),
      name,
      roles: options.roles ?? ['EMPLOYEE'],
      status: 'ACTIVE',
      managerId: options.managerId ?? null,
      teamId: options.teamId ?? null,
    },
    select: { id: true, orgId: true, name: true },
  });
}

/**
 * A member with a real password account and a real session.
 *
 * Slower than `member`, and used where the test is about what someone is
 * *allowed* to do. A permission test that borrows the administrator's cookie
 * and asserts on a different failure is not testing the permission — which is
 * the mistake the first draft of the employee test in this file made.
 */
async function memberWithSession(orgId: string, name: string, options: MemberOptions = {}) {
  const email = uniqueEmail();

  await createUser({ email, password: PASSWORD, name, orgId });

  const user = await prisma.user.update({
    where: { email },
    data: {
      roles: options.roles ?? ['EMPLOYEE'],
      status: 'ACTIVE',
      managerId: options.managerId ?? null,
      teamId: options.teamId ?? null,
    },
    select: { id: true, orgId: true, name: true },
  });

  const login = await request(app).post('/auth/login').send({ email, password: PASSWORD });

  return { user, cookie: cookiesFrom(login), email };
}

/**
 * An admin with a four-level line beneath them: admin → lead → senior → junior.
 */
async function chainOfFour() {
  const admin = await signUp('Admin');
  const lead = await member(admin.user.orgId, 'Lead', { managerId: admin.user.id, roles: ['MANAGER'] });
  const senior = await member(admin.user.orgId, 'Senior', { managerId: lead.id, roles: ['MANAGER'] });
  const junior = await member(admin.user.orgId, 'Junior', { managerId: senior.id });

  return { admin, lead, senior, junior };
}

describe('reportingChain [W4-04]', () => {
  it('returns the whole line above someone, nearest manager first', async () => {
    const org = await chainOfFour();
    const db = scopedPrisma(org.admin.user.orgId);

    const chain = await reportingChain(db, org.admin.user.orgId, org.junior.id);

    expect(chain).toEqual([org.senior.id, org.lead.id, org.admin.user.id]);
  });

  it('excludes the subject, so nobody is their own manager', async () => {
    const org = await chainOfFour();
    const db = scopedPrisma(org.admin.user.orgId);

    // A chain containing the subject would make `relationshipOf` answer
    // DIRECT_REPORT for a self-approval, which is the one thing the approval
    // workflow exists to refuse.
    expect(await reportingChain(db, org.admin.user.orgId, org.junior.id)).not.toContain(
      org.junior.id,
    );
  });

  it('is empty for someone at the top', async () => {
    const org = await chainOfFour();
    const db = scopedPrisma(org.admin.user.orgId);

    expect(await reportingChain(db, org.admin.user.orgId, org.admin.user.id)).toEqual([]);
  });

  it('terminates on a reporting cycle instead of running forever', async () => {
    const org = await chainOfFour();
    // A -> B -> A is representable: the composite foreign key stops a manager
    // from another organization, not a loop inside one.
    await prisma.user.update({
      where: { id: org.admin.user.id },
      data: { managerId: org.junior.id },
    });

    const db = scopedPrisma(org.admin.user.orgId);
    const chain = await reportingChain(db, org.admin.user.orgId, org.junior.id);

    expect(chain).toEqual([org.senior.id, org.lead.id, org.admin.user.id]);
    expect(chain.length).toBeLessThan(MAX_CHAIN_DEPTH);
  });

  it('stops at the organization boundary', async () => {
    const a = await signUp('A Admin');
    const b = await signUp('B Admin');
    const reportOfA = await member(a.user.orgId, 'Report', { managerId: a.user.id });

    // Asked with the wrong organization, the anchor row is not even found --
    // the raw walk states `orgId` by hand precisely because the extension
    // cannot reach it.
    const db = scopedPrisma(b.user.orgId);

    expect(await reportingChain(db, b.user.orgId, reportOfA.id)).toEqual([]);
  });
});

describe('reportingSubtree [W4-04]', () => {
  it('includes the root at depth zero and each level below it', async () => {
    const org = await chainOfFour();
    const db = scopedPrisma(org.admin.user.orgId);

    const subtree = await reportingSubtree(db, org.admin.user.orgId, org.admin.user.id);

    expect(subtree).toEqual([
      { userId: org.admin.user.id, depth: 0, managerId: null },
      { userId: org.lead.id, depth: 1, managerId: org.admin.user.id },
      { userId: org.senior.id, depth: 2, managerId: org.lead.id },
      { userId: org.junior.id, depth: 3, managerId: org.senior.id },
    ]);
  });

  it('takes in siblings, not just a single line', async () => {
    const admin = await signUp('Admin');
    const one = await member(admin.user.orgId, 'One', { managerId: admin.user.id });
    const two = await member(admin.user.orgId, 'Two', { managerId: admin.user.id });

    const db = scopedPrisma(admin.user.orgId);
    const subtree = await reportingSubtree(db, admin.user.orgId, admin.user.id);

    expect(subtree.map((entry) => entry.userId).sort()).toEqual(
      [admin.user.id, one.id, two.id].sort(),
    );
  });

  it('leaves out a colleague who is not below the root', async () => {
    const admin = await signUp('Admin');
    const report = await member(admin.user.orgId, 'Report', { managerId: admin.user.id });
    const stranger = await member(admin.user.orgId, 'Stranger');

    const db = scopedPrisma(admin.user.orgId);
    const subtree = await reportingSubtree(db, report.orgId, report.id);

    expect(subtree.map((entry) => entry.userId)).toEqual([report.id]);
    expect(subtree.map((entry) => entry.userId)).not.toContain(stranger.id);
  });
});

describe('chainWithin [W4-04]', () => {
  it('rebuilds a path inside a walk without going back to the database', async () => {
    const org = await chainOfFour();
    const db = scopedPrisma(org.admin.user.orgId);
    const subtree = await reportingSubtree(db, org.admin.user.orgId, org.admin.user.id);

    expect(chainWithin(subtree, org.junior.id, org.admin.user.id)).toEqual([
      org.senior.id,
      org.lead.id,
      org.admin.user.id,
    ]);
  });

  it('gives a direct report a chain of exactly one', async () => {
    const org = await chainOfFour();
    const db = scopedPrisma(org.admin.user.orgId);
    const subtree = await reportingSubtree(db, org.admin.user.orgId, org.admin.user.id);

    // Length one is what makes `relationshipOf` answer DIRECT_REPORT rather
    // than INDIRECT_REPORT, which `RATE_REPORT` in W2-06 distinguishes.
    expect(chainWithin(subtree, org.lead.id, org.admin.user.id)).toEqual([org.admin.user.id]);
  });

  it('gives an outsider no chain at all, rather than a weak one', async () => {
    const org = await chainOfFour();
    const db = scopedPrisma(org.admin.user.orgId);
    const subtree = await reportingSubtree(db, org.admin.user.orgId, org.admin.user.id);

    expect(chainWithin(subtree, 'nobody', org.admin.user.id)).toEqual([]);
  });

  it('gives the root itself no chain', async () => {
    const org = await chainOfFour();
    const db = scopedPrisma(org.admin.user.orgId);
    const subtree = await reportingSubtree(db, org.admin.user.orgId, org.admin.user.id);

    expect(chainWithin(subtree, org.admin.user.id, org.admin.user.id)).toEqual([]);
  });
});

describe('GET /org-chart [W4-04]', () => {
  it('defaults to the caller, so "my org chart" needs no parameters', async () => {
    const org = await chainOfFour();

    const response = await request(app).get('/org-chart').set('Cookie', org.admin.cookie);

    expect(response.status).toBe(200);

    const body = response.body as { rootId: string; nodes: { id: string; depth: number }[] };
    expect(body.rootId).toBe(org.admin.user.id);
    expect(body.nodes).toHaveLength(4);
    expect(body.nodes[0]).toMatchObject({ id: org.admin.user.id, depth: 0 });
  });

  it('lets an administrator look at anyone in their organization', async () => {
    const org = await chainOfFour();

    const response = await request(app)
      .get(`/org-chart?rootId=${org.senior.id}`)
      .set('Cookie', org.admin.cookie);

    expect(response.status).toBe(200);
    expect((response.body as { nodes: unknown[] }).nodes).toHaveLength(2);
  });

  it('answers 404 for a root in another organization', async () => {
    const a = await signUp('A Admin');
    const b = await signUp('B Admin');

    const response = await request(app)
      .get(`/org-chart?rootId=${b.user.id}`)
      .set('Cookie', a.cookie);

    // 404 rather than 403: a 403 confirms the id exists, which across an
    // organization boundary is an existence oracle (US-105).
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain(b.user.id);
  });
});

describe('GET /org-chart/:userId/chain [W4-04]', () => {
  it('returns the reporting line above someone, nearest first', async () => {
    const org = await chainOfFour();

    const response = await request(app)
      .get(`/org-chart/${org.junior.id}/chain`)
      .set('Cookie', org.admin.cookie);

    expect(response.status).toBe(200);
    expect((response.body as { chain: { id: string }[] }).chain.map((node) => node.id)).toEqual([
      org.senior.id,
      org.lead.id,
      org.admin.user.id,
    ]);
  });

  it('answers 404 for someone in another organization', async () => {
    const a = await signUp('A Admin');
    const b = await signUp('B Admin');

    const response = await request(app)
      .get(`/org-chart/${b.user.id}/chain`)
      .set('Cookie', a.cookie);

    expect(response.status).toBe(404);
  });
});

describe('teams [W4-04]', () => {
  it('creates a team and audits it', async () => {
    const admin = await signUp('Admin');

    const response = await request(app)
      .post('/teams')
      .set('Cookie', admin.cookie)
      .send({ name: `Platform-${String(++seq)}` });

    expect(response.status).toBe(201);

    const teamId = (response.body as { team: { id: string } }).team.id;
    const events = await prisma.auditEvent.findMany({
      where: { entityId: teamId, action: 'team.create' },
    });

    expect(events).toHaveLength(1);
  });

  it('refuses a second team with the same name', async () => {
    const admin = await signUp('Admin');
    const name = `Platform-${String(++seq)}`;

    await request(app).post('/teams').set('Cookie', admin.cookie).send({ name });
    const second = await request(app).post('/teams').set('Cookie', admin.cookie).send({ name });

    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('DUPLICATE_NAME');
  });

  it('refuses a lead from another organization, reporting it as unknown', async () => {
    const a = await signUp('A Admin');
    const b = await signUp('B Admin');

    const response = await request(app)
      .post('/teams')
      .set('Cookie', a.cookie)
      .send({ name: `Platform-${String(++seq)}`, leadId: b.user.id });

    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('UNKNOWN_LEAD');
  });

  it('refuses an unknown parent team', async () => {
    const admin = await signUp('Admin');

    const response = await request(app)
      .post('/teams')
      .set('Cookie', admin.cookie)
      .send({ name: `Platform-${String(++seq)}`, parentTeamId: 'clw0000000000000000000000' });

    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('UNKNOWN_PARENT');
  });

  it('refuses an employee, who may not invent an audience to push work to', async () => {
    const admin = await signUp('Admin');
    const priya = await memberWithSession(admin.user.orgId, 'Priya');

    const response = await request(app)
      .post('/teams')
      .set('Cookie', priya.cookie)
      .send({ name: `Platform-${String(++seq)}` });

    expect(response.status).toBe(403);
  });

  it('refuses a manager too: a team is an org-design decision', async () => {
    const admin = await signUp('Admin');
    const lead = await memberWithSession(admin.user.orgId, 'Lead', {
      roles: ['MANAGER'],
      managerId: admin.user.id,
    });

    const response = await request(app)
      .post('/teams')
      .set('Cookie', lead.cookie)
      .send({ name: `Platform-${String(++seq)}` });

    expect(response.status).toBe(403);
  });

  it('lets a manager see their own line but not a stranger', async () => {
    const admin = await signUp('Admin');
    const lead = await memberWithSession(admin.user.orgId, 'Lead', {
      roles: ['MANAGER'],
      managerId: admin.user.id,
    });
    const report = await member(admin.user.orgId, 'Report', { managerId: lead.user.id });
    const stranger = await member(admin.user.orgId, 'Stranger');

    const own = await request(app)
      .get(`/org-chart?rootId=${report.id}`)
      .set('Cookie', lead.cookie);
    const other = await request(app)
      .get(`/org-chart?rootId=${stranger.id}`)
      .set('Cookie', lead.cookie);

    expect(own.status).toBe(200);
    expect(other.status).toBe(404);
  });

  it('lists teams with their member counts', async () => {
    const admin = await signUp('Admin');
    const created = await request(app)
      .post('/teams')
      .set('Cookie', admin.cookie)
      .send({ name: `Platform-${String(++seq)}` });

    const teamId = (created.body as { team: { id: string } }).team.id;
    await member(admin.user.orgId, 'Priya', { teamId });
    await member(admin.user.orgId, 'Sam', { teamId });

    const response = await request(app).get('/teams').set('Cookie', admin.cookie);

    expect(response.status).toBe(200);
    const teams = (response.body as { teams: { id: string; memberCount: number }[] }).teams;
    expect(teams.find((team) => team.id === teamId)?.memberCount).toBe(2);
  });

  it('shows one team with its members', async () => {
    const admin = await signUp('Admin');
    const created = await request(app)
      .post('/teams')
      .set('Cookie', admin.cookie)
      .send({ name: `Platform-${String(++seq)}` });

    const teamId = (created.body as { team: { id: string } }).team.id;
    const priya = await member(admin.user.orgId, 'Priya', { teamId });

    const response = await request(app).get(`/teams/${teamId}`).set('Cookie', admin.cookie);

    expect(response.status).toBe(200);
    expect((response.body as { members: { id: string }[] }).members.map((m) => m.id)).toEqual([
      priya.id,
    ]);
  });

  it('hides a team from every organization but its own', async () => {
    const a = await signUp('A Admin');
    const b = await signUp('B Admin');

    const created = await request(app)
      .post('/teams')
      .set('Cookie', a.cookie)
      .send({ name: `Platform-${String(++seq)}` });
    const teamId = (created.body as { team: { id: string } }).team.id;

    const response = await request(app).get(`/teams/${teamId}`).set('Cookie', b.cookie);

    expect(response.status).toBe(404);
  });
});

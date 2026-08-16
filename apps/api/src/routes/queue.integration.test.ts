import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createUser } from '../auth/index.js';

/**
 * W6-09 … W6-11 — the manager's queue and the reviewer's read of a sheet.
 *
 * The queue is the one endpoint whose *contents* are a permission decision, so
 * most of what is asserted here is about who appears in it and with which
 * buttons. A row that shows an Approve button the API would refuse is the
 * failure these tests exist to catch.
 */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w6-queue-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

const iso = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

const goal = (title: string, weightage: number) => ({
  thrustArea: 'OPERATIONAL_EXCELLENCE' as const,
  title,
  uom: 'PERCENT' as const,
  direction: 'HIGHER_IS_BETTER' as const,
  target: '100',
  weightage,
});

type QueueItem = {
  sheetId: string;
  userId: string;
  userName: string;
  status: string;
  actions: string[];
  daysOverdue: number;
  dueAt: string | null;
  score: number;
  selfAppraisalSubmitted: boolean;
};

type QueueBody = {
  items: QueueItem[];
  counts: { total: number; awaitingApproval: number; awaitingRating: number; overdue: number };
};

async function member(orgId: string, name: string, managerId: string | null) {
  return prisma.user.create({
    data: {
      orgId,
      email: uniqueEmail(),
      name,
      roles: ['EMPLOYEE'],
      status: 'ACTIVE',
      managerId,
    },
    select: { id: true, name: true },
  });
}

/** A member with a real account and session, for the tests about refusal. */
async function memberWithSession(orgId: string, name: string, managerId: string | null) {
  const email = uniqueEmail();

  await createUser({ email, password: PASSWORD, name, orgId });

  const user = await prisma.user.update({
    where: { email },
    data: { roles: ['EMPLOYEE'], status: 'ACTIVE', managerId },
    select: { id: true, name: true },
  });

  const login = await request(app).post('/auth/login').send({ email, password: PASSWORD });

  return { user, cookie: cookiesFrom(login) };
}

async function sheetFor(
  orgId: string,
  userId: string,
  cycleId: string,
  status: 'DRAFT' | 'PENDING' | 'APPROVED',
) {
  return prisma.goalSheet.create({
    data: {
      orgId,
      userId,
      cycleId,
      status,
      submittedAt: status === 'DRAFT' ? null : new Date(),
      ...(status === 'APPROVED' ? { approvedAt: new Date(), lockedAt: new Date() } : {}),
      goals: { create: [goal('A Uptime', 60), goal('B Latency', 40)] },
    },
    select: { id: true, goals: { select: { id: true, title: true }, orderBy: { title: 'asc' } } },
  });
}

/**
 * An organization with a two-level line under the admin.
 *
 * ```
 *   admin
 *     ├── priya      (direct)   PENDING sheet
 *     ├── sam        (direct)   APPROVED sheet, self-appraisal submitted
 *     └── raj        (direct)
 *           └── mia  (indirect) PENDING sheet
 * ```
 *
 * The shape matters: `APPROVE_GOAL_SHEET` is granted on REPORTS and
 * `RATE_REPORT` on DIRECT_REPORT, so `mia` is the row that separates the two.
 */
async function org(options: { goalSettingEndsIn?: number } = {}) {
  const signup = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name: 'Marcus', email: uniqueEmail(), password: PASSWORD });

  const adminCookie = cookiesFrom(signup);
  const admin = (signup.body as { user: { id: string; orgId: string } }).user;

  const cycleResponse = await request(app)
    .post('/cycles')
    .set('Cookie', adminCookie)
    .send({
      name: `FY-${String(Date.now())}-${String(++seq)}`,
      fiscalYear: 2026,
      timeZone: 'UTC',
      phases: [
        {
          key: 'GOAL_SETTING',
          label: 'Goals',
          startsAt: iso(-30),
          endsAt: iso(options.goalSettingEndsIn ?? 30),
        },
        { key: 'CHECK_IN', label: 'Check in', startsAt: iso(31), endsAt: iso(60) },
        { key: 'APPRAISAL', label: 'Appraisal', startsAt: iso(61), endsAt: iso(90) },
      ],
      ratingScale: { min: 1, max: 3, labels: { '1': 'Below', '2': 'Meets', '3': 'Exceeds' } },
      escalationRules: { manager: 3, skipLevelHr: 7, rules: ['GOALS_NOT_SUBMITTED'] },
    });

  const cycleId = (cycleResponse.body as { cycle: { id: string } }).cycle.id;
  await request(app)
    .post(`/cycles/${cycleId}/activate`)
    .set('Cookie', adminCookie)
    .send({ confirm: true });

  const priya = await member(admin.orgId, 'Priya', admin.id);
  const sam = await member(admin.orgId, 'Sam', admin.id);
  const raj = await member(admin.orgId, 'Raj', admin.id);
  const mia = await member(admin.orgId, 'Mia', raj.id);

  const priyaSheet = await sheetFor(admin.orgId, priya.id, cycleId, 'PENDING');
  const samSheet = await sheetFor(admin.orgId, sam.id, cycleId, 'APPROVED');
  const miaSheet = await sheetFor(admin.orgId, mia.id, cycleId, 'PENDING');

  // Sam has finished their self-appraisal, so the row is waiting on a rating.
  await prisma.appraisal.create({
    data: { sheetId: samSheet.id, selfNarrative: 'A steady year.', selfSubmittedAt: new Date() },
  });

  return {
    adminCookie,
    admin,
    cycleId,
    priya,
    sam,
    raj,
    mia,
    priyaSheet,
    samSheet,
    miaSheet,
  };
}

const queue = async (cookie: string[], query: string): Promise<QueueBody & { status: number }> => {
  const response = await request(app).get(`/queue?${query}`).set('Cookie', cookie);

  return { ...(response.body as QueueBody), status: response.status };
};

describe('GET /queue [W6-09]', () => {
  it('lists the reporting line, and never the caller’s own sheet', async () => {
    const ctx = await org();
    await sheetFor(ctx.admin.orgId, ctx.admin.id, ctx.cycleId, 'PENDING');

    const body = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}`);

    expect(body.status).toBe(200);
    expect(body.items.map((item) => item.userName).sort()).toEqual(['Mia', 'Priya', 'Sam']);
    // W2-06 refuses SELF on APPROVE_GOAL_SHEET, so a self row would be a row
    // whose only button is one the API would reject.
    expect(body.items.map((item) => item.userId)).not.toContain(ctx.admin.id);
  });

  it('offers approval on an indirect report but not a rating', async () => {
    const ctx = await org();

    // Mia reports to Raj, who reports to the admin.
    await prisma.appraisal.create({
      data: { sheetId: ctx.miaSheet.id, selfSubmittedAt: new Date() },
    });

    const body = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}`);
    const mia = body.items.find((item) => item.userName === 'Mia');

    expect(mia?.actions).toContain('APPROVE');
    // RATE_REPORT is DIRECT_REPORT only: a skip-level manager influences the
    // outcome through calibration, not by rating someone they do not work with.
    expect(mia?.actions).not.toContain('RATE');
  });

  it('offers a rating on a direct report whose self-appraisal is in', async () => {
    const ctx = await org();

    const body = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}`);
    const sam = body.items.find((item) => item.userName === 'Sam');

    expect(sam?.selfAppraisalSubmitted).toBe(true);
    expect(sam?.actions).toEqual(['RATE']);
  });

  it('withholds the rating until the self-appraisal is submitted', async () => {
    const ctx = await org();
    await prisma.appraisal.update({
      where: { sheetId: ctx.samSheet.id },
      data: { selfSubmittedAt: null },
    });

    const body = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}`);

    expect(body.items.find((item) => item.userName === 'Sam')?.actions).toEqual([]);
  });

  it('drops rows with nothing outstanding when asked for my action only', async () => {
    const ctx = await org();
    await prisma.appraisal.update({
      where: { sheetId: ctx.samSheet.id },
      data: { selfSubmittedAt: null },
    });

    const body = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}&awaitingMyAction=true`);

    expect(body.items.map((item) => item.userName).sort()).toEqual(['Mia', 'Priya']);
  });

  it('counts what there is to do, not what there is to look at', async () => {
    const ctx = await org();

    const body = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}`);

    expect(body.counts).toMatchObject({ total: 3, awaitingApproval: 2, awaitingRating: 1 });
  });

  it('reports real overdue days, with no floor [F-08]', async () => {
    // Goal setting closed five days ago, so both pending sheets are late.
    const ctx = await org({ goalSettingEndsIn: -5 });

    const body = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}`);
    const priya = body.items.find((item) => item.userName === 'Priya');

    expect(priya?.daysOverdue).toBe(5);
    expect(body.counts.overdue).toBe(2);
    // Most urgent first: the late rows sort above the one that is merely open.
    expect(body.items[0]?.daysOverdue).toBeGreaterThan(0);
  });

  it('is empty rather than forbidden for someone with no reports', async () => {
    const ctx = await org();
    const priya = await memberWithSession(ctx.admin.orgId, 'Solo', ctx.admin.id);

    const body = await queue(priya.cookie, `cycleId=${ctx.cycleId}`);

    // An employee opening the page gets the truthful answer — nothing is
    // waiting on you — rather than a 403 they would have to interpret.
    expect(body.status).toBe(200);
    expect(body.items).toEqual([]);
  });

  it('narrows to one person, and only within the line', async () => {
    const ctx = await org();

    const mine = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}&userId=${ctx.priya.id}`);
    expect(mine.items.map((item) => item.userName)).toEqual(['Priya']);

    // Somebody real, in the same organization, outside the caller's subtree.
    const stranger = await memberWithSession(ctx.admin.orgId, 'Stranger', null);
    await sheetFor(ctx.admin.orgId, stranger.user.id, ctx.cycleId, 'PENDING');

    const theirs = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}&userId=${stranger.user.id}`);

    // A filter is not an authorization: naming an id must not fetch the row.
    // The buttons would have been absent either way; the row itself is the leak.
    expect(theirs.items).toEqual([]);
  });

  it('filters by status', async () => {
    const ctx = await org();

    const body = await queue(ctx.adminCookie, `cycleId=${ctx.cycleId}&status=APPROVED`);

    expect(body.items.map((item) => item.userName)).toEqual(['Sam']);
  });

  it('rejects a malformed cycle id before touching the database', async () => {
    const ctx = await org();

    const response = await request(app).get('/queue?cycleId=not-an-id').set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(400);
  });

  it('does not reach across an organization boundary', async () => {
    const ctx = await org();
    const outsider = await request(app).post('/auth/signup').send({
      organizationName: 'Elsewhere',
      name: 'Other',
      email: uniqueEmail(),
      password: PASSWORD,
    });

    const response = await request(app)
      .get(`/queue?cycleId=${ctx.cycleId}`)
      .set('Cookie', cookiesFrom(outsider));

    expect(response.status).toBe(404);
  });
});

describe('GET /sheets/:id/review [W6-10, W6-11]', () => {
  it('returns the sheet, its owner and the server-computed score', async () => {
    const ctx = await org();

    const response = await request(app)
      .get(`/sheets/${ctx.priyaSheet.id}/review`)
      .set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(200);

    const body = response.body as {
      sheet: { goals: unknown[] };
      owner: { name: string };
      score: { score: number };
    };

    expect(body.owner.name).toBe('Priya');
    expect(body.sheet.goals).toHaveLength(2);
    // The number the manager reads is the one the engine computed, not one the
    // browser worked out for itself (F-07).
    expect(typeof body.score.score).toBe('number');
  });

  it('reconstructs the check-in history from the audit trail [US-702]', async () => {
    const ctx = await org();
    const sam = await memberWithSession(ctx.admin.orgId, 'Sammy', ctx.admin.id);
    const sheet = await sheetFor(ctx.admin.orgId, sam.user.id, ctx.cycleId, 'APPROVED');

    await request(app)
      .post(`/sheets/${sheet.id}/check-in`)
      .set('Cookie', sam.cookie)
      .send({
        updates: [
          { goalId: sheet.goals[0]?.id, actualAchievement: '80', status: 'ON_TRACK' },
          { goalId: sheet.goals[1]?.id, actualAchievement: '', status: 'NOT_STARTED' },
        ],
      });

    const response = await request(app)
      .get(`/sheets/${sheet.id}/review`)
      .set('Cookie', ctx.adminCookie);

    const checkIns = (response.body as { checkIns: { changes: { toActual: string }[] }[] }).checkIns;

    expect(checkIns).toHaveLength(1);
    // Only the goal that actually moved. A check-in posts every goal it can
    // see, so without the diff this would read as "both goals updated".
    expect(checkIns[0]?.changes).toHaveLength(1);
    expect(checkIns[0]?.changes[0]?.toActual).toBe('80');
  });

  it('answers 404, not 403, for a sheet outside the caller’s line', async () => {
    const ctx = await org();
    const stranger = await memberWithSession(ctx.admin.orgId, 'Stranger', ctx.admin.id);

    const response = await request(app)
      .get(`/sheets/${ctx.priyaSheet.id}/review`)
      .set('Cookie', stranger.cookie);

    // A 403 would confirm the id names a real sheet belonging to somebody.
    expect(response.status).toBe(404);
  });
});

import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createUser } from '../auth/index.js';

/** W4-18, W4-19, W4-20 — analytics, the audit trail, and escalations. */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w4-gov-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

const at = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

/** An organization with an active cycle and one team. */
async function govOrg() {
  const signup = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name: 'Admin', email: uniqueEmail(), password: PASSWORD });

  const adminCookie = cookiesFrom(signup);
  const admin = (signup.body as { user: { id: string; orgId: string } }).user;

  const cycleResponse = await request(app)
    .post('/cycles')
    .set('Cookie', adminCookie)
    .send({
      name: `FY-${String(Date.now())}-${String(++seq)}`,
      fiscalYear: 2026,
      timeZone: 'UTC',
      phases: [{ key: 'GOAL_SETTING', label: 'Goals', startsAt: at(-1), endsAt: at(30) }],
      ratingScale: { min: 1, max: 3, labels: { '1': 'Below', '2': 'Meets', '3': 'Exceeds' } },
      escalationRules: { manager: 3, skipLevelHr: 7, rules: ['GOALS_NOT_SUBMITTED'] },
    });

  const cycleId = (cycleResponse.body as { cycle: { id: string } }).cycle.id;
  await request(app)
    .post(`/cycles/${cycleId}/activate`)
    .set('Cookie', adminCookie)
    .send({ confirm: true });

  const team = await request(app)
    .post('/teams')
    .set('Cookie', adminCookie)
    .send({ name: `Platform-${String(++seq)}` });

  return {
    adminCookie,
    admin,
    cycleId,
    teamId: (team.body as { team: { id: string } }).team.id,
  };
}

type Ctx = Awaited<ReturnType<typeof govOrg>>;

const goal = (
  thrustArea: 'BUSINESS_GROWTH' | 'OPERATIONAL_EXCELLENCE',
  uom: 'PERCENT' | 'NUMERIC',
  status: 'NOT_STARTED' | 'COMPLETED',
) => ({
  thrustArea,
  title: `${thrustArea}-${uom}-${status}`,
  uom,
  direction: 'HIGHER_IS_BETTER' as const,
  target: '100',
  weightage: 50,
  status,
});

/** A member of the org with a sheet carrying two goals. */
async function sheetFor(
  ctx: Ctx,
  options: { teamId?: string | null; status?: 'DRAFT' | 'PENDING' | 'APPROVED' } = {},
) {
  const user = await prisma.user.create({
    data: {
      orgId: ctx.admin.orgId,
      email: uniqueEmail(),
      name: 'Priya',
      roles: ['EMPLOYEE'],
      status: 'ACTIVE',
      managerId: ctx.admin.id,
      teamId: options.teamId === undefined ? ctx.teamId : options.teamId,
    },
    select: { id: true },
  });

  return prisma.goalSheet.create({
    data: {
      orgId: ctx.admin.orgId,
      userId: user.id,
      cycleId: ctx.cycleId,
      status: options.status ?? 'DRAFT',
      goals: {
        create: [
          goal('BUSINESS_GROWTH', 'PERCENT', 'COMPLETED'),
          goal('OPERATIONAL_EXCELLENCE', 'NUMERIC', 'NOT_STARTED'),
        ],
      },
    },
    select: { id: true, userId: true },
  });
}

describe('GET /analytics [W4-18]', () => {
  it('counts goals by thrust area, unit and status', async () => {
    const ctx = await govOrg();
    await sheetFor(ctx);
    await sheetFor(ctx);

    const response = await request(app)
      .get(`/analytics?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(200);

    const body = response.body as {
      totalSheets: number;
      totalGoals: number;
      byThrustArea: { bucket: string; count: number }[];
      byUom: { bucket: string; count: number }[];
      byGoalStatus: { bucket: string; count: number }[];
      bySheetStatus: { bucket: string; count: number }[];
    };

    expect(body.totalSheets).toBe(2);
    expect(body.totalGoals).toBe(4);
    expect(body.byThrustArea).toEqual([
      { bucket: 'BUSINESS_GROWTH', count: 2 },
      { bucket: 'OPERATIONAL_EXCELLENCE', count: 2 },
    ]);
    expect(body.byUom.map((row) => row.bucket).sort()).toEqual(['NUMERIC', 'PERCENT']);
    expect(body.byGoalStatus.find((row) => row.bucket === 'COMPLETED')?.count).toBe(2);
    expect(body.bySheetStatus).toEqual([{ bucket: 'DRAFT', count: 2 }]);
  });

  it('filters by team, meaning the team of the sheet owner', async () => {
    const ctx = await govOrg();
    await sheetFor(ctx);
    await sheetFor(ctx, { teamId: null });

    const response = await request(app)
      .get(`/analytics?cycleId=${ctx.cycleId}&teamId=${ctx.teamId}`)
      .set('Cookie', ctx.adminCookie);

    expect((response.body as { totalSheets: number }).totalSheets).toBe(1);
  });

  it('filters by manager', async () => {
    const ctx = await govOrg();
    await sheetFor(ctx);

    const [mine, theirs] = await Promise.all([
      request(app)
        .get(`/analytics?cycleId=${ctx.cycleId}&managerId=${ctx.admin.id}`)
        .set('Cookie', ctx.adminCookie),
      request(app)
        .get(`/analytics?cycleId=${ctx.cycleId}&managerId=clw0000000000000000000000`)
        .set('Cookie', ctx.adminCookie),
    ]);

    expect((mine.body as { totalSheets: number }).totalSheets).toBe(1);
    expect((theirs.body as { totalSheets: number }).totalSheets).toBe(0);
  });

  it('counts nothing from another organization', async () => {
    const ctx = await govOrg();
    await sheetFor(ctx);

    const other = await request(app).post('/auth/signup').send({
      organizationName: 'Rival',
      name: 'Rival Admin',
      email: uniqueEmail(),
      password: PASSWORD,
    });

    // Raw SQL is outside the org-scope extension, so `orgId` in the WHERE
    // clause is the only thing standing between these two organizations.
    const response = await request(app)
      .get(`/analytics?cycleId=${ctx.cycleId}`)
      .set('Cookie', cookiesFrom(other));

    expect(response.status).toBe(404);
  });

  it('refuses a cycle that does not exist', async () => {
    const ctx = await govOrg();

    const response = await request(app)
      .get('/analytics?cycleId=clw0000000000000000000000')
      .set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(404);
  });

  it('requires a cycle rather than scanning everything', async () => {
    const ctx = await govOrg();

    expect((await request(app).get('/analytics').set('Cookie', ctx.adminCookie)).status).toBe(400);
  });

  /**
   * The gate on this task, and the whole of F-13.
   *
   * 10,000 sheets and 20,000 goals, counted by Postgres. The prototype pulled
   * every row into Node and counted with `forEach`, which is O(rows) memory in
   * a serverless function and slowest exactly when analytics matters.
   */
  it('answers in under 500ms over 10,000 sheets', async () => {
    const ctx = await govOrg();

    const users = Array.from({ length: 10_000 }, (_, index) => ({
      orgId: ctx.admin.orgId,
      email: `bulk-${String(Date.now())}-${String(index)}@example.com`,
      name: `Person ${String(index)}`,
      roles: ['EMPLOYEE' as const],
      status: 'ACTIVE' as const,
      managerId: ctx.admin.id,
      teamId: ctx.teamId,
    }));

    await prisma.user.createMany({ data: users });

    const created = await prisma.user.findMany({
      where: { orgId: ctx.admin.orgId, teamId: ctx.teamId },
      select: { id: true },
    });

    await prisma.goalSheet.createMany({
      data: created.map((user) => ({
        orgId: ctx.admin.orgId,
        userId: user.id,
        cycleId: ctx.cycleId,
        status: 'DRAFT' as const,
      })),
    });

    const sheets = await prisma.goalSheet.findMany({
      where: { cycleId: ctx.cycleId },
      select: { id: true },
    });

    await prisma.goal.createMany({
      data: sheets.flatMap((sheet) => [
        { sheetId: sheet.id, ...goal('BUSINESS_GROWTH', 'PERCENT', 'COMPLETED') },
        { sheetId: sheet.id, ...goal('OPERATIONAL_EXCELLENCE', 'NUMERIC', 'NOT_STARTED') },
      ]),
    });

    // Warm the connection, so the measurement is of the query rather than of
    // the pool handing out its first handle.
    await request(app).get(`/analytics?cycleId=${ctx.cycleId}`).set('Cookie', ctx.adminCookie);

    const started = Date.now();
    const response = await request(app)
      .get(`/analytics?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);
    const elapsed = Date.now() - started;

    expect(response.status).toBe(200);
    expect((response.body as { totalSheets: number }).totalSheets).toBe(10_000);
    expect((response.body as { totalGoals: number }).totalGoals).toBe(20_000);
    expect(elapsed).toBeLessThan(500);

    /*
     * The seeded rows are left in place, and that is a decision rather than an
     * oversight — recorded here because the obvious-looking alternative is
     * much worse.
     *
     * A cleanup was tried and reverted. Deleting the organization does not
     * work at all: `AuditEvent.actor` is `onDelete: Restrict` on purpose
     * (US-106 — a departing employee's history is what a disputed appraisal is
     * settled from), so cascading through an admin who has audit rows is
     * refused by the database. Deleting the 10,000 users and their sheets
     * instead *does* work, and took the whole suite from six minutes to two
     * and three quarter hours: Postgres checks the foreign keys pointing at
     * each row one row at a time, and there are forty thousand of them.
     *
     * The database is a disposable Testcontainer destroyed at teardown, so the
     * rows cost nothing after this file. If the leftovers are ever shown to
     * cause a flake elsewhere, the fix is a set-based `DELETE ... USING` in one
     * statement, not a Prisma cascade.
     */
  }, 300_000);
});

describe('GET /compliance [W4-20]', () => {
  it('summarises the cycle without loading the rows it counts', async () => {
    const ctx = await govOrg();
    await sheetFor(ctx, { status: 'APPROVED' });
    await sheetFor(ctx, { status: 'PENDING' });
    await sheetFor(ctx, { status: 'DRAFT' });

    const response = await request(app)
      .get(`/compliance?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(200);

    const body = response.body as {
      sheetsSubmitted: number;
      sheetsApproved: number;
      openEscalations: number;
      totalUsers: number;
    };

    // Submitted counts PENDING and APPROVED: a sheet that has been approved
    // was submitted, and reporting it otherwise makes the funnel go backwards.
    expect(body.sheetsSubmitted).toBe(2);
    expect(body.sheetsApproved).toBe(1);
    expect(body.openEscalations).toBe(0);
    expect(body.totalUsers).toBe(4);
  });

  it('requires a cycle', async () => {
    const ctx = await govOrg();

    expect((await request(app).get('/compliance').set('Cookie', ctx.adminCookie)).status).toBe(400);
  });
});

describe('escalations [W4-20]', () => {
  /** A breach that is genuinely `days` old, with no synthetic minimum. */
  async function escalationFor(ctx: Ctx, days: number) {
    const sheet = await sheetFor(ctx);

    return prisma.escalation.create({
      data: {
        orgId: ctx.admin.orgId,
        cycleId: ctx.cycleId,
        subjectUserId: sheet.userId,
        rule: 'GOALS_NOT_SUBMITTED',
        tier: 'MANAGER',
        dueAt: new Date(Date.now() - days * 86_400_000),
      },
      select: { id: true, subjectUserId: true },
    });
  }

  it('reports real elapsed days, with no four-day floor', async () => {
    const ctx = await govOrg();
    await escalationFor(ctx, 1);

    const response = await request(app)
      .get(`/escalations?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(200);

    const items = (response.body as { items: { daysOverdue: number }[] }).items;

    // The prototype floored this at four with `Math.max(elapsed, 4)`, so a
    // sheet saved seconds earlier reported "4 days overdue" (F-08).
    expect(items).toHaveLength(1);
    expect(items[0]?.daysOverdue).toBe(1);
  });

  it('reports zero for a deadline that has not passed', async () => {
    const ctx = await govOrg();
    await escalationFor(ctx, -3);

    const response = await request(app)
      .get(`/escalations?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);

    expect((response.body as { items: { daysOverdue: number }[] }).items[0]?.daysOverdue).toBe(0);
  });

  it('filters by status and paginates', async () => {
    const ctx = await govOrg();
    await escalationFor(ctx, 5);
    await escalationFor(ctx, 4);
    await escalationFor(ctx, 3);

    const page = await request(app)
      .get(`/escalations?cycleId=${ctx.cycleId}&limit=2`)
      .set('Cookie', ctx.adminCookie);

    const body = page.body as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();

    const rest = await request(app)
      .get(`/escalations?cycleId=${ctx.cycleId}&limit=2&cursor=${String(body.nextCursor)}`)
      .set('Cookie', ctx.adminCookie);

    expect((rest.body as { items: unknown[]; nextCursor: string | null }).items).toHaveLength(1);
    expect((rest.body as { nextCursor: string | null }).nextCursor).toBeNull();
  });

  it('resolves with a note and stops it being active', async () => {
    const ctx = await govOrg();
    const escalation = await escalationFor(ctx, 2);

    const response = await request(app)
      .post(`/escalations/${escalation.id}/resolve`)
      .set('Cookie', ctx.adminCookie)
      .send({ note: 'Spoke to them; sheet submitted this morning.' });

    expect(response.status).toBe(200);

    const after = await prisma.escalation.findUniqueOrThrow({ where: { id: escalation.id } });
    expect(after.status).toBe('RESOLVED');
    expect(after.resolvedById).toBe(ctx.admin.id);
    // The row stays, so the nightly job can re-open this same one if the
    // condition recurs -- which is US-904 without a second table.
    expect(after.resolutionNote).toBe('Spoke to them; sheet submitted this morning.');
  });

  it('requires a note to resolve', async () => {
    const ctx = await govOrg();
    const escalation = await escalationFor(ctx, 2);

    const response = await request(app)
      .post(`/escalations/${escalation.id}/resolve`)
      .set('Cookie', ctx.adminCookie)
      .send({});

    // A resolution with no explanation is indistinguishable from someone
    // clearing their dashboard.
    expect(response.status).toBe(400);
  });

  it('refuses to resolve twice', async () => {
    const ctx = await govOrg();
    const escalation = await escalationFor(ctx, 2);
    const body = { note: 'Handled.' };

    await request(app)
      .post(`/escalations/${escalation.id}/resolve`)
      .set('Cookie', ctx.adminCookie)
      .send(body);

    const again = await request(app)
      .post(`/escalations/${escalation.id}/resolve`)
      .set('Cookie', ctx.adminCookie)
      .send(body);

    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('ALREADY_RESOLVED');
  });

  it('audits the resolution', async () => {
    const ctx = await govOrg();
    const escalation = await escalationFor(ctx, 2);

    await request(app)
      .post(`/escalations/${escalation.id}/resolve`)
      .set('Cookie', ctx.adminCookie)
      .send({ note: 'Handled.' });

    const events = await prisma.auditEvent.findMany({
      where: { entityId: escalation.id, action: 'escalation.resolve' },
    });

    expect(events).toHaveLength(1);
  });

  it('answers 404 for an escalation in another organization', async () => {
    const ctx = await govOrg();
    const escalation = await escalationFor(ctx, 2);
    const other = await govOrg();

    const response = await request(app)
      .post(`/escalations/${escalation.id}/resolve`)
      .set('Cookie', other.adminCookie)
      .send({ note: 'Not mine.' });

    expect(response.status).toBe(404);
  });
});

describe('GET /audit [W4-19]', () => {
  it('returns the trail newest first, with the changed fields', async () => {
    const ctx = await govOrg();

    const response = await request(app).get('/audit').set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(200);

    const items = (
      response.body as { items: { action: string; createdAt: string; changedFields: string[] }[] }
    ).items;

    /*
     * Asserted on the ordering rather than on which action happens to be
     * newest. The first draft expected `cycle.activate` at the top and failed:
     * the fixture creates a team after activating, so `team.create` is newer.
     * The test was wrong, not the endpoint -- and an assertion that pins the
     * fixture's exact sequence breaks every time the fixture grows a step.
     */
    const timestamps = items.map((event) => Date.parse(event.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));

    const activation = items.find((event) => event.action === 'cycle.activate');
    expect(activation?.changedFields).toContain('status');
  });

  it('filters by action prefix, so one verb family can be asked about', async () => {
    const ctx = await govOrg();

    const response = await request(app)
      .get('/audit?action=cycle.')
      .set('Cookie', ctx.adminCookie);

    const items = (response.body as { items: { action: string }[] }).items;

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((event) => event.action.startsWith('cycle.'))).toBe(true);
  });

  it('filters by actor and by entity', async () => {
    const ctx = await govOrg();

    const [byActor, byOther] = await Promise.all([
      request(app).get(`/audit?actorId=${ctx.admin.id}`).set('Cookie', ctx.adminCookie),
      request(app)
        .get('/audit?actorId=clw0000000000000000000000')
        .set('Cookie', ctx.adminCookie),
    ]);

    expect((byActor.body as { items: unknown[] }).items.length).toBeGreaterThan(0);
    expect((byOther.body as { items: unknown[] }).items).toEqual([]);
  });

  it('filters by date range', async () => {
    const ctx = await govOrg();

    const future = await request(app)
      .get(`/audit?from=${encodeURIComponent(at(1))}`)
      .set('Cookie', ctx.adminCookie);

    expect((future.body as { items: unknown[] }).items).toEqual([]);
  });

  it('paginates', async () => {
    const ctx = await govOrg();

    const page = await request(app).get('/audit?limit=1').set('Cookie', ctx.adminCookie);
    const body = page.body as { items: unknown[]; nextCursor: string | null };

    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });

  it('shows one organization nothing of another', async () => {
    const ctx = await govOrg();
    const other = await govOrg();

    const response = await request(app).get('/audit').set('Cookie', other.adminCookie);
    const items = (response.body as { items: { actorId: string }[] }).items;

    expect(items.every((event) => event.actorId !== ctx.admin.id)).toBe(true);
  });

  it('refuses an employee', async () => {
    const ctx = await govOrg();
    const email = uniqueEmail();

    await createUser({ email, password: PASSWORD, name: 'Priya', orgId: ctx.admin.orgId });
    await prisma.user.update({
      where: { email },
      data: { roles: ['EMPLOYEE'], status: 'ACTIVE', managerId: ctx.admin.id },
    });

    const login = await request(app).post('/auth/login').send({ email, password: PASSWORD });
    const response = await request(app).get('/audit').set('Cookie', cookiesFrom(login));

    // VIEW_AUDIT_TRAIL is administrators only. The trail names who did what to
    // whom, which is not a document everyone should be able to read.
    expect(response.status).toBe(403);
  });

  it('has no write path at all', async () => {
    const ctx = await govOrg();

    // Append-only is a property of the surface, not only of the intent. An
    // endpoint that could edit the trail would make every row in it worth less.
    for (const send of [
      request(app).post('/audit').set('Cookie', ctx.adminCookie).send({}),
      request(app).delete('/audit').set('Cookie', ctx.adminCookie),
    ]) {
      expect((await send).status).toBe(404);
    }
  });
});

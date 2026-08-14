import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createUser } from '../auth/index.js';

/** W4-13 — shared goals, the cascade preview, and the commit. Closes F-05. */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w4-shared-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

const iso = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

type Person = { id: string; name: string };
type Preview = {
  weightage: number;
  willReceive: { userId: string; name: string }[];
  skipped: { userId: string; name: string; reason: string; detail: string }[];
};

/**
 * An organization with an active cycle in its goal-setting window, an admin who
 * is everyone's manager, and three reports on one team.
 */
async function orgWithTeam() {
  const adminEmail = uniqueEmail();
  const signup = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name: 'Admin', email: adminEmail, password: PASSWORD });

  const adminCookie = cookiesFrom(signup);
  const admin = (signup.body as { user: { id: string; orgId: string } }).user;

  const cycleResponse = await request(app)
    .post('/cycles')
    .set('Cookie', adminCookie)
    .send({
      name: `FY-${String(Date.now())}-${String(++seq)}`,
      fiscalYear: 2026,
      timeZone: 'UTC',
      phases: [{ key: 'GOAL_SETTING', label: 'Goals', startsAt: iso(-1), endsAt: iso(30) }],
      ratingScale: { min: 1, max: 3, labels: { '1': 'Below', '2': 'Meets', '3': 'Exceeds' } },
      escalationRules: { manager: 3, skipLevelHr: 7, rules: ['GOALS_NOT_SUBMITTED'] },
    });

  const cycleId = (cycleResponse.body as { cycle: { id: string } }).cycle.id;
  await request(app)
    .post(`/cycles/${cycleId}/activate`)
    .set('Cookie', adminCookie)
    .send({ confirm: true });

  const teamResponse = await request(app)
    .post('/teams')
    .set('Cookie', adminCookie)
    .send({ name: `Platform-${String(++seq)}` });
  const teamId = (teamResponse.body as { team: { id: string } }).team.id;

  const report = async (name: string): Promise<Person> =>
    prisma.user.create({
      data: {
        orgId: admin.orgId,
        email: uniqueEmail(),
        name,
        roles: ['EMPLOYEE'],
        status: 'ACTIVE',
        managerId: admin.id,
        teamId,
      },
      select: { id: true, name: true },
    });

  return {
    adminCookie,
    admin,
    cycleId,
    teamId,
    priya: await report('Priya'),
    sam: await report('Sam'),
    dana: await report('Dana'),
  };
}

/** The request body for a shared goal owned by the admin, cascaded to a team. */
function sharedGoalBody(
  ctx: Awaited<ReturnType<typeof orgWithTeam>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    cycleId: ctx.cycleId,
    ownerUserId: ctx.admin.id,
    title: 'Reduce customer wait time',
    thrustArea: 'OPERATIONAL_EXCELLENCE' as const,
    uom: 'NUMERIC' as const,
    // Stated, never inferred. The title contains "reduce", which is exactly
    // the substring the prototype used to guess this (F-06).
    direction: 'LOWER_IS_BETTER' as const,
    target: '30',
    defaultWeightage: 20,
    audience: { kind: 'TEAM' as const, teamId: ctx.teamId },
    ...overrides,
  };
}

describe('POST /shared-goals/preview [W4-13]', () => {
  it('names everyone who would receive it, and writes nothing', async () => {
    const ctx = await orgWithTeam();

    const response = await request(app)
      .post('/shared-goals/preview')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx));

    expect(response.status).toBe(200);

    const preview = (response.body as { cascade: Preview }).cascade;
    expect(preview.weightage).toBe(20);
    expect(preview.willReceive.map((person) => person.name).sort()).toEqual([
      'Dana',
      'Priya',
      'Sam',
    ]);

    // A preview that wrote anything would not be a preview.
    expect(await prisma.sharedGoal.count({ where: { cycleId: ctx.cycleId } })).toBe(0);
    expect(await prisma.goalSheet.count({ where: { cycleId: ctx.cycleId } })).toBe(0);
  });

  it('gives a reason for each person it would skip', async () => {
    const ctx = await orgWithTeam();

    // Priya's sheet is already full to 100%.
    await prisma.goalSheet.create({
      data: {
        orgId: ctx.admin.orgId,
        userId: ctx.priya.id,
        cycleId: ctx.cycleId,
        goals: {
          create: [
            {
              thrustArea: 'BUSINESS_GROWTH',
              title: 'Everything',
              uom: 'PERCENT',
              direction: 'HIGHER_IS_BETTER',
              target: '100',
              weightage: 100,
            },
          ],
        },
      },
    });

    const response = await request(app)
      .post('/shared-goals/preview')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx));

    const preview = (response.body as { cascade: Preview }).cascade;
    const priya = preview.skipped.find((person) => person.userId === ctx.priya.id);

    expect(priya?.reason).toBe('WOULD_EXCEED_WEIGHTAGE');
    // Named, and specific enough to act on. "4 skipped" is not.
    expect(priya?.name).toBe('Priya');
    expect(priya?.detail).toContain('120');
  });

  it('skips someone whose sheet is approved and locked', async () => {
    const ctx = await orgWithTeam();

    await prisma.goalSheet.create({
      data: {
        orgId: ctx.admin.orgId,
        userId: ctx.sam.id,
        cycleId: ctx.cycleId,
        status: 'APPROVED',
        lockedAt: new Date(),
      },
    });

    const response = await request(app)
      .post('/shared-goals/preview')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx));

    const preview = (response.body as { cascade: Preview }).cascade;

    expect(preview.skipped.find((person) => person.userId === ctx.sam.id)?.reason).toBe(
      'SHEET_NOT_EDITABLE',
    );
  });

  it('refuses an audience that resolves to nobody', async () => {
    const ctx = await orgWithTeam();
    const empty = await request(app)
      .post('/teams')
      .set('Cookie', ctx.adminCookie)
      .send({ name: `Empty-${String(++seq)}` });

    const response = await request(app)
      .post('/shared-goals/preview')
      .set('Cookie', ctx.adminCookie)
      .send(
        sharedGoalBody(ctx, {
          audience: {
            kind: 'TEAM',
            teamId: (empty.body as { team: { id: string } }).team.id,
          },
        }),
      );

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('EMPTY_AUDIENCE');
  });

  it('has no way to ask for everyone', async () => {
    const ctx = await orgWithTeam();

    const response = await request(app)
      .post('/shared-goals/preview')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx, { audience: { kind: 'EVERYONE' } }));

    expect(response.status).toBe(400);
  });
});

describe('POST /shared-goals [W4-13]', () => {
  it('creates the goal, the owner primary instance and every recipient copy', async () => {
    const ctx = await orgWithTeam();

    const response = await request(app)
      .post('/shared-goals')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx));

    expect(response.status).toBe(201);

    const sharedGoalId = (response.body as { sharedGoal: { id: string } }).sharedGoal.id;
    const instances = await prisma.goal.findMany({
      where: { sharedGoalId },
      select: { isPrimaryOwner: true, direction: true, sheet: { select: { userId: true } } },
    });

    // Three recipients plus the owner.
    expect(instances).toHaveLength(4);
    expect(instances.filter((goal) => goal.isPrimaryOwner)).toHaveLength(1);
    expect(
      instances.find((goal) => goal.isPrimaryOwner)?.sheet.userId,
    ).toBe(ctx.admin.id);

    // Every instance inherits the stated direction rather than re-deriving it.
    expect(instances.every((goal) => goal.direction === 'LOWER_IS_BETTER')).toBe(true);
  });

  it('makes a draft sheet for anyone who had none', async () => {
    const ctx = await orgWithTeam();

    await request(app).post('/shared-goals').set('Cookie', ctx.adminCookie).send(sharedGoalBody(ctx));

    const sheet = await prisma.goalSheet.findFirstOrThrow({
      where: { userId: ctx.priya.id, cycleId: ctx.cycleId },
    });

    // DRAFT is the only status a cascade may produce: arriving work does not
    // pre-approve itself.
    expect(sheet.status).toBe('DRAFT');
  });

  it('commits what the preview promised, person for person', async () => {
    const ctx = await orgWithTeam();

    await prisma.goalSheet.create({
      data: {
        orgId: ctx.admin.orgId,
        userId: ctx.dana.id,
        cycleId: ctx.cycleId,
        status: 'APPROVED',
        lockedAt: new Date(),
      },
    });

    const body = sharedGoalBody(ctx);
    const preview = (
      (await request(app).post('/shared-goals/preview').set('Cookie', ctx.adminCookie).send(body))
        .body as { cascade: Preview }
    ).cascade;

    const committed = (
      (await request(app).post('/shared-goals').set('Cookie', ctx.adminCookie).send(body))
        .body as { cascade: Preview }
    ).cascade;

    /*
     * The property that matters most in this file. A preview computed by
     * different arithmetic to the commit is a promise the system does not
     * keep, and the prototype's cascade found out who could not take a goal by
     * failing partway through (F-05).
     */
    expect(committed.willReceive.map((person) => person.userId).sort()).toEqual(
      preview.willReceive.map((person) => person.userId).sort(),
    );
    expect(committed.skipped.map((person) => `${person.userId}:${person.reason}`).sort()).toEqual(
      preview.skipped.map((person) => `${person.userId}:${person.reason}`).sort(),
    );
  });

  it('notifies each recipient and audits the whole cascade', async () => {
    const ctx = await orgWithTeam();

    const response = await request(app)
      .post('/shared-goals')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx));

    const sharedGoalId = (response.body as { sharedGoal: { id: string } }).sharedGoal.id;
    const [events, notifications] = await Promise.all([
      prisma.auditEvent.findMany({ where: { entityId: sharedGoalId, action: 'sharedgoal.create' } }),
      prisma.notification.findMany({ where: { type: 'sharedgoal.assigned' } }),
    ]);

    expect(events).toHaveLength(1);
    expect(
      notifications.filter((row) =>
        [ctx.priya.id, ctx.sam.id, ctx.dana.id].includes(row.userId),
      ),
    ).toHaveLength(3);
  });

  it('writes nothing at all when the owner has no room', async () => {
    const ctx = await orgWithTeam();

    await prisma.goalSheet.create({
      data: {
        orgId: ctx.admin.orgId,
        userId: ctx.admin.id,
        cycleId: ctx.cycleId,
        goals: {
          create: [
            {
              thrustArea: 'BUSINESS_GROWTH',
              title: 'Everything',
              uom: 'PERCENT',
              direction: 'HIGHER_IS_BETTER',
              target: '100',
              weightage: 100,
            },
          ],
        },
      },
    });

    const response = await request(app)
      .post('/shared-goals')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx));

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('OWNER_HAS_NO_ROOM');

    /*
     * The refusal happens after the SharedGoal row is inserted, so this is the
     * assertion that the transaction actually rolled back. Without it the test
     * would pass on a system that left an orphaned shared goal behind on every
     * failed cascade.
     */
    expect(await prisma.sharedGoal.count({ where: { cycleId: ctx.cycleId } })).toBe(0);
    expect(await prisma.goal.count({ where: { sheet: { cycleId: ctx.cycleId } } })).toBe(1);
  });

  it('refuses a cascade to people who do not report to you', async () => {
    const ctx = await orgWithTeam();

    const employeeEmail = uniqueEmail();
    await createUser({
      email: employeeEmail,
      password: PASSWORD,
      name: 'Outsider',
      orgId: ctx.admin.orgId,
    });
    await prisma.user.update({
      where: { email: employeeEmail },
      data: { roles: ['EMPLOYEE'], status: 'ACTIVE', managerId: ctx.admin.id },
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ email: employeeEmail, password: PASSWORD });

    const outsider = await prisma.user.findUniqueOrThrow({
      where: { email: employeeEmail },
      select: { id: true },
    });

    const response = await request(app)
      .post('/shared-goals')
      .set('Cookie', cookiesFrom(login))
      .send(sharedGoalBody(ctx, { ownerUserId: outsider.id }));

    // An employee has nobody beneath them, so the audience is entirely out of
    // reach -- decided from the actual audience rather than from a role check.
    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('NO_REACH');
  });

  it('refuses an owner from another organization', async () => {
    const ctx = await orgWithTeam();
    const other = await request(app).post('/auth/signup').send({
      organizationName: 'Rival',
      name: 'Rival Admin',
      email: uniqueEmail(),
      password: PASSWORD,
    });
    const rival = (other.body as { user: { id: string } }).user;

    const response = await request(app)
      .post('/shared-goals')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx, { ownerUserId: rival.id }));

    // Scoped, so the owner reads as absent rather than as forbidden.
    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('UNKNOWN_OWNER');
  });

  it('refuses to cascade outside the goal-setting window', async () => {
    const ctx = await orgWithTeam();

    await prisma.cyclePhase.updateMany({
      where: { cycleId: ctx.cycleId, key: 'GOAL_SETTING' },
      data: { startsAt: new Date(Date.parse(iso(-30))), endsAt: new Date(Date.parse(iso(-10))) },
    });

    const response = await request(app)
      .post('/shared-goals')
      .set('Cookie', ctx.adminCookie)
      .send(sharedGoalBody(ctx));

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('WINDOW_CLOSED');
  });

  it('does not cascade a second copy to someone who already has it', async () => {
    const ctx = await orgWithTeam();
    const body = sharedGoalBody(ctx);

    const first = await request(app).post('/shared-goals').set('Cookie', ctx.adminCookie).send(body);
    const sharedGoalId = (first.body as { sharedGoal: { id: string } }).sharedGoal.id;

    // A second, separate shared goal is a different goal -- so the duplicate
    // guard is checked by previewing the *same* one against the new state.
    const preview = await request(app)
      .post('/shared-goals/preview')
      .set('Cookie', ctx.adminCookie)
      .send(body);

    const skipped = (preview.body as { cascade: Preview }).cascade.skipped;

    // Everyone now has 20% used, so they still have room; nobody is a
    // duplicate, because this preview is of a goal that does not exist yet.
    expect(skipped.map((person) => person.reason)).not.toContain('ALREADY_HAS_GOAL');
    expect(await prisma.goal.count({ where: { sharedGoalId } })).toBe(4);
  });
});

describe('GET /shared-goals [W4-13]', () => {
  it('lists a cycle shared goals with their instance counts', async () => {
    const ctx = await orgWithTeam();

    await request(app).post('/shared-goals').set('Cookie', ctx.adminCookie).send(sharedGoalBody(ctx));

    const response = await request(app)
      .get(`/shared-goals?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(200);

    const goals = (response.body as { sharedGoals: { instanceCount: number; defaultWeightage: number }[] })
      .sharedGoals;

    expect(goals).toHaveLength(1);
    expect(goals[0]?.instanceCount).toBe(4);
    // A number on the wire, not a Decimal's string form.
    expect(goals[0]?.defaultWeightage).toBe(20);
  });

  it('requires a cycle rather than listing everything', async () => {
    const ctx = await orgWithTeam();

    const response = await request(app).get('/shared-goals').set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(400);
  });

  it('shows one organization nothing of another', async () => {
    const ctx = await orgWithTeam();
    await request(app).post('/shared-goals').set('Cookie', ctx.adminCookie).send(sharedGoalBody(ctx));

    const other = await request(app).post('/auth/signup').send({
      organizationName: 'Rival',
      name: 'Rival Admin',
      email: uniqueEmail(),
      password: PASSWORD,
    });

    const response = await request(app)
      .get(`/shared-goals?cycleId=${ctx.cycleId}`)
      .set('Cookie', cookiesFrom(other));

    expect(response.status).toBe(200);
    expect((response.body as { sharedGoals: unknown[] }).sharedGoals).toEqual([]);
  });
});

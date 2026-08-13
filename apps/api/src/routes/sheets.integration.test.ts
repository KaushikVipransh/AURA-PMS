import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

/**
 * W4-03, W4-05, W4-06, W4-07 and W4-11 over real HTTP.
 *
 * The check-in block is the F-04 regression: the prototype's check-in route
 * took the client's whole payload and wrote it over an approved sheet.
 */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w4-sheets-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

async function newOrg() {
  const email = uniqueEmail();
  const response = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name: 'Admin', email, password: PASSWORD });

  const body = response.body as { user: { id: string; orgId: string } };

  return { cookie: cookiesFrom(response), userId: body.user.id, orgId: body.user.orgId };
}

const iso = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString();

/** A cycle whose goal-setting window is open right now. */
function cycleBody(name: string) {
  return {
    name,
    fiscalYear: 2026,
    timeZone: 'UTC',
    phases: [
      { key: 'GOAL_SETTING', label: 'Goal setting', startsAt: iso(-1), endsAt: iso(30) },
      { key: 'CHECK_IN', label: 'Check-in', startsAt: iso(31), endsAt: iso(60) },
    ],
    ratingScale: { min: 1, max: 3, labels: { '1': 'Below', '2': 'Meets', '3': 'Exceeds' } },
    escalationRules: { manager: 3, skipLevelHr: 7, rules: ['GOALS_NOT_SUBMITTED'] },
  };
}

const goal = (weightage: number, title: string) => ({
  thrustArea: 'OPERATIONAL_EXCELLENCE' as const,
  title,
  uom: 'PERCENT' as const,
  direction: 'HIGHER_IS_BETTER' as const,
  target: '100',
  weightage,
});

/** An org with an active cycle and a saved draft sheet. */
async function orgWithDraft() {
  const org = await newOrg();

  const cycleResponse = await request(app)
    .post('/cycles')
    .set('Cookie', org.cookie)
    .send(cycleBody(`FY${String(++seq)}-${String(Date.now())}`));

  const cycleId = (cycleResponse.body as { cycle: { id: string } }).cycle.id;

  await request(app).post(`/cycles/${cycleId}/activate`).set('Cookie', org.cookie).send({ confirm: true });

  const draft = await request(app)
    .put(`/sheets/${cycleId}`)
    .set('Cookie', org.cookie)
    .send({ goals: [goal(40, 'Uptime'), goal(30, 'Latency'), goal(30, 'Cost')] });

  return { ...org, cycleId, draft };
}

describe('GET /me [W4-03]', () => {
  it('reports the signed-in user', async () => {
    const org = await newOrg();

    const response = await request(app).get('/me').set('Cookie', org.cookie);

    expect(response.status).toBe(200);
    expect((response.body as { user: { id: string } }).user.id).toBe(org.userId);
    expect((response.body as { user: { timeZone: string } }).user.timeZone).toBe('UTC');
  });

  it('needs a session', async () => {
    expect((await request(app).get('/me')).status).toBe(401);
  });
});

describe('cycles [W4-05]', () => {
  it('creates a cycle with its phases', async () => {
    const org = await newOrg();

    const response = await request(app)
      .post('/cycles')
      .set('Cookie', org.cookie)
      .send(cycleBody(`FY-create-${String(Date.now())}`));

    expect(response.status).toBe(201);
    expect((response.body as { cycle: { phases: unknown[] } }).cycle.phases).toHaveLength(2);
  });

  it('refuses overlapping phases, using the same check the resolver uses', async () => {
    const org = await newOrg();
    const body = cycleBody(`FY-overlap-${String(Date.now())}`);

    const response = await request(app)
      .post('/cycles')
      .set('Cookie', org.cookie)
      .send({
        ...body,
        phases: [
          { key: 'GOAL_SETTING', label: 'A', startsAt: iso(0), endsAt: iso(20) },
          { key: 'CHECK_IN', label: 'B', startsAt: iso(10), endsAt: iso(30) },
        ],
      });

    expect(response.status).toBe(400);
  });

  it('allows only one active cycle at a time', async () => {
    const org = await newOrg();

    const first = await request(app)
      .post('/cycles')
      .set('Cookie', org.cookie)
      .send(cycleBody(`FY-a-${String(Date.now())}-${String(++seq)}`));
    const second = await request(app)
      .post('/cycles')
      .set('Cookie', org.cookie)
      .send(cycleBody(`FY-b-${String(Date.now())}-${String(++seq)}`));

    const firstId = (first.body as { cycle: { id: string } }).cycle.id;
    const secondId = (second.body as { cycle: { id: string } }).cycle.id;

    expect(
      (await request(app).post(`/cycles/${firstId}/activate`).set('Cookie', org.cookie).send({ confirm: true }))
        .status,
    ).toBe(200);

    // review_cycles_one_active_per_org is a partial unique index, so the
    // database would refuse this even if the check above were removed.
    const conflict = await request(app)
      .post(`/cycles/${secondId}/activate`)
      .set('Cookie', org.cookie)
      .send({ confirm: true });

    expect(conflict.status).toBe(409);
  });

  it('cannot see another organization’s cycles', async () => {
    const org = await newOrg();
    const other = await newOrg();

    await request(app)
      .post('/cycles')
      .set('Cookie', other.cookie)
      .send(cycleBody(`FY-other-${String(Date.now())}`));

    const response = await request(app).get('/cycles').set('Cookie', org.cookie);

    expect((response.body as { cycles: unknown[] }).cycles).toEqual([]);
  });

  it('audits the creation', async () => {
    const org = await newOrg();
    const created = await request(app)
      .post('/cycles')
      .set('Cookie', org.cookie)
      .send(cycleBody(`FY-audit-${String(Date.now())}`));

    const id = (created.body as { cycle: { id: string } }).cycle.id;
    const events = await prisma.auditEvent.findMany({ where: { entityId: id } });

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('cycle.create');
  });
});

describe('goal sheets [W4-06, W4-07]', () => {
  it('saves a draft and reads it back with a computed score', async () => {
    const ctx = await orgWithDraft();

    expect(ctx.draft.status).toBe(200);

    const read = await request(app).get(`/sheets/${ctx.cycleId}`).set('Cookie', ctx.cookie);

    expect(read.status).toBe(200);
    expect((read.body as { sheet: { goals: unknown[] } }).sheet.goals).toHaveLength(3);
    // Scored on the server by the W2-01 engine, never in the browser (F-07).
    expect((read.body as { score: { score: number } }).score.score).toBe(0);
  });

  it('submits a valid sheet and records a revision', async () => {
    const ctx = await orgWithDraft();
    const sheetId = (ctx.draft.body as { sheet: { id: string } }).sheet.id;

    const response = await request(app)
      .post(`/sheets/${sheetId}/submit`)
      .set('Cookie', ctx.cookie)
      .send({});

    expect(response.status).toBe(200);
    expect((response.body as { sheet: { status: string } }).sheet.status).toBe('PENDING');

    const revisions = await prisma.sheetRevision.findMany({ where: { sheetId } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revision).toBe(1);
  });

  it('refuses a sheet whose weightages do not add up, saying why', async () => {
    const org = await newOrg();
    const cycleResponse = await request(app)
      .post('/cycles')
      .set('Cookie', org.cookie)
      .send(cycleBody(`FY-bad-${String(Date.now())}`));
    const cycleId = (cycleResponse.body as { cycle: { id: string } }).cycle.id;

    await request(app).post(`/cycles/${cycleId}/activate`).set('Cookie', org.cookie).send({ confirm: true });

    const draft = await request(app)
      .put(`/sheets/${cycleId}`)
      .set('Cookie', org.cookie)
      .send({ goals: [goal(30, 'A'), goal(30, 'B'), goal(30, 'C')] });

    const sheetId = (draft.body as { sheet: { id: string } }).sheet.id;
    const response = await request(app)
      .post(`/sheets/${sheetId}/submit`)
      .set('Cookie', org.cookie)
      .send({});

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('90');
  });

  it('refuses a second submit', async () => {
    const ctx = await orgWithDraft();
    const sheetId = (ctx.draft.body as { sheet: { id: string } }).sheet.id;

    await request(app).post(`/sheets/${sheetId}/submit`).set('Cookie', ctx.cookie).send({});
    const second = await request(app)
      .post(`/sheets/${sheetId}/submit`)
      .set('Cookie', ctx.cookie)
      .send({});

    expect(second.status).toBe(409);
  });

  it('refuses an edit once submitted', async () => {
    const ctx = await orgWithDraft();
    const sheetId = (ctx.draft.body as { sheet: { id: string } }).sheet.id;

    await request(app).post(`/sheets/${sheetId}/submit`).set('Cookie', ctx.cookie).send({});

    const response = await request(app)
      .put(`/sheets/${ctx.cycleId}`)
      .set('Cookie', ctx.cookie)
      .send({ goals: [goal(100, 'Sneaky')] });

    expect(response.status).toBe(409);
  });
});

describe('check-in field whitelist [W4-11] — F-04', () => {
  /** A sheet moved to APPROVED, as a manager would leave it. */
  async function approvedSheet() {
    const ctx = await orgWithDraft();
    const sheetId = (ctx.draft.body as { sheet: { id: string } }).sheet.id;

    await request(app).post(`/sheets/${sheetId}/submit`).set('Cookie', ctx.cookie).send({});
    await prisma.goalSheet.update({
      where: { id: sheetId },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });

    const goals = await prisma.goal.findMany({ where: { sheetId }, orderBy: { title: 'asc' } });

    return { ...ctx, sheetId, goals };
  }

  it('writes the achievement and status', async () => {
    const ctx = await approvedSheet();
    const target = ctx.goals[0];

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/check-in`)
      .set('Cookie', ctx.cookie)
      .send({
        updates: [{ goalId: target?.id ?? '', actualAchievement: '87', status: 'ON_TRACK' }],
      });

    expect(response.status).toBe(200);

    const updated = await prisma.goal.findUniqueOrThrow({ where: { id: target?.id ?? '' } });
    expect(updated.actualAchievement).toBe('87');
    expect(updated.status).toBe('ON_TRACK');
  });

  it('ignores title, target and weightage in the payload', async () => {
    const ctx = await approvedSheet();
    const target = ctx.goals[0];
    const before = await prisma.goal.findUniqueOrThrow({ where: { id: target?.id ?? '' } });

    await request(app)
      .post(`/sheets/${ctx.sheetId}/check-in`)
      .set('Cookie', ctx.cookie)
      .send({
        updates: [
          {
            goalId: target?.id ?? '',
            actualAchievement: '50',
            status: 'ON_TRACK',
            // Everything below is what the prototype happily wrote through.
            title: 'Rewritten by the client',
            target: '1',
            weightage: 99,
            thrustArea: 'BUSINESS_GROWTH',
            direction: 'LOWER_IS_BETTER',
          },
        ],
      });

    const after = await prisma.goal.findUniqueOrThrow({ where: { id: target?.id ?? '' } });

    expect(after.title).toBe(before.title);
    expect(after.target).toBe(before.target);
    expect(after.weightage.toString()).toBe(before.weightage.toString());
    expect(after.thrustArea).toBe(before.thrustArea);
    expect(after.direction).toBe(before.direction);
    // ...while the two writable fields did change.
    expect(after.actualAchievement).toBe('50');
  });

  it('refuses a goal id from a different sheet', async () => {
    const mine = await approvedSheet();
    const theirs = await approvedSheet();

    const response = await request(app)
      .post(`/sheets/${mine.sheetId}/check-in`)
      .set('Cookie', mine.cookie)
      .send({
        updates: [
          { goalId: theirs.goals[0]?.id ?? '', actualAchievement: '99', status: 'COMPLETED' },
        ],
      });

    // Org scoping stops another tenant's goals; nothing else stops another
    // sheet's, so the service checks membership explicitly.
    expect(response.status).toBe(409);
  });

  it('refuses a check-in against a sheet that is not approved', async () => {
    const ctx = await orgWithDraft();
    const sheetId = (ctx.draft.body as { sheet: { id: string } }).sheet.id;
    const goals = await prisma.goal.findMany({ where: { sheetId } });

    const response = await request(app)
      .post(`/sheets/${sheetId}/check-in`)
      .set('Cookie', ctx.cookie)
      .send({
        updates: [{ goalId: goals[0]?.id ?? '', actualAchievement: '10', status: 'ON_TRACK' }],
      });

    expect(response.status).toBe(409);
  });

  it('audits the check-in with a field-level diff', async () => {
    const ctx = await approvedSheet();
    const target = ctx.goals[0];

    await request(app)
      .post(`/sheets/${ctx.sheetId}/check-in`)
      .set('Cookie', ctx.cookie)
      .send({
        updates: [{ goalId: target?.id ?? '', actualAchievement: '61', status: 'ON_TRACK' }],
      });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: ctx.sheetId, action: 'goalsheet.checkin' },
      orderBy: { createdAt: 'desc' },
    });

    expect(JSON.stringify(event.after)).toContain('61');
  });
});

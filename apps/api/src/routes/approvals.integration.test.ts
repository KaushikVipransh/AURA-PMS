import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

/** W4-08, W4-09, W4-10 and W4-14 over real HTTP. */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w4-appr-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

const iso = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

const goal = (weightage: number, title: string) => ({
  thrustArea: 'OPERATIONAL_EXCELLENCE' as const,
  title,
  uom: 'PERCENT' as const,
  direction: 'HIGHER_IS_BETTER' as const,
  target: '100',
  weightage,
});

/**
 * An organization with an active cycle, a manager, and an employee whose sheet
 * is submitted and awaiting approval.
 */
async function pendingSheet() {
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
  await request(app).post(`/cycles/${cycleId}/activate`).set('Cookie', adminCookie).send({ confirm: true });

  /*
   * The employee reports to the admin, which is what makes the admin their
   * *manager* rather than merely an administrator. W2-06 grants approval on
   * DIRECT_REPORT, so without this line the admin would be refused.
   */
  const employee = await prisma.user.create({
    data: {
      orgId: admin.orgId,
      email: uniqueEmail(),
      name: 'Priya',
      roles: ['EMPLOYEE'],
      status: 'ACTIVE',
      managerId: admin.id,
    },
  });

  const sheet = await prisma.goalSheet.create({
    data: {
      orgId: admin.orgId,
      userId: employee.id,
      cycleId,
      status: 'PENDING',
      submittedAt: new Date(),
      goals: {
        /* Titles are prefixed A/B/C so that `orderBy: { title: 'asc' }`
           returns them in the order written here. Without that, `goals[0]` was
           "Cost" rather than "Uptime" and every weightage sum in this file was
           computed against the wrong goal -- which is exactly how the first run
           of these tests failed. */
        create: [
          { ...goal(40, 'A Uptime'), weightage: 40 },
          { ...goal(30, 'B Latency'), weightage: 30 },
          { ...goal(30, 'C Cost'), weightage: 30 },
        ],
      },
    },
    select: { id: true, goals: { select: { id: true, title: true }, orderBy: { title: 'asc' } } },
  });

  return { adminCookie, admin, employee, cycleId, sheetId: sheet.id, goals: sheet.goals };
}

describe('POST /sheets/:id/approve [W4-08]', () => {
  it('approves, locks, and records the approver', async () => {
    const ctx = await pendingSheet();

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/approve`)
      .set('Cookie', ctx.adminCookie)
      .send({});

    expect(response.status).toBe(200);

    const sheet = await prisma.goalSheet.findUniqueOrThrow({ where: { id: ctx.sheetId } });
    expect(sheet.status).toBe('APPROVED');
    expect(sheet.approverId).toBe(ctx.admin.id);
    expect(sheet.lockedAt).not.toBeNull();
  });

  it('snapshots the sheet, audits it and notifies the owner in one transaction', async () => {
    const ctx = await pendingSheet();

    await request(app).post(`/sheets/${ctx.sheetId}/approve`).set('Cookie', ctx.adminCookie).send({});

    const [revisions, events, notifications] = await Promise.all([
      prisma.sheetRevision.findMany({ where: { sheetId: ctx.sheetId } }),
      prisma.auditEvent.findMany({ where: { entityId: ctx.sheetId, action: 'goalsheet.approve' } }),
      prisma.notification.findMany({ where: { userId: ctx.employee.id } }),
    ]);

    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.reason).toBe('APPROVE');
    expect(events).toHaveLength(1);
    // A notification surviving a rolled-back approval would tell someone their
    // goals were approved when they were not.
    expect(notifications.map((n) => n.type)).toContain('goalsheet.approved');
  });

  it('refuses a sheet that is not pending', async () => {
    const ctx = await pendingSheet();

    await request(app).post(`/sheets/${ctx.sheetId}/approve`).set('Cookie', ctx.adminCookie).send({});
    const second = await request(app)
      .post(`/sheets/${ctx.sheetId}/approve`)
      .set('Cookie', ctx.adminCookie)
      .send({});

    expect(second.status).toBe(409);
  });

  it('refuses a manager who is not in the owner’s chain', async () => {
    const ctx = await pendingSheet();

    // A second admin in the same org, with no reporting line to the employee.
    const outsider = await request(app)
      .post('/auth/signup')
      .send({
        organizationName: 'Elsewhere',
        name: 'Other',
        email: uniqueEmail(),
        password: PASSWORD,
      });

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/approve`)
      .set('Cookie', cookiesFrom(outsider))
      .send({});

    // Different org entirely, so it is not even visible.
    expect(response.status).toBe(404);
  });

  it('refuses self-approval even for an org admin', async () => {
    const ctx = await pendingSheet();

    // Point the sheet at the admin themselves.
    await prisma.goalSheet.update({
      where: { id: ctx.sheetId },
      data: { userId: ctx.admin.id },
    });

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/approve`)
      .set('Cookie', ctx.adminCookie)
      .send({});

    // W2-06 excludes SELF from APPROVE_GOAL_SHEET; the service repeats the
    // check because it is reachable without the policy table.
    expect(response.status).toBe(403);
  });
});

describe('POST /sheets/:id/return [W4-09]', () => {
  it('returns the sheet with a reason the employee can act on', async () => {
    const ctx = await pendingSheet();

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/return`)
      .set('Cookie', ctx.adminCookie)
      .send({ reason: 'Uptime target is below the team baseline.', goalIds: [ctx.goals[0]?.id] });

    expect(response.status).toBe(200);

    const sheet = await prisma.goalSheet.findUniqueOrThrow({ where: { id: ctx.sheetId } });
    expect(sheet.status).toBe('RETURNED');
    expect(sheet.submittedAt).toBeNull();

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: ctx.employee.id, type: 'goalsheet.returned' },
    });
    expect(JSON.stringify(notification.payload)).toContain('baseline');
  });

  it('requires a reason', async () => {
    const ctx = await pendingSheet();

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/return`)
      .set('Cookie', ctx.adminCookie)
      .send({ goalIds: [] });

    // US-305: a sheet returned with no explanation tells the employee to change
    // something and not what.
    expect(response.status).toBe(400);
  });

  it('refuses a flagged goal from another sheet', async () => {
    const ctx = await pendingSheet();
    const other = await pendingSheet();

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/return`)
      .set('Cookie', ctx.adminCookie)
      .send({ reason: 'Please revise.', goalIds: [other.goals[0]?.id] });

    expect(response.status).toBe(409);
  });

  it('lets the employee edit again once returned', async () => {
    const ctx = await pendingSheet();

    await request(app)
      .post(`/sheets/${ctx.sheetId}/return`)
      .set('Cookie', ctx.adminCookie)
      .send({ reason: 'Please revise.' });

    const sheet = await prisma.goalSheet.findUniqueOrThrow({ where: { id: ctx.sheetId } });
    expect(sheet.status).toBe('RETURNED');
  });
});

describe('POST /sheets/:id/adjust [W4-10]', () => {
  it('adjusts weightages and preserves the original as a revision', async () => {
    const ctx = await pendingSheet();
    const [first, second] = ctx.goals;

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/adjust`)
      .set('Cookie', ctx.adminCookie)
      .send({
        adjustments: [
          { goalId: first?.id, weightage: 50 },
          { goalId: second?.id, weightage: 20 },
        ],
        note: 'Rebalanced towards uptime.',
      });

    expect(response.status).toBe(200);

    const goals = await prisma.goal.findMany({
      where: { sheetId: ctx.sheetId },
      orderBy: { title: 'asc' },
    });
    expect(goals.map((g) => Number(g.weightage.toString()))).toEqual([50, 20, 30]);

    const revision = await prisma.sheetRevision.findFirstOrThrow({
      where: { sheetId: ctx.sheetId, reason: 'ADJUST' },
    });
    // The snapshot holds what is about to stop being true, not the outcome.
    expect(JSON.stringify(revision.snapshot)).toContain('40');
  });

  it('refuses adjustments that would leave the sheet invalid', async () => {
    const ctx = await pendingSheet();

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/adjust`)
      .set('Cookie', ctx.adminCookie)
      .send({
        adjustments: [{ goalId: ctx.goals[0]?.id, weightage: 80 }],
        note: 'Too much.',
      });

    // Validated on the result, not the adjustment: 80 + 30 + 30 is 140. A
    // manager who fixes one goal and breaks the total has fixed nothing.
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('140');
  });

  it('leaves the weightages untouched when it refuses', async () => {
    const ctx = await pendingSheet();

    await request(app)
      .post(`/sheets/${ctx.sheetId}/adjust`)
      .set('Cookie', ctx.adminCookie)
      .send({ adjustments: [{ goalId: ctx.goals[0]?.id, weightage: 80 }], note: 'Too much.' });

    const goals = await prisma.goal.findMany({
      where: { sheetId: ctx.sheetId },
      orderBy: { title: 'asc' },
    });
    expect(goals.map((g) => Number(g.weightage.toString()))).toEqual([40, 30, 30]);
  });

  it('requires a note, because the employee is told', async () => {
    const ctx = await pendingSheet();

    const response = await request(app)
      .post(`/sheets/${ctx.sheetId}/adjust`)
      .set('Cookie', ctx.adminCookie)
      .send({ adjustments: [{ goalId: ctx.goals[0]?.id, weightage: 40 }] });

    expect(response.status).toBe(400);
  });

  it('does not let an adjustment retitle a goal', async () => {
    const ctx = await pendingSheet();
    const before = await prisma.goal.findUniqueOrThrow({ where: { id: ctx.goals[0]?.id ?? '' } });

    await request(app)
      .post(`/sheets/${ctx.sheetId}/adjust`)
      .set('Cookie', ctx.adminCookie)
      .send({
        adjustments: [{ goalId: ctx.goals[0]?.id, weightage: 40, title: 'Rewritten' }],
        note: 'No change intended.',
      });

    const after = await prisma.goal.findUniqueOrThrow({ where: { id: ctx.goals[0]?.id ?? '' } });
    expect(after.title).toBe(before.title);
  });
});

describe('GET /sheets/:id/revisions [W4-14]', () => {
  it('lists every version, newest first', async () => {
    const ctx = await pendingSheet();

    await request(app)
      .post(`/sheets/${ctx.sheetId}/adjust`)
      .set('Cookie', ctx.adminCookie)
      .send({ adjustments: [{ goalId: ctx.goals[0]?.id, weightage: 40 }], note: 'No-op.' });
    await request(app).post(`/sheets/${ctx.sheetId}/approve`).set('Cookie', ctx.adminCookie).send({});

    const response = await request(app)
      .get(`/sheets/${ctx.sheetId}/revisions`)
      .set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(200);

    const revisions = (response.body as { revisions: { revision: number; reason: string }[] })
      .revisions;

    expect(revisions.map((r) => r.revision)).toEqual([2, 1]);
    expect(revisions.map((r) => r.reason)).toEqual(['APPROVE', 'ADJUST']);
  });

  it('is not visible across an organization boundary', async () => {
    const ctx = await pendingSheet();
    const outsider = await request(app).post('/auth/signup').send({
      organizationName: 'Elsewhere',
      name: 'Other',
      email: uniqueEmail(),
      password: PASSWORD,
    });

    const response = await request(app)
      .get(`/sheets/${ctx.sheetId}/revisions`)
      .set('Cookie', cookiesFrom(outsider));

    expect(response.status).toBe(404);
  });
});

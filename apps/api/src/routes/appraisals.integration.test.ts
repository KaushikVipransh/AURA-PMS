import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createUser } from '../auth/index.js';
import { onScale, readScale, selfAppraisalIsReady } from '../services/appraisals.js';

/** W4-15, W4-16, W4-17 — the appraisal chain, over real HTTP. */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w4-appraise-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

const at = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

type PhaseName = 'APPRAISAL' | 'CALIBRATION' | 'RESULTS';

/**
 * Phase windows with one of them open right now.
 *
 * Built rather than fixed, because three of these tasks are gated on three
 * different phases and W2-03 refuses overlapping windows — so "make the phase
 * I need current" has to move the others out of the way.
 */
function phasesWith(current: PhaseName) {
  const order: PhaseName[] = ['APPRAISAL', 'CALIBRATION', 'RESULTS'];
  const index = order.indexOf(current);

  return [
    { key: 'GOAL_SETTING' as const, label: 'Goals', startsAt: at(-100), endsAt: at(-90) },
    ...order.map((key, position) => {
      const offset = (position - index) * 10;

      return {
        key,
        label: key,
        startsAt: at(offset - 1),
        endsAt: at(offset + 5),
      };
    }),
  ];
}

type Ctx = Awaited<ReturnType<typeof appraisalOrg>>;

/**
 * An organization with an approved sheet ready to be appraised.
 *
 * Two goals with real actuals, so the computed score is a number the tests can
 * reason about rather than zero: 80 of 100 at 60% weight and 40 of 50 at 40%
 * both score 0.8, so the sheet scores 0.8 exactly.
 */
async function appraisalOrg(
  options: { phase?: PhaseName; selfAppraisalDueAt?: string } = {},
) {
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
      phases: phasesWith(options.phase ?? 'APPRAISAL'),
      ratingScale: {
        min: 1,
        max: 5,
        labels: { '1': 'Well below', '2': 'Below', '3': 'Meets', '4': 'Above', '5': 'Outstanding' },
      },
      escalationRules: { manager: 3, skipLevelHr: 7, rules: ['GOALS_NOT_SUBMITTED'] },
      ...(options.selfAppraisalDueAt === undefined
        ? {}
        : { selfAppraisalDueAt: options.selfAppraisalDueAt }),
    });

  const cycleId = (cycleResponse.body as { cycle: { id: string } }).cycle.id;
  await request(app)
    .post(`/cycles/${cycleId}/activate`)
    .set('Cookie', adminCookie)
    .send({ confirm: true });

  // A real account and a real session: WRITE_SELF_APPRAISAL is SELF-only, so
  // borrowing the admin's cookie would test nothing.
  const employeeEmail = uniqueEmail();
  await createUser({ email: employeeEmail, password: PASSWORD, name: 'Priya', orgId: admin.orgId });
  const employee = await prisma.user.update({
    where: { email: employeeEmail },
    data: { roles: ['EMPLOYEE'], status: 'ACTIVE', managerId: admin.id },
    select: { id: true, name: true },
  });
  const employeeCookie = cookiesFrom(
    await request(app).post('/auth/login').send({ email: employeeEmail, password: PASSWORD }),
  );

  const sheet = await prisma.goalSheet.create({
    data: {
      orgId: admin.orgId,
      userId: employee.id,
      cycleId,
      status: 'APPROVED',
      approvedAt: new Date(),
      approverId: admin.id,
      lockedAt: new Date(),
      goals: {
        create: [
          {
            thrustArea: 'OPERATIONAL_EXCELLENCE',
            title: 'A Uptime',
            uom: 'NUMERIC',
            direction: 'HIGHER_IS_BETTER',
            target: '100',
            actualAchievement: '80',
            weightage: 60,
            status: 'COMPLETED',
          },
          {
            thrustArea: 'BUSINESS_GROWTH',
            title: 'B Accounts',
            uom: 'NUMERIC',
            direction: 'HIGHER_IS_BETTER',
            target: '50',
            actualAchievement: '40',
            weightage: 40,
            status: 'COMPLETED',
          },
        ],
      },
    },
    select: { id: true, goals: { select: { id: true, title: true }, orderBy: { title: 'asc' } } },
  });

  return {
    adminCookie,
    admin,
    employee,
    employeeCookie,
    cycleId,
    sheetId: sheet.id,
    goalIds: sheet.goals.map((goal) => goal.id),
  };
}

const selfBody = (ctx: Ctx, extra: Record<string, unknown> = {}) => ({
  entries: ctx.goalIds.map((goalId) => ({ goalId, commentary: 'I did the thing.' })),
  summary: 'A steady year.',
  ...extra,
});

const ratingBody = (ctx: Ctx, extra: Record<string, unknown> = {}) => ({
  ratings: ctx.goalIds.map((goalId) => ({ goalId, rating: 4, commentary: 'Strong delivery.' })),
  overallRating: 4,
  justification: 'Consistently above the bar.',
  ...extra,
});

/** Put the sheet through self-appraisal and rating, ready for calibration. */
async function rated(ctx: Ctx) {
  await request(app)
    .post(`/appraisals/${ctx.sheetId}/self/submit`)
    .set('Cookie', ctx.employeeCookie)
    .send(selfBody(ctx));

  await request(app)
    .post(`/appraisals/${ctx.sheetId}/rating`)
    .set('Cookie', ctx.adminCookie)
    .send(ratingBody(ctx));

  return prisma.appraisal.findUniqueOrThrow({ where: { sheetId: ctx.sheetId } });
}

describe('selfAppraisalIsReady [W4-16]', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('is ready once the employee has submitted', () => {
    expect(selfAppraisalIsReady(new Date('2026-06-01T00:00:00Z'), null, now)).toBe(true);
  });

  it('is ready once the deadline has passed, submitted or not', () => {
    expect(selfAppraisalIsReady(null, new Date('2026-06-14T00:00:00Z'), now)).toBe(true);
  });

  it('is not ready before the deadline', () => {
    expect(selfAppraisalIsReady(null, new Date('2026-06-16T00:00:00Z'), now)).toBe(false);
  });

  it('is ready exactly at the deadline', () => {
    expect(selfAppraisalIsReady(null, now, now)).toBe(true);
  });

  it('waits indefinitely when there is no deadline', () => {
    /*
     * Null means "no clock", and the manager waits. The opposite default would
     * let a manager rate someone who was never given the chance to speak first,
     * which is the failure US-702 exists to prevent.
     */
    expect(selfAppraisalIsReady(null, null, now)).toBe(false);
  });
});

describe('the rating scale [W4-15]', () => {
  it('refuses a cycle whose scale cannot be read', () => {
    // A default scale would silently re-scale every rating in the cycle, which
    // is exactly what snapshotting the scale onto the cycle prevents (US-203).
    expect(() => readScale(null)).toThrow(/no usable rating scale/);
    expect(() => readScale({ min: 5, max: 1 })).toThrow(/no usable rating scale/);
    expect(() => readScale({ min: '1', max: '5' })).toThrow(/no usable rating scale/);
  });

  it('places a computed score onto the cycle scale so the two compare', () => {
    expect(onScale(0, { min: 1, max: 5 })).toBe(1);
    expect(onScale(1, { min: 1, max: 5 })).toBe(5);
    expect(onScale(0.5, { min: 1, max: 5 })).toBe(3);
  });
});

describe('GET /appraisals/:sheetId [W4-15]', () => {
  it('pre-populates every goal with its target, actual and computed score', async () => {
    const ctx = await appraisalOrg();

    const response = await request(app)
      .get(`/appraisals/${ctx.sheetId}`)
      .set('Cookie', ctx.employeeCookie);

    expect(response.status).toBe(200);

    const body = response.body as {
      computedScore: number;
      computedOnScale: number;
      goals: { target: string; actualAchievement: string; computedScore: number }[];
    };

    // 80/100 and 40/50 both score 0.8, so the weighted sheet is 0.8 exactly.
    expect(body.computedScore).toBeCloseTo(0.8, 10);
    // 0.8 on a 1-5 scale is 4.2 -- and stating it on the scale is what makes
    // US-704's divergence comparison meaningful at all.
    expect(body.computedOnScale).toBeCloseTo(4.2, 10);
    expect(body.goals).toHaveLength(2);
    expect(body.goals[0]?.target).toBe('100');
    expect(body.goals[0]?.actualAchievement).toBe('80');
  });

  it('shows the manager the same document as the employee', async () => {
    const ctx = await appraisalOrg();

    const [mine, theirs] = await Promise.all([
      request(app).get(`/appraisals/${ctx.sheetId}`).set('Cookie', ctx.employeeCookie),
      request(app).get(`/appraisals/${ctx.sheetId}`).set('Cookie', ctx.adminCookie),
    ]);

    // Two endpoints would be two chances for the numbers to differ, which is
    // F-07 rebuilt at the API layer.
    expect(theirs.status).toBe(200);
    expect((theirs.body as { computedScore: number }).computedScore).toBe(
      (mine.body as { computedScore: number }).computedScore,
    );
  });

  it('answers 404 across an organization boundary', async () => {
    const ctx = await appraisalOrg();
    const other = await request(app).post('/auth/signup').send({
      organizationName: 'Rival',
      name: 'Rival Admin',
      email: uniqueEmail(),
      password: PASSWORD,
    });

    const response = await request(app)
      .get(`/appraisals/${ctx.sheetId}`)
      .set('Cookie', cookiesFrom(other));

    expect(response.status).toBe(404);
  });
});

describe('the self-appraisal [W4-15]', () => {
  it('saves a draft without locking it', async () => {
    const ctx = await appraisalOrg();

    const response = await request(app)
      .put(`/appraisals/${ctx.sheetId}/self`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx));

    expect(response.status).toBe(200);

    const appraisal = await prisma.appraisal.findUniqueOrThrow({ where: { sheetId: ctx.sheetId } });
    expect(appraisal.selfNarrative).toBe('A steady year.');
    expect(appraisal.selfSubmittedAt).toBeNull();
  });

  it('locks it on submit and refuses a later edit', async () => {
    const ctx = await appraisalOrg();

    const submitted = await request(app)
      .post(`/appraisals/${ctx.sheetId}/self/submit`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx));

    expect(submitted.status).toBe(200);

    const again = await request(app)
      .put(`/appraisals/${ctx.sheetId}/self`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx, { summary: 'Actually, a great year.' }));

    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('ALREADY_SUBMITTED');

    const appraisal = await prisma.appraisal.findUniqueOrThrow({ where: { sheetId: ctx.sheetId } });
    expect(appraisal.selfNarrative).toBe('A steady year.');
  });

  it('refuses a manager writing their report reflection for them', async () => {
    const ctx = await appraisalOrg();

    const response = await request(app)
      .put(`/appraisals/${ctx.sheetId}/self`)
      .set('Cookie', ctx.adminCookie)
      .send(selfBody(ctx));

    // WRITE_SELF_APPRAISAL is SELF-only for every role in W2-06. A
    // self-appraisal nobody else can write is the only kind there is.
    expect(response.status).toBe(403);
  });

  it('requires an entry for every goal', async () => {
    const ctx = await appraisalOrg();

    const response = await request(app)
      .put(`/appraisals/${ctx.sheetId}/self`)
      .set('Cookie', ctx.employeeCookie)
      .send({
        entries: [{ goalId: ctx.goalIds[0], commentary: 'Only this one.' }],
        summary: 'Partial.',
      });

    // A missing goal would leave it silently unrated in a document that reads
    // as complete.
    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('MISSING_GOAL');
  });

  it('refuses an entry naming a goal from another sheet', async () => {
    const ctx = await appraisalOrg();
    const other = await appraisalOrg();

    const response = await request(app)
      .put(`/appraisals/${ctx.sheetId}/self`)
      .set('Cookie', ctx.employeeCookie)
      .send({
        entries: [
          ...ctx.goalIds.map((goalId) => ({ goalId, commentary: 'Mine.' })),
          { goalId: other.goalIds[0], commentary: 'Not mine.' },
        ],
        summary: 'Reaching.',
      });

    // Org scoping stops another tenant's goal, not another sheet's.
    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('UNKNOWN_GOAL');
  });

  it('refuses a self-rating outside the cycle scale', async () => {
    const ctx = await appraisalOrg();

    const response = await request(app)
      .put(`/appraisals/${ctx.sheetId}/self`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx, { selfRating: 9 }));

    // 9 parses as an integer and means nothing on a 1-5 scale.
    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('OFF_SCALE');
  });

  it('refuses an appraisal against a sheet that was never approved', async () => {
    const ctx = await appraisalOrg();
    await prisma.goalSheet.update({ where: { id: ctx.sheetId }, data: { status: 'DRAFT' } });

    const response = await request(app)
      .put(`/appraisals/${ctx.sheetId}/self`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx));

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('SHEET_NOT_APPROVED');
  });

  it('refuses outside the appraisal window', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });

    const response = await request(app)
      .put(`/appraisals/${ctx.sheetId}/self`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx));

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('WINDOW_CLOSED');
  });
});

describe('the manager rating [W4-16]', () => {
  it('is blocked until the self-appraisal submits', async () => {
    const ctx = await appraisalOrg();

    const response = await request(app)
      .post(`/appraisals/${ctx.sheetId}/rating`)
      .set('Cookie', ctx.adminCookie)
      .send(ratingBody(ctx));

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('SELF_NOT_READY');
  });

  it('is allowed once the self-appraisal submits', async () => {
    const ctx = await appraisalOrg();

    await request(app)
      .post(`/appraisals/${ctx.sheetId}/self/submit`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx));

    const response = await request(app)
      .post(`/appraisals/${ctx.sheetId}/rating`)
      .set('Cookie', ctx.adminCookie)
      .send(ratingBody(ctx));

    expect(response.status).toBe(200);
  });

  it('is allowed once the deadline passes, with no submission at all', async () => {
    const ctx = await appraisalOrg({ selfAppraisalDueAt: at(-0.5) });

    const response = await request(app)
      .post(`/appraisals/${ctx.sheetId}/rating`)
      .set('Cookie', ctx.adminCookie)
      .send(ratingBody(ctx));

    expect(response.status).toBe(200);
  });

  it('records the rater and seeds the final rating from the manager', async () => {
    const ctx = await appraisalOrg();
    const appraisal = await rated(ctx);

    expect(appraisal.managerId).toBe(ctx.admin.id);
    expect(appraisal.managerRating).toBe(4);
    /*
     * Left null, an appraisal nobody calibrated would publish nothing.
     * Calibration is an adjustment to a decision already made, not the place
     * the decision is first written down.
     */
    expect(appraisal.finalRating).toBe(4);
  });

  it('leaves the employee own words untouched', async () => {
    const ctx = await appraisalOrg();
    await rated(ctx);

    const ratings = await prisma.goalRating.findMany({
      where: { appraisal: { sheetId: ctx.sheetId } },
    });

    // Two columns, not one row overwritten: the point of US-702 is that the
    // manager rates *with* the self-appraisal visible.
    expect(ratings).toHaveLength(2);
    expect(ratings.every((row) => row.selfNarrative === 'I did the thing.')).toBe(true);
    expect(ratings.every((row) => row.narrative === 'Strong delivery.')).toBe(true);
  });

  it('refuses a rating off the cycle scale', async () => {
    const ctx = await appraisalOrg();
    await request(app)
      .post(`/appraisals/${ctx.sheetId}/self/submit`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx));

    const response = await request(app)
      .post(`/appraisals/${ctx.sheetId}/rating`)
      .set('Cookie', ctx.adminCookie)
      .send(ratingBody(ctx, { overallRating: 7 }));

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('OFF_SCALE');
  });

  it('refuses a rating with no justification', async () => {
    const ctx = await appraisalOrg();

    const response = await request(app)
      .post(`/appraisals/${ctx.sheetId}/rating`)
      .set('Cookie', ctx.adminCookie)
      .send({ ratings: ratingBody(ctx).ratings, overallRating: 4 });

    // A rating with no reason is what a disputed appraisal turns on.
    expect(response.status).toBe(400);
  });

  it('audits the rating', async () => {
    const ctx = await appraisalOrg();
    const appraisal = await rated(ctx);

    const events = await prisma.auditEvent.findMany({
      where: { entityId: appraisal.id, action: 'appraisal.manager.submit' },
    });

    expect(events).toHaveLength(1);
  });
});

describe('calibration [W4-17]', () => {
  it('shows the distribution, the per-manager split and the totals', async () => {
    const ctx = await appraisalOrg();
    await rated(ctx);

    const response = await request(app)
      .get(`/calibration?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);

    expect(response.status).toBe(200);

    const view = response.body as {
      total: number;
      orgMean: number;
      distribution: { rating: number; count: number }[];
      byManager: { managerId: string; count: number; mean: number }[];
    };

    expect(view.total).toBe(1);
    expect(view.orgMean).toBe(4);
    // Every point on the scale appears, including the ones nobody scored: a
    // distribution with holes reads as missing data rather than as zero.
    expect(view.distribution.map((bucket) => bucket.rating)).toEqual([1, 2, 3, 4, 5]);
    expect(view.distribution.find((bucket) => bucket.rating === 4)?.count).toBe(1);
    expect(view.byManager[0]).toMatchObject({ managerId: ctx.admin.id, count: 1, mean: 4 });
  });

  it('flags a manager rating far from what the goals say', async () => {
    const ctx = await appraisalOrg();
    await request(app)
      .post(`/appraisals/${ctx.sheetId}/self/submit`)
      .set('Cookie', ctx.employeeCookie)
      .send(selfBody(ctx));
    await request(app)
      .post(`/appraisals/${ctx.sheetId}/rating`)
      .set('Cookie', ctx.adminCookie)
      .send(ratingBody(ctx, { ratings: ctx.goalIds.map((goalId) => ({ goalId, rating: 1, commentary: 'Poor.' })), overallRating: 1 }));

    const response = await request(app)
      .get(`/calibration?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);

    const divergences = (response.body as { divergences: { managerRating: number; computedOnScale: number; divergence: number }[] })
      .divergences;

    // The engine says 4.2 on this scale; the manager said 1.
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.computedOnScale).toBeCloseTo(4.2, 2);
    expect(divergences[0]?.managerRating).toBe(1);
    expect(divergences[0]?.divergence).toBeCloseTo(3.2, 2);
  });

  it('does not flag a rating that agrees with the goals', async () => {
    const ctx = await appraisalOrg();
    await rated(ctx);

    const response = await request(app)
      .get(`/calibration?cycleId=${ctx.cycleId}`)
      .set('Cookie', ctx.adminCookie);

    // 4 against a computed 4.2 is a 0.2 gap on a range of 4 -- well inside the
    // threshold, and flagging it would make the list useless.
    expect((response.body as { divergences: unknown[] }).divergences).toEqual([]);
  });

  it('adjusts a rating, keeps the manager number, and tells them', async () => {
    const ctx = await appraisalOrg({ phase: 'CALIBRATION' });
    const appraisal = await ratedOutsideWindow(ctx);

    const response = await request(app)
      .post('/calibration/adjust')
      .set('Cookie', ctx.adminCookie)
      .send({ appraisalId: appraisal.id, finalRating: 3, reason: 'Aligned with the org curve.' });

    expect(response.status).toBe(200);

    const after = await prisma.appraisal.findUniqueOrThrow({ where: { id: appraisal.id } });
    // Two columns so both survive. This is the difference between a history
    // and a rewrite (US-802).
    expect(after.managerRating).toBe(4);
    expect(after.finalRating).toBe(3);
    expect(after.calibratedById).toBe(ctx.admin.id);

    const notifications = await prisma.notification.findMany({
      where: { userId: ctx.admin.id, type: 'appraisal.calibrated' },
    });
    expect(notifications).toHaveLength(1);
  });

  it('requires a reason for an adjustment', async () => {
    const ctx = await appraisalOrg({ phase: 'CALIBRATION' });

    const response = await request(app)
      .post('/calibration/adjust')
      .set('Cookie', ctx.adminCookie)
      .send({ appraisalId: 'clw0000000000000000000000', finalRating: 3 });

    expect(response.status).toBe(400);
  });

  it('refuses an adjustment outside the calibration window', async () => {
    const ctx = await appraisalOrg();
    const appraisal = await rated(ctx);

    const response = await request(app)
      .post('/calibration/adjust')
      .set('Cookie', ctx.adminCookie)
      .send({ appraisalId: appraisal.id, finalRating: 3, reason: 'Too early.' });

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('WINDOW_CLOSED');
  });

  it('answers 404 for an appraisal in another organization', async () => {
    const ctx = await appraisalOrg();
    const appraisal = await rated(ctx);

    const other = await appraisalOrg({ phase: 'CALIBRATION' });

    const response = await request(app)
      .post('/calibration/adjust')
      .set('Cookie', other.adminCookie)
      .send({ appraisalId: appraisal.id, finalRating: 3, reason: 'Not mine to change.' });

    // `Appraisal` carries no orgId, so this is the join doing the work.
    expect(response.status).toBe(404);
  });
});

/**
 * A fully rated appraisal, written straight to the database.
 *
 * Used by the calibration and release tests, whose cycles have the APPRAISAL
 * window in the past -- so the HTTP path that would normally produce this row
 * is correctly closed by the time they run. Reaching for the database here is
 * setting up a precondition, not bypassing the rule under test: every test that
 * is *about* the rating goes through the endpoint.
 */
async function ratedOutsideWindow(ctx: Ctx) {
  const appraisal = await prisma.appraisal.create({
    data: {
      sheetId: ctx.sheetId,
      selfSubmittedAt: new Date(),
      managerId: ctx.admin.id,
      managerRating: 4,
      managerNarrative: 'Strong delivery.',
      managerSubmittedAt: new Date(),
      finalRating: 4,
    },
  });

  return appraisal;
}

describe('release and acknowledgement [W4-17, US-703]', () => {
  it('refuses to release while an appraisal has no final rating', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });
    await prisma.appraisal.create({ data: { sheetId: ctx.sheetId } });

    const response = await request(app)
      .post('/calibration/release')
      .set('Cookie', ctx.adminCookie)
      .send({ cycleId: ctx.cycleId, confirm: true });

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('NOT_RATED');
    // Named, because "3 incomplete" is not something anyone can act on.
    expect((response.body as { detail: string[] }).detail).toEqual(['Priya']);
  });

  it('releases everything at once and notifies each employee', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });
    await ratedOutsideWindow(ctx);

    const response = await request(app)
      .post('/calibration/release')
      .set('Cookie', ctx.adminCookie)
      .send({ cycleId: ctx.cycleId, confirm: true });

    expect(response.status).toBe(200);
    expect((response.body as { released: number }).released).toBe(1);

    const appraisal = await prisma.appraisal.findUniqueOrThrow({ where: { sheetId: ctx.sheetId } });
    expect(appraisal.releasedAt).not.toBeNull();

    const notifications = await prisma.notification.findMany({
      where: { userId: ctx.employee.id, type: 'appraisal.released' },
    });
    expect(notifications).toHaveLength(1);
  });

  it('refuses to release twice', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });
    await ratedOutsideWindow(ctx);

    await request(app)
      .post('/calibration/release')
      .set('Cookie', ctx.adminCookie)
      .send({ cycleId: ctx.cycleId, confirm: true });

    const again = await request(app)
      .post('/calibration/release')
      .set('Cookie', ctx.adminCookie)
      .send({ cycleId: ctx.cycleId, confirm: true });

    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('ALREADY_RELEASED');
  });

  it('will not acknowledge an unreleased rating', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });
    await ratedOutsideWindow(ctx);

    const response = await request(app)
      .post(`/appraisals/${ctx.sheetId}/acknowledge`)
      .set('Cookie', ctx.employeeCookie)
      .send({ acknowledged: true });

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('NOT_RELEASED');
  });

  it('records an acknowledgement with its comment', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });
    await ratedOutsideWindow(ctx);
    await request(app)
      .post('/calibration/release')
      .set('Cookie', ctx.adminCookie)
      .send({ cycleId: ctx.cycleId, confirm: true });

    const response = await request(app)
      .post(`/appraisals/${ctx.sheetId}/acknowledge`)
      .set('Cookie', ctx.employeeCookie)
      .send({ acknowledged: true, comment: 'Understood, thank you.' });

    expect(response.status).toBe(200);

    const appraisal = await prisma.appraisal.findUniqueOrThrow({ where: { sheetId: ctx.sheetId } });
    expect(appraisal.acknowledgedAt).not.toBeNull();
    expect(appraisal.acknowledgementComment).toBe('Understood, thank you.');
    expect(appraisal.disputedAt).toBeNull();
  });

  it('records a disagreement as a state HR can find', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });
    await ratedOutsideWindow(ctx);
    await request(app)
      .post('/calibration/release')
      .set('Cookie', ctx.adminCookie)
      .send({ cycleId: ctx.cycleId, confirm: true });

    await request(app)
      .post(`/appraisals/${ctx.sheetId}/acknowledge?dispute=true`)
      .set('Cookie', ctx.employeeCookie)
      .send({ acknowledged: true, comment: 'I do not accept this rating.' });

    const appraisal = await prisma.appraisal.findUniqueOrThrow({ where: { sheetId: ctx.sheetId } });

    // A flag rather than a comment nobody reads.
    expect(appraisal.disputedAt).not.toBeNull();
  });

  it('refuses a second acknowledgement', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });
    await ratedOutsideWindow(ctx);
    await request(app)
      .post('/calibration/release')
      .set('Cookie', ctx.adminCookie)
      .send({ cycleId: ctx.cycleId, confirm: true });
    await request(app)
      .post(`/appraisals/${ctx.sheetId}/acknowledge`)
      .set('Cookie', ctx.employeeCookie)
      .send({ acknowledged: true });

    const again = await request(app)
      .post(`/appraisals/${ctx.sheetId}/acknowledge`)
      .set('Cookie', ctx.employeeCookie)
      .send({ acknowledged: true });

    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('ALREADY_ACKNOWLEDGED');
  });

  it('will not let a manager acknowledge on the employee behalf', async () => {
    const ctx = await appraisalOrg({ phase: 'RESULTS' });
    await ratedOutsideWindow(ctx);
    await request(app)
      .post('/calibration/release')
      .set('Cookie', ctx.adminCookie)
      .send({ cycleId: ctx.cycleId, confirm: true });

    const response = await request(app)
      .post(`/appraisals/${ctx.sheetId}/acknowledge`)
      .set('Cookie', ctx.adminCookie)
      .send({ acknowledged: true });

    // ACKNOWLEDGE_RATING is SELF-only. Someone else clicking "I accept" on
    // your behalf is the one thing an acknowledgement cannot survive.
    expect(response.status).toBe(403);
  });
});

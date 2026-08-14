import { prisma } from '@aura/db';
import { afterAll, describe, expect, it } from 'vitest';

import { QUEUES, createBoss, ensureQueues } from './boss.js';
import { emailAdapterFromEnv, noopEmailAdapter, renderEmailHtml, resendAdapter } from './email.js';
import { dispatchNotification, prefersChannel } from './jobs/dispatch.js';
import { readThresholds, runEscalationSweep } from './jobs/escalations.js';
import { SWEEP_CRON, installSignalHandlers, startWorker } from './index.js';

/** W5-01 through W5-04 — the worker, the sweep and the dispatcher. */

let seq = 0;
const uniqueEmail = (): string => `w5-${String(Date.now())}-${String(++seq)}@example.com`;
const at = (days: number): Date => new Date(Date.now() + days * 86_400_000);

/**
 * An organization with an active cycle whose goal-setting window has closed.
 *
 * The window is in the past on purpose: an escalation is about a deadline that
 * has already been missed, so a fixture with an open window would test nothing.
 */
async function overdueOrg(options: { daysPastDeadline?: number; timeZone?: string } = {}) {
  const days = options.daysPastDeadline ?? 5;

  const org = await prisma.organization.create({
    data: { name: `Aura-${String(Date.now())}-${String(++seq)}`, slug: `aura-${String(++seq)}-${String(Date.now())}` },
    select: { id: true },
  });

  const manager = await prisma.user.create({
    data: {
      orgId: org.id,
      email: uniqueEmail(),
      name: 'Marcus',
      roles: ['MANAGER'],
      status: 'ACTIVE',
      timeZone: options.timeZone ?? 'UTC',
    },
    select: { id: true, email: true },
  });

  const employee = await prisma.user.create({
    data: {
      orgId: org.id,
      email: uniqueEmail(),
      name: 'Priya',
      roles: ['EMPLOYEE'],
      status: 'ACTIVE',
      managerId: manager.id,
      timeZone: options.timeZone ?? 'UTC',
    },
    select: { id: true, email: true },
  });

  const cycle = await prisma.reviewCycle.create({
    data: {
      orgId: org.id,
      name: `FY-${String(Date.now())}-${String(++seq)}`,
      fiscalYear: 2026,
      status: 'ACTIVE',
      escalationRules: { manager: 3, skipLevelHr: 7, rules: ['GOALS_NOT_SUBMITTED'] },
      phases: {
        create: [
          {
            key: 'GOAL_SETTING',
            label: 'Goals',
            startsAt: at(-days - 30),
            // The deadline this sweep measures against.
            endsAt: at(-days),
          },
        ],
      },
    },
    select: { id: true },
  });

  return { org, manager, employee, cycle };
}

/** A draft sheet is an unsubmitted one, which is the employee's breach. */
async function draftSheet(orgId: string, userId: string, cycleId: string) {
  return prisma.goalSheet.create({
    data: { orgId, userId, cycleId, status: 'DRAFT' },
    select: { id: true },
  });
}

describe('readThresholds [W5-02]', () => {
  it('reads a cycle configured thresholds', () => {
    expect(readThresholds({ manager: 2, skipLevelHr: 5 })).toEqual({ manager: 2, skipLevelHr: 5 });
  });

  it('falls back to the documented defaults on anything unusable', () => {
    // A cycle whose rules JSON is malformed still needs to escalate. Refusing
    // would mean a configuration typo silently disables compliance.
    for (const bad of [null, {}, { manager: '3', skipLevelHr: 7 }, { manager: 1.5, skipLevelHr: 7 }]) {
      expect(readThresholds(bad)).toEqual({ manager: 3, skipLevelHr: 7 });
    }
  });
});

describe('the nightly escalation sweep [W5-02]', () => {
  it('raises an escalation with a real day count and no floor', async () => {
    const ctx = await overdueOrg({ daysPastDeadline: 1 });
    await draftSheet(ctx.org.id, ctx.employee.id, ctx.cycle.id);

    await runEscalationSweep(new Date());

    const escalation = await prisma.escalation.findFirstOrThrow({
      where: { cycleId: ctx.cycle.id, rule: 'GOALS_NOT_SUBMITTED' },
    });

    expect(escalation.subjectUserId).toBe(ctx.employee.id);
    /* One day past the deadline is tier EMPLOYEE on a manager threshold of 3.
       The prototype floored elapsed days at four, which would have put this
       straight at MANAGER (F-08). */
    expect(escalation.tier).toBe('EMPLOYEE');
  });

  it('climbs the tiers as the breach ages', async () => {
    const ctx = await overdueOrg({ daysPastDeadline: 8 });
    await draftSheet(ctx.org.id, ctx.employee.id, ctx.cycle.id);

    await runEscalationSweep(new Date());

    const escalation = await prisma.escalation.findFirstOrThrow({
      where: { cycleId: ctx.cycle.id, rule: 'GOALS_NOT_SUBMITTED' },
    });

    expect(escalation.tier).toBe('SKIP_LEVEL_HR');
  });

  it('is idempotent: running twice in a day updates rather than duplicates', async () => {
    const ctx = await overdueOrg({ daysPastDeadline: 4 });
    await draftSheet(ctx.org.id, ctx.employee.id, ctx.cycle.id);

    await runEscalationSweep(new Date());
    await runEscalationSweep(new Date());

    const rows = await prisma.escalation.findMany({
      where: { cycleId: ctx.cycle.id, rule: 'GOALS_NOT_SUBMITTED' },
    });

    // `@@unique([cycleId, subjectUserId, rule])` is what guarantees this, and
    // a cron firing twice is a thing that happens.
    expect(rows).toHaveLength(1);
  });

  it('re-opens a resolved escalation whose condition recurs', async () => {
    const ctx = await overdueOrg({ daysPastDeadline: 4 });
    await draftSheet(ctx.org.id, ctx.employee.id, ctx.cycle.id);

    await runEscalationSweep(new Date());
    await prisma.escalation.updateMany({
      where: { cycleId: ctx.cycle.id },
      data: { status: 'RESOLVED', resolutionNote: 'Spoke to them.' },
    });

    await runEscalationSweep(new Date());

    const escalation = await prisma.escalation.findFirstOrThrow({
      where: { cycleId: ctx.cycle.id, rule: 'GOALS_NOT_SUBMITTED' },
    });

    // US-904's "re-opens automatically", on the same row rather than a second
    // table to keep in step.
    expect(escalation.status).toBe('ACTIVE');
  });

  it('raises nothing before the deadline passes', async () => {
    const ctx = await overdueOrg({ daysPastDeadline: -5 });
    await draftSheet(ctx.org.id, ctx.employee.id, ctx.cycle.id);

    await runEscalationSweep(new Date());

    /*
     * Scoped to this cycle, not to the sweep's totals. The sweep is deliberately
     * global -- it visits every active cycle in the database, which is what a
     * nightly job should do -- so its counters include the other fixtures in
     * this file. Asserting on them would make this test depend on execution
     * order, which is how a suite starts failing for reasons nobody can read.
     */
    expect(await prisma.escalation.count({ where: { cycleId: ctx.cycle.id } })).toBe(0);
  });

  it('charges an unapproved sheet to the manager, not the employee', async () => {
    const ctx = await overdueOrg({ daysPastDeadline: 4 });
    await prisma.goalSheet.create({
      data: {
        orgId: ctx.org.id,
        userId: ctx.employee.id,
        cycleId: ctx.cycle.id,
        status: 'PENDING',
        submittedAt: new Date(),
      },
    });

    await runEscalationSweep(new Date());

    const escalation = await prisma.escalation.findFirstOrThrow({
      where: { cycleId: ctx.cycle.id, rule: 'APPROVAL_OVERDUE' },
    });

    // Chasing the person who already did their part is the obvious wrong
    // answer, and the prototype had no reporting line to get it right with.
    expect(escalation.subjectUserId).toBe(ctx.manager.id);
  });

  it('ignores a cycle that is not active', async () => {
    const ctx = await overdueOrg({ daysPastDeadline: 4 });
    await draftSheet(ctx.org.id, ctx.employee.id, ctx.cycle.id);
    await prisma.reviewCycle.update({
      where: { id: ctx.cycle.id },
      data: { status: 'CLOSED' },
    });

    await runEscalationSweep(new Date());

    expect(await prisma.escalation.count({ where: { cycleId: ctx.cycle.id } })).toBe(0);
  });

  it('records a notification only when one is actually enqueued', async () => {
    const ctx = await overdueOrg({ daysPastDeadline: 4 });
    await draftSheet(ctx.org.id, ctx.employee.id, ctx.cycle.id);

    const sent: { queue: string; data: unknown }[] = [];
    const fakeBoss = {
      send: async (queue: string, data: unknown) => {
        sent.push({ queue, data });
        return await Promise.resolve('job-id');
      },
    };

    await runEscalationSweep(new Date(), fakeBoss);

    const escalation = await prisma.escalation.findFirstOrThrow({
      where: { cycleId: ctx.cycle.id, rule: 'GOALS_NOT_SUBMITTED' },
    });

    // `notifiedAt` is a record of deliveries, not of intentions (US-1203).
    expect(sent).toHaveLength(1);
    expect(sent[0]?.queue).toBe(QUEUES.notificationDispatch);
    expect(escalation.notifiedAt).toHaveLength(1);
  });
});

describe('the notification dispatcher [W5-04]', () => {
  it('writes an in-app row and an email row, both sent', async () => {
    const ctx = await overdueOrg();

    const outcome = await dispatchNotification(
      {
        orgId: ctx.org.id,
        userId: ctx.employee.id,
        type: 'goalsheet.approved',
        payload: { approverName: 'Marcus', sheetId: 'sheet-1' },
      },
      noopEmailAdapter,
    );

    expect(outcome).toEqual({ inApp: 'SENT', email: 'SENT', mandatory: false });

    const rows = await prisma.notification.findMany({
      where: { userId: ctx.employee.id, type: 'goalsheet.approved' },
      orderBy: { channel: 'asc' },
    });

    /* Postgres orders an enum by its declared order, not alphabetically, so
       `channel: 'asc'` is IN_APP then EMAIL. Sorted here instead, because the
       assertion is about both rows existing rather than about their order. */
    expect(rows.map((row) => row.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    expect(rows.every((row) => row.status === 'SENT')).toBe(true);
  });

  it('stores the rendered subject, body and link on the row', async () => {
    const ctx = await overdueOrg();

    await dispatchNotification(
      {
        orgId: ctx.org.id,
        userId: ctx.employee.id,
        type: 'goalsheet.returned',
        payload: { managerName: 'Marcus', reason: 'Target too low.', sheetId: 'sheet-1' },
      },
      noopEmailAdapter,
    );

    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: ctx.employee.id, channel: 'IN_APP' },
    });
    const payload = row.payload as Record<string, string>;

    // The deep link is what makes a notification actionable rather than an
    // announcement (US-1201).
    expect(payload['body']).toContain('Target too low.');
    expect(payload['link']).toBe('/sheets/sheet-1');
  });

  it('respects a per-category preference', async () => {
    const ctx = await overdueOrg();
    await prisma.user.update({
      where: { id: ctx.employee.id },
      data: { notificationPreferences: { APPROVALS: { email: false, inApp: true } } },
    });

    const outcome = await dispatchNotification(
      {
        orgId: ctx.org.id,
        userId: ctx.employee.id,
        type: 'goalsheet.approved',
        payload: { sheetId: 'sheet-1' },
      },
      noopEmailAdapter,
    );

    expect(outcome).toMatchObject({ inApp: 'SENT', email: 'SUPPRESSED' });

    const email = await prisma.notification.findFirstOrThrow({
      where: { userId: ctx.employee.id, channel: 'EMAIL' },
    });

    // A suppressed notification still leaves a row. Without one, "why did
    // nobody hear about this" is unanswerable -- which is the whole reason the
    // delivery log exists.
    expect(email.status).toBe('SUPPRESSED');
  });

  it('ignores preferences for a compliance notice, and labels it', async () => {
    const ctx = await overdueOrg();
    await prisma.user.update({
      where: { id: ctx.employee.id },
      data: {
        notificationPreferences: { COMPLIANCE: { email: false, inApp: false } },
      },
    });

    const outcome = await dispatchNotification(
      {
        orgId: ctx.org.id,
        userId: ctx.employee.id,
        type: 'escalation.goals_not_submitted',
        payload: { daysOverdue: '4', escalationId: 'esc-1' },
      },
      noopEmailAdapter,
    );

    // Someone who has missed a deadline being able to silence the reminder
    // about it defeats the purpose of having one (US-1202).
    expect(outcome).toEqual({ inApp: 'SENT', email: 'SENT', mandatory: true });

    const rows = await prisma.notification.findMany({
      where: { userId: ctx.employee.id, type: 'escalation.goals_not_submitted' },
    });

    // Labelled rather than hidden: the UI says this one was forced.
    expect(rows.every((row) => row.mandatory)).toBe(true);
  });

  it('takes mandatory from the template, never from the job', async () => {
    const ctx = await overdueOrg();

    await dispatchNotification(
      {
        orgId: ctx.org.id,
        userId: ctx.employee.id,
        type: 'goalsheet.approved',
        // A caller claiming this is mandatory does not make it so.
        payload: { mandatory: 'true', sheetId: 'sheet-1' },
      },
      noopEmailAdapter,
    );

    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: ctx.employee.id, channel: 'IN_APP' },
    });

    expect(row.mandatory).toBe(false);
  });

  it('records a delivery failure with its reason', async () => {
    const ctx = await overdueOrg();
    const failing = {
      name: 'failing',
      send: () => Promise.resolve({ ok: false as const, reason: 'Mailbox full' }),
    };

    const outcome = await dispatchNotification(
      {
        orgId: ctx.org.id,
        userId: ctx.employee.id,
        type: 'goalsheet.approved',
        payload: { sheetId: 'sheet-1' },
      },
      failing,
    );

    expect(outcome.email).toBe('FAILED');

    const email = await prisma.notification.findFirstOrThrow({
      where: { userId: ctx.employee.id, channel: 'EMAIL' },
    });

    expect(email.status).toBe('FAILED');
    expect(email.failureReason).toBe('Mailbox full');
  });

  it('sends nothing to a deactivated account, mandatory or not', async () => {
    const ctx = await overdueOrg();
    await prisma.user.update({
      where: { id: ctx.employee.id },
      data: { status: 'DEACTIVATED' },
    });

    const outcome = await dispatchNotification(
      {
        orgId: ctx.org.id,
        userId: ctx.employee.id,
        type: 'escalation.goals_not_submitted',
        payload: { daysOverdue: '4' },
      },
      noopEmailAdapter,
    );

    // "Mandatory" means a person cannot opt out of it, not that it should
    // follow them out of the organization.
    expect(outcome).toMatchObject({ inApp: 'SUPPRESSED', email: 'SUPPRESSED' });
  });

  it('fails loudly on a type it cannot render', async () => {
    const ctx = await overdueOrg();

    await expect(
      dispatchNotification(
        { orgId: ctx.org.id, userId: ctx.employee.id, type: 'nothing.like.this' },
        noopEmailAdapter,
      ),
    ).rejects.toThrow(/No template/);

    // Nothing written, so the job can be retried without leaving a half-row.
    expect(await prisma.notification.count({ where: { userId: ctx.employee.id } })).toBe(0);
  });
});

describe('prefersChannel [W5-04]', () => {
  it('treats an absent category as enabled', () => {
    // A category added later must be on by default, or it is silently off for
    // everyone who signed up before it existed.
    expect(prefersChannel({}, 'APPROVALS', 'email')).toBe(true);
    expect(prefersChannel(null, 'APPROVALS', 'email')).toBe(true);
  });

  it('reads an explicit preference', () => {
    const preferences = { APPROVALS: { email: false, inApp: true } };

    expect(prefersChannel(preferences, 'APPROVALS', 'email')).toBe(false);
    expect(prefersChannel(preferences, 'APPROVALS', 'inApp')).toBe(true);
  });

  it('ignores a non-boolean setting rather than coercing it', () => {
    expect(prefersChannel({ APPROVALS: { email: 'no' } }, 'APPROVALS', 'email')).toBe(true);
  });
});

describe('the email adapter [W5-03]', () => {
  it('defaults to one that cannot send', () => {
    /*
     * The most important assertion in this file. A suite that could reach a
     * real provider is one bad environment variable away from emailing four
     * hundred employees about a seeded cycle, and no assertion protects
     * against that after the fact.
     */
    expect(emailAdapterFromEnv({}).name).toBe('noop');
    expect(emailAdapterFromEnv({ RESEND_API_KEY: 'key' }).name).toBe('noop');
    expect(emailAdapterFromEnv({ EMAIL_FROM: 'a@b.com' }).name).toBe('noop');
    expect(emailAdapterFromEnv(process.env).name).toBe('noop');
  });

  it('chooses the live adapter only when both settings are present', () => {
    expect(
      emailAdapterFromEnv({ RESEND_API_KEY: 'key', EMAIL_FROM: 'a@b.com' }).name,
    ).toBe('resend');
  });

  it('builds a resend adapter without sending anything', () => {
    expect(resendAdapter('key', 'a@b.com').name).toBe('resend');
  });

  it('escapes user-supplied text in the HTML it renders', () => {
    const html = renderEmailHtml({
      to: 'a@b.com',
      subject: 'Your goals need changes',
      body: '<script>alert(1)</script>',
      link: '/sheets/1',
    });

    // A returned-sheet reason is typed by a manager and a shared-goal title by
    // whoever created it. Interpolating either unescaped is stored XSS with an
    // email client as the sink.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the worker process [W5-01]', () => {
  const started: Awaited<ReturnType<typeof startWorker>>[] = [];

  afterAll(async () => {
    for (const worker of started) {
      await worker.stop().catch(() => undefined);
    }
  });

  it('starts, processes a job, and stops cleanly', async () => {
    const worker = await startWorker();
    started.push(worker);

    const ctx = await overdueOrg();

    await worker.boss.send(QUEUES.notificationDispatch, {
      orgId: ctx.org.id,
      userId: ctx.employee.id,
      type: 'goalsheet.approved',
      payload: { sheetId: 'sheet-1' },
    });

    // Poll rather than sleep a fixed span: the job is done when the row
    // exists, and a fixed wait is either flaky or slow.
    const deadline = Date.now() + 30_000;
    let delivered = 0;

    while (Date.now() < deadline && delivered === 0) {
      delivered = await prisma.notification.count({
        where: { userId: ctx.employee.id, channel: 'IN_APP' },
      });

      if (delivered === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    expect(delivered).toBe(1);
  });

  it('declares its queues before anything sends to one', async () => {
    const boss = createBoss();

    await boss.start();
    await ensureQueues(boss);

    const queues = await boss.getQueues();

    expect(queues.map((queue) => queue.name)).toEqual(
      expect.arrayContaining([QUEUES.escalationSweep, QUEUES.notificationDispatch]),
    );

    await boss.stop({ graceful: false });
  });

  it('sweeps at 02:00 rather than midnight', () => {
    /*
     * A deadline that falls "on the 3rd" ends at the first instant of the 4th
     * in the organization's zone, and a sweep at exactly midnight UTC would
     * race that boundary for every organization east of it.
     */
    expect(SWEEP_CRON).toBe('0 2 * * *');
  });

  it('installs and removes signal handlers without leaking them', () => {
    const before = process.listenerCount('SIGTERM');
    const remove = installSignalHandlers({
      boss: {} as never,
      stop: () => Promise.resolve(),
    });

    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    remove();

    // A test that added a handler per run would eventually trip Node's
    // max-listeners warning and hide a real leak in the noise.
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});

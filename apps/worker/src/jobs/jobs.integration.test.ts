import { prisma } from '@aura/db';
import { FORMULA_GUARD, UTF8_BOM } from '@aura/core';
import { describe, expect, it } from 'vitest';

import { memoryStorage, storageFromEnv } from '../storage.js';
import { collectDigestItems, hasSomethingToSay, runWeeklyDigest } from './digest.js';
import { DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMNS, runExport } from './export.js';
import type { JobSender } from './escalations.js';
import { civilDay, runMetricsSnapshot } from './metrics.js';

/** W5-05, W5-06, W5-07 — export, digest and the metrics snapshot. */

let seq = 0;
const uniqueEmail = (): string => `w5b-${String(Date.now())}-${String(++seq)}@example.com`;
const at = (days: number): Date => new Date(Date.now() + days * 86_400_000);

/** A queue that records rather than enqueues. */
function recordingSender() {
  const sent: { queue: string; data: Record<string, unknown> }[] = [];
  const sender: JobSender = {
    send: (queue, data) => {
      sent.push({ queue, data });
      return Promise.resolve('job-id');
    },
  };

  return { sender, sent };
}

/** An organization with an active cycle, a manager, and one employee. */
async function cycleOrg() {
  const org = await prisma.organization.create({
    data: {
      name: `Aura-${String(Date.now())}-${String(++seq)}`,
      slug: `aura-${String(++seq)}-${String(Date.now())}`,
    },
    select: { id: true },
  });

  const manager = await prisma.user.create({
    data: { orgId: org.id, email: uniqueEmail(), name: 'Marcus', roles: ['MANAGER'], status: 'ACTIVE' },
    select: { id: true },
  });

  const employee = await prisma.user.create({
    data: {
      orgId: org.id,
      email: uniqueEmail(),
      name: 'Priya',
      roles: ['EMPLOYEE'],
      status: 'ACTIVE',
      managerId: manager.id,
    },
    select: { id: true, email: true },
  });

  const cycle = await prisma.reviewCycle.create({
    data: {
      orgId: org.id,
      name: `FY-${String(Date.now())}-${String(++seq)}`,
      fiscalYear: 2026,
      status: 'ACTIVE',
      ratingScale: { min: 1, max: 5, labels: {} },
      phases: {
        create: [{ key: 'GOAL_SETTING', label: 'Goals', startsAt: at(-30), endsAt: at(30) }],
      },
    },
    select: { id: true },
  });

  return { org, manager, employee, cycle };
}

type Ctx = Awaited<ReturnType<typeof cycleOrg>>;

/** A sheet with one goal, whose title the caller chooses. */
async function sheetWithGoal(
  ctx: Ctx,
  options: { title?: string; status?: 'DRAFT' | 'PENDING' | 'APPROVED'; actual?: string | null } = {},
) {
  return prisma.goalSheet.create({
    data: {
      orgId: ctx.org.id,
      userId: ctx.employee.id,
      cycleId: ctx.cycle.id,
      status: options.status ?? 'APPROVED',
      goals: {
        create: [
          {
            thrustArea: 'BUSINESS_GROWTH',
            title: options.title ?? 'Grow ARR',
            uom: 'NUMERIC',
            direction: 'HIGHER_IS_BETTER',
            target: '100',
            actualAchievement: options.actual === undefined ? '80' : options.actual,
            weightage: 100,
            status: 'COMPLETED',
          },
        ],
      },
    },
    select: { id: true },
  });
}

describe('the CSV export job [W5-05]', () => {
  it('writes one row per goal, with a header', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);
    const storage = memoryStorage();

    const result = await runExport(
      { orgId: ctx.org.id, actorId: ctx.manager.id, cycleId: ctx.cycle.id },
      storage,
    );

    expect(result.rows).toBe(1);

    const stored = storage.objects.get(result.key);
    const lines = (stored?.body ?? '').split('\r\n');

    // A spreadsheet with a nested list in a cell is not analysable, which is
    // the entire reason someone exports.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Employee"');
    expect(lines[1]).toContain('"Priya"');
  });

  it('neutralises a formula in a goal title', async () => {
    const ctx = await cycleOrg();
    // A goal someone actually typed. Opened in Excel unguarded, this runs.
    await sheetWithGoal(ctx, { title: '=cmd|\'/c calc\'!A1' });
    const storage = memoryStorage();

    const result = await runExport(
      { orgId: ctx.org.id, actorId: ctx.manager.id, cycleId: ctx.cycle.id },
      storage,
    );

    const body = storage.objects.get(result.key)?.body ?? '';

    // The guard is W2-08's, reached through `serializeCsv`. Rewriting the
    // escaping here would be a second opinion on a question with one right
    // answer, and the dangerous half of it is silent.
    expect(body).toContain(`"${FORMULA_GUARD}=cmd`);
    expect(body).not.toContain('"=cmd');
  });

  it('quotes an embedded quote by doubling it, per RFC 4180', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx, { title: 'Ship the "new" portal' });
    const storage = memoryStorage();

    const result = await runExport(
      { orgId: ctx.org.id, actorId: ctx.manager.id, cycleId: ctx.cycle.id },
      storage,
    );

    expect(storage.objects.get(result.key)?.body).toContain('Ship the ""new"" portal');
  });

  it('starts with a BOM so Excel reads it as UTF-8', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);
    const storage = memoryStorage();

    const result = await runExport(
      { orgId: ctx.org.id, actorId: ctx.manager.id, cycleId: ctx.cycle.id },
      storage,
    );

    // Without it every non-ASCII name in the export arrives mangled.
    expect(storage.objects.get(result.key)?.body.startsWith(UTF8_BOM)).toBe(true);
  });

  it('honours a column list and ignores names it does not know', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);
    const storage = memoryStorage();

    const result = await runExport(
      {
        orgId: ctx.org.id,
        actorId: ctx.manager.id,
        cycleId: ctx.cycle.id,
        columns: ['employeeName', 'goalTitle', 'passwordHash'],
      },
      storage,
    );

    const header = (storage.objects.get(result.key)?.body ?? '').split('\r\n')[0] ?? '';

    // A whitelist, so a request names a column from the list rather than
    // reaching into the row.
    expect(header).toBe(`${UTF8_BOM}"Employee","Goal"`);
  });

  it('refuses an export with no known columns rather than sending everything', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);

    await expect(
      runExport(
        { orgId: ctx.org.id, actorId: ctx.manager.id, cycleId: ctx.cycle.id, columns: ['nope'] },
        memoryStorage(),
      ),
    ).rejects.toThrow(/at least one known column/);
  });

  it('audits the export itself', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);

    await runExport(
      { orgId: ctx.org.id, actorId: ctx.manager.id, cycleId: ctx.cycle.id },
      memoryStorage(),
    );

    const events = await prisma.auditEvent.findMany({
      where: { entityId: ctx.cycle.id, action: 'cycle.export' },
    });

    // Someone taking every rating in the organization out of the system is
    // exactly the event a compliance trail exists to record.
    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe(ctx.manager.id);
  });

  it('exports nothing from another organization', async () => {
    const ctx = await cycleOrg();
    const other = await cycleOrg();
    await sheetWithGoal(other);
    const storage = memoryStorage();

    const result = await runExport(
      { orgId: ctx.org.id, actorId: ctx.manager.id, cycleId: other.cycle.id },
      storage,
    );

    expect(result.rows).toBe(0);
  });

  it('returns a link rather than the file', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);
    const storage = memoryStorage();

    const result = await runExport(
      { orgId: ctx.org.id, actorId: ctx.manager.id, cycleId: ctx.cycle.id },
      storage,
    );

    expect(result.url).toContain(result.key);
  });

  it('offers every column it declares', () => {
    for (const name of DEFAULT_EXPORT_COLUMNS) {
      expect(EXPORT_COLUMNS[name]?.header.length).toBeGreaterThan(0);
    }
  });
});

describe('storage [W5-05]', () => {
  it('defaults to an adapter that cannot reach the network', () => {
    /*
     * An export contains every goal, rating and comment in a cycle. A test
     * suite that could write one to a real bucket is a data leak waiting for a
     * misconfigured environment.
     */
    expect(storageFromEnv({}).name).toBe('memory');
    expect(storageFromEnv({ R2_ACCOUNT_ID: 'a' }).name).toBe('memory');
    expect(storageFromEnv(process.env).name).toBe('memory');
  });

  it('falls back to memory on a partially configured bucket', () => {
    // "Wrote it somewhere unexpected" is worse than "did not write it".
    expect(
      storageFromEnv({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_BUCKET: 'c' }).name,
    ).toBe('memory');
  });

  it('chooses R2 only when every setting is present', () => {
    expect(
      storageFromEnv({
        R2_ACCOUNT_ID: 'a',
        R2_ACCESS_KEY_ID: 'b',
        R2_SECRET_ACCESS_KEY: 'c',
        R2_BUCKET: 'd',
      }).name,
    ).toBe('r2');
  });

  it('signs a URL that expires', async () => {
    const storage = storageFromEnv({
      R2_ACCOUNT_ID: 'a',
      R2_ACCESS_KEY_ID: 'b',
      R2_SECRET_ACCESS_KEY: 'c',
      R2_BUCKET: 'd',
    });

    const url = await storage.signedUrl('exports/x.csv', 60);

    // A link that never expires outlives the reason it was created --
    // forwarded into an email thread and still live a year later.
    expect(url).toContain('expires=');
    expect(url).toContain('signature=');
  });
});

describe('the weekly digest [W5-06]', () => {
  it('counts what is waiting for each person', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx, { status: 'PENDING' });

    const items = await collectDigestItems();
    const forManager = items.find((item) => item.userId === ctx.manager.id);

    expect(forManager?.sheetsAwaitingMyApproval).toBe(1);
  });

  it('counts an unsubmitted sheet against its owner', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx, { status: 'DRAFT' });

    const items = await collectDigestItems();

    expect(
      items.find((item) => item.userId === ctx.employee.id)?.myUnsubmittedSheets,
    ).toBe(1);
  });

  it('sends nothing to someone with nothing outstanding', () => {
    /*
     * A digest that arrives every week saying "nothing to do" trains people to
     * filter it, and the week it matters it goes to the same folder.
     */
    expect(
      hasSomethingToSay({
        userId: 'u',
        orgId: 'o',
        sheetsAwaitingMyApproval: 0,
        myUnsubmittedSheets: 0,
        openEscalations: 0,
      }),
    ).toBe(false);
  });

  it('enqueues one digest per person with something outstanding', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx, { status: 'PENDING' });
    const { sender, sent } = recordingSender();

    await runWeeklyDigest(sender);

    const forManager = sent.filter((job) => job.data['userId'] === ctx.manager.id);

    expect(forManager).toHaveLength(1);
    expect(forManager[0]?.data['type']).toBe('digest.weekly');
  });
});

describe('the metrics snapshot [W5-07]', () => {
  it('reduces an instant to the UTC day it belongs to', () => {
    expect(civilDay(new Date('2026-08-15T23:59:59Z')).toISOString()).toBe(
      '2026-08-15T00:00:00.000Z',
    );
  });

  it('records the counts for an active cycle', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx, { status: 'APPROVED' });

    await runMetricsSnapshot(new Date());

    const row = await prisma.cycleMetrics.findFirstOrThrow({ where: { cycleId: ctx.cycle.id } });

    expect(row.sheetsApproved).toBe(1);
    expect(row.sheetsSubmitted).toBe(1);
    expect(row.checkInsRecorded).toBe(1);
    expect(row.totalEmployees).toBe(2);
  });

  it('counts the north star only when all three steps are done', async () => {
    const ctx = await cycleOrg();
    const sheet = await sheetWithGoal(ctx, { status: 'APPROVED' });

    await runMetricsSnapshot(new Date());
    const before = await prisma.cycleMetrics.findFirstOrThrow({ where: { cycleId: ctx.cycle.id } });

    // Approved and checked in, but no self-appraisal: not complete.
    expect(before.completedFullCycle).toBe(0);

    await prisma.appraisal.create({
      data: { sheetId: sheet.id, selfSubmittedAt: new Date() },
    });
    await runMetricsSnapshot(new Date());

    const after = await prisma.cycleMetrics.findFirstOrThrow({ where: { cycleId: ctx.cycle.id } });

    expect(after.completedFullCycle).toBe(1);
  });

  it('is idempotent: two runs in a day update one row', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);

    await runMetricsSnapshot(new Date());
    await runMetricsSnapshot(new Date());

    const rows = await prisma.cycleMetrics.findMany({ where: { cycleId: ctx.cycle.id } });

    // `@@unique([cycleId, capturedOn])` is what stops a cron firing twice from
    // putting a step in the graph.
    expect(rows).toHaveLength(1);
  });

  it('keeps yesterday snapshot when today is written', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);

    await runMetricsSnapshot(at(-1));
    await runMetricsSnapshot(new Date());

    const rows = await prisma.cycleMetrics.findMany({ where: { cycleId: ctx.cycle.id } });

    // The whole point of the table: a trend needs the past to survive.
    expect(rows).toHaveLength(2);
  });

  it('counts a divergent rating against the cycle scale', async () => {
    const ctx = await cycleOrg();
    const sheet = await sheetWithGoal(ctx, { status: 'APPROVED' });

    // The goal scores 0.8, which is 4.2 on a 1-5 scale. A manager rating of 1
    // is 3.2 away, well beyond 25% of the range.
    await prisma.appraisal.create({
      data: { sheetId: sheet.id, managerRating: 1, managerSubmittedAt: new Date(), finalRating: 1 },
    });

    await runMetricsSnapshot(new Date());

    const row = await prisma.cycleMetrics.findFirstOrThrow({ where: { cycleId: ctx.cycle.id } });

    expect(row.ratingsTotal).toBe(1);
    expect(row.divergentRatings).toBe(1);
  });

  it('does not count a rating that agrees with the goals', async () => {
    const ctx = await cycleOrg();
    const sheet = await sheetWithGoal(ctx, { status: 'APPROVED' });

    await prisma.appraisal.create({
      data: { sheetId: sheet.id, managerRating: 4, managerSubmittedAt: new Date(), finalRating: 4 },
    });

    await runMetricsSnapshot(new Date());

    const row = await prisma.cycleMetrics.findFirstOrThrow({ where: { cycleId: ctx.cycle.id } });

    expect(row.divergentRatings).toBe(0);
  });

  it('skips a cycle that is not active', async () => {
    const ctx = await cycleOrg();
    await sheetWithGoal(ctx);
    await prisma.reviewCycle.update({
      where: { id: ctx.cycle.id },
      data: { status: 'CLOSED' },
    });

    await runMetricsSnapshot(new Date());

    expect(await prisma.cycleMetrics.count({ where: { cycleId: ctx.cycle.id } })).toBe(0);
  });
});

import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createUser } from '../auth/index.js';

/**
 * W6-12, W6-13 — the administration surface over real HTTP.
 *
 * The planner's reasoning is unit-tested in `userImport.test.ts`, where it
 * belongs; what these assert is the part only a database can answer — that a
 * dry run writes nothing, that a commit writes everyone including the manager
 * links that pointed at rows which did not exist yet, and that a rolled-back
 * import leaves no half-built org chart behind.
 */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w6-admin-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

async function admin() {
  const signup = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name: 'Ravi', email: uniqueEmail(), password: PASSWORD });

  return {
    cookie: cookiesFrom(signup),
    user: (signup.body as { user: { id: string; orgId: string } }).user,
  };
}

/** A member with a real account and session, for the tests about refusal. */
async function memberWithSession(orgId: string, name: string, roles: string[] = ['EMPLOYEE']) {
  const email = uniqueEmail();

  await createUser({ email, password: PASSWORD, name, orgId });

  const user = await prisma.user.update({
    where: { email },
    data: { roles: roles as never, status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  const login = await request(app).post('/auth/login').send({ email, password: PASSWORD });

  return { user, cookie: cookiesFrom(login) };
}

type ImportBody = {
  dryRun: boolean;
  created: number;
  skipped: number;
  errors: { row: number; email: string; message: string }[];
};

const importRows = async (
  cookie: string[],
  rows: unknown[],
  dryRun: boolean,
): Promise<ImportBody & { status: number }> => {
  const response = await request(app)
    .post('/users/import')
    .set('Cookie', cookie)
    .send({ rows, dryRun });

  return { ...(response.body as ImportBody), status: response.status };
};

const person = (email: string, over: Record<string, unknown> = {}) => ({
  name: `Person ${email}`,
  email,
  role: 'EMPLOYEE',
  managerEmail: null,
  teamName: null,
  ...over,
});

describe('GET /users [W6-13]', () => {
  it('lists the organization for an administrator', async () => {
    const ctx = await admin();
    await memberWithSession(ctx.user.orgId, 'Priya');

    const response = await request(app).get('/users').set('Cookie', ctx.cookie);

    expect(response.status).toBe(200);
    expect((response.body as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(2);
  });

  it('searches on name and email without regard to case', async () => {
    const ctx = await admin();
    await memberWithSession(ctx.user.orgId, 'Priya Sharma');

    const response = await request(app).get('/users?search=priya').set('Cookie', ctx.cookie);

    const items = (response.body as { items: { name: string }[] }).items;
    // Being told there is no "priya" because the row says "Priya" is how a
    // search box stops being used.
    expect(items.map((item) => item.name)).toContain('Priya Sharma');
  });

  it('pages with a cursor and says whether there is more', async () => {
    const ctx = await admin();
    await memberWithSession(ctx.user.orgId, 'A');
    await memberWithSession(ctx.user.orgId, 'B');

    const first = await request(app).get('/users?limit=1').set('Cookie', ctx.cookie);
    const body = first.body as { items: { id: string }[]; nextCursor: string | null };

    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();

    const second = await request(app)
      .get(`/users?limit=1&cursor=${String(body.nextCursor)}`)
      .set('Cookie', ctx.cookie);

    expect((second.body as { items: { id: string }[] }).items[0]?.id).not.toBe(body.items[0]?.id);
  });

  it('refuses an employee, who has no business reading the roster', async () => {
    const ctx = await admin();
    const employee = await memberWithSession(ctx.user.orgId, 'Priya');

    const response = await request(app).get('/users').set('Cookie', employee.cookie);

    // `VIEW_USER` is SELF for an employee and SELF_AND_REPORTS for a manager;
    // a whole-org list is neither. Managers use /org-chart, which is scoped to
    // their line by construction.
    expect(response.status).toBe(403);
  });

  it('shows nobody from another organization', async () => {
    const ours = await admin();
    const theirs = await admin();
    await memberWithSession(theirs.user.orgId, 'Outsider');

    const response = await request(app).get('/users?search=Outsider').set('Cookie', ours.cookie);

    expect((response.body as { items: unknown[] }).items).toEqual([]);
  });
});

describe('POST /users/import · dry run [W6-13]', () => {
  it('reports what would happen and writes nothing', async () => {
    const ctx = await admin();
    const email = uniqueEmail();

    const preview = await importRows(ctx.cookie, [person(email)], true);

    expect(preview).toMatchObject({ dryRun: true, created: 1, errors: [] });
    // The whole point of a preview.
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('names the row and the reason for every bad line at once', async () => {
    const ctx = await admin();

    const preview = await importRows(
      ctx.cookie,
      [
        person(uniqueEmail(), { teamName: 'Nowhere' }),
        person(uniqueEmail(), { managerEmail: 'ghost@example.com' }),
      ],
      true,
    );

    // Somebody importing 300 people gets one list of problems, not 300 round
    // trips.
    expect(preview.errors.map((error) => error.row)).toEqual([1, 2]);
    expect(preview.created).toBe(0);
  });

  it('is a 200 even when every row failed', async () => {
    const ctx = await admin();

    const preview = await importRows(
      ctx.cookie,
      [person(uniqueEmail(), { teamName: 'Nowhere' })],
      true,
    );

    // The request was understood and answered in full. A 4xx would say the
    // server could not process the file, when what it did was process it.
    expect(preview.status).toBe(200);
  });
});

describe('POST /users/import · commit [W6-13]', () => {
  it('creates everyone and links managers who were only rows a moment ago', async () => {
    const ctx = await admin();
    const boss = uniqueEmail();
    const report = uniqueEmail();

    const result = await importRows(
      ctx.cookie,
      [
        // Deliberately out of order: the report comes before the manager.
        person(report, { managerEmail: boss }),
        person(boss, { role: 'MANAGER' }),
      ],
      false,
    );

    expect(result).toMatchObject({ dryRun: false, created: 2, errors: [] });

    const [created, manager] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: report } }),
      prisma.user.findUniqueOrThrow({ where: { email: boss } }),
    ]);

    expect(created.managerId).toBe(manager.id);
    // Invited, not active: they still have to set a password (US-101).
    expect(created.status).toBe('INVITED');
  });

  it('writes one audit row for the import, naming what it created', async () => {
    const ctx = await admin();
    const email = uniqueEmail();

    await importRows(ctx.cookie, [person(email)], false);

    const events = await prisma.auditEvent.findMany({
      where: { orgId: ctx.user.orgId, action: 'user.import' },
    });

    expect(events).toHaveLength(1);
    // A per-row trail would bury the fact that they arrived together.
    expect(JSON.stringify(events[0]?.after)).toContain(email);
  });

  it('leaves no half-built chart when part of the file is bad', async () => {
    const ctx = await admin();
    const bad = uniqueEmail();
    const under = uniqueEmail();
    const fine = uniqueEmail();

    const result = await importRows(
      ctx.cookie,
      [
        person(bad, { teamName: 'Nowhere' }),
        person(under, { managerEmail: bad }),
        person(fine),
      ],
      false,
    );

    expect(result.created).toBe(1);
    // The cascade is the acceptance criterion: `under` would otherwise have
    // been created pointing at a manager who was never written.
    expect(await prisma.user.count({ where: { email: { in: [bad, under] } } })).toBe(0);
    expect(await prisma.user.count({ where: { email: fine } })).toBe(1);
  });

  it('skips people who are already here rather than failing', async () => {
    const ctx = await admin();
    const existing = await memberWithSession(ctx.user.orgId, 'Priya');
    const existingEmail = (
      await prisma.user.findUniqueOrThrow({ where: { id: existing.user.id } })
    ).email;

    const result = await importRows(
      ctx.cookie,
      [person(existingEmail), person(uniqueEmail())],
      false,
    );

    expect(result).toMatchObject({ created: 1, skipped: 1, errors: [] });
  });

  it('refuses an employee', async () => {
    const ctx = await admin();
    const employee = await memberWithSession(ctx.user.orgId, 'Priya');

    const response = await request(app)
      .post('/users/import')
      .set('Cookie', employee.cookie)
      .send({ rows: [person(uniqueEmail())], dryRun: true });

    expect(response.status).toBe(403);
  });

  it('rejects a file with no rows before doing any work', async () => {
    const ctx = await admin();

    const response = await request(app)
      .post('/users/import')
      .set('Cookie', ctx.cookie)
      .send({ rows: [], dryRun: true });

    expect(response.status).toBe(400);
  });

  it('cannot reach into another organization by naming its manager', async () => {
    const ours = await admin();
    const theirs = await admin();
    const theirManager = await prisma.user.findUniqueOrThrow({
      where: { id: theirs.user.id },
      select: { email: true },
    });

    const result = await importRows(
      ours.cookie,
      [person(uniqueEmail(), { managerEmail: theirManager.email })],
      true,
    );

    // The scoped client never returned them, so as far as this import is
    // concerned that address belongs to nobody.
    expect(result.created).toBe(0);
    expect(result.errors[0]?.message).toContain('No user with the email');
  });
});

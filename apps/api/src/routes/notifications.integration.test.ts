import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createUser } from '../auth/index.js';

/** W6-18 — the in-app inbox (PRD US-1201). */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w6-inbox-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

async function org() {
  const signup = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name: 'Ravi', email: uniqueEmail(), password: PASSWORD });

  return {
    cookie: cookiesFrom(signup),
    user: (signup.body as { user: { id: string; orgId: string } }).user,
  };
}

async function memberWithSession(orgId: string, name: string) {
  const email = uniqueEmail();

  await createUser({ email, password: PASSWORD, name, orgId });

  const user = await prisma.user.update({
    where: { email },
    data: { roles: ['EMPLOYEE'], status: 'ACTIVE' },
    select: { id: true },
  });

  const login = await request(app).post('/auth/login').send({ email, password: PASSWORD });

  return { user, cookie: cookiesFrom(login) };
}

async function notify(
  orgId: string,
  userId: string,
  type: string,
  payload: Record<string, string> = {},
  over: Record<string, unknown> = {},
) {
  return prisma.notification.create({
    data: { orgId, userId, type, channel: 'IN_APP', payload, ...over },
    select: { id: true },
  });
}

type InboxBody = {
  unread: number;
  items: {
    id: string;
    type: string;
    subject: string;
    body: string;
    link: string | null;
    mandatory: boolean;
    readAt: string | null;
  }[];
  nextCursor: string | null;
};

const inbox = async (cookie: string[], query = ''): Promise<InboxBody & { status: number }> => {
  const response = await request(app).get(`/notifications${query}`).set('Cookie', cookie);

  return { ...(response.body as InboxBody), status: response.status };
};

describe('GET /notifications [W6-18]', () => {
  it('renders a stored type and payload into words', async () => {
    const ctx = await org();
    await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.returned', {
      sheetId: 's1',
      reason: 'Uptime target is below the team baseline.',
    });

    const body = await inbox(ctx.cookie);

    expect(body.status).toBe(200);
    /*
     * The row stores a dotted type and a payload; the words come from the
     * template at read time. Storing the sentence instead would freeze the
     * wording of every notification ever sent.
     */
    expect(body.items[0]?.subject).not.toBe('goalsheet.returned');
    expect(body.items[0]?.subject.length).toBeGreaterThan(0);
    expect(body.items[0]?.body).toContain('baseline');
  });

  it('carries the deep link the template decides', async () => {
    const ctx = await org();
    await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.returned', { sheetId: 's1' });

    const body = await inbox(ctx.cookie);

    // An inbox that says "your sheet was returned" and leaves you to find it
    // is a to-do list that makes work rather than removing it.
    expect(body.items[0]?.link).not.toBeNull();
  });

  it('counts every unread row, not the ones on this page', async () => {
    const ctx = await org();

    for (let i = 0; i < 3; i += 1) {
      await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.approved', { sheetId: `s${String(i)}` });
    }

    const body = await inbox(ctx.cookie, '?limit=1');

    expect(body.items).toHaveLength(1);
    // A badge showing 1 when there are 3 unread is worse than no badge.
    expect(body.unread).toBe(3);
  });

  it('shows nobody else’s notifications', async () => {
    const ctx = await org();
    const other = await memberWithSession(ctx.user.orgId, 'Priya');

    await notify(ctx.user.orgId, other.user.id, 'goalsheet.approved', { sheetId: 's1' });

    const body = await inbox(ctx.cookie);

    // The `where` is the actor's own id, not a filter the client can influence.
    expect(body.items).toEqual([]);
    expect(body.unread).toBe(0);
  });

  it('filters to unread on request', async () => {
    const ctx = await org();
    const read = await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.approved', { sheetId: 's1' });
    await prisma.notification.update({ where: { id: read.id }, data: { readAt: new Date() } });
    await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.approved', { sheetId: 's2' });

    const body = await inbox(ctx.cookie, '?unreadOnly=true');

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.readAt).toBeNull();
  });

  it('lists an unrenderable notification rather than dropping it', async () => {
    const ctx = await org();
    await notify(ctx.user.orgId, ctx.user.id, 'something.nobody.knows', {});

    const body = await inbox(ctx.cookie);

    /*
     * `renderNotification` throws on an unknown type so a job fails loudly
     * rather than sending an empty message. Here the row already exists, and
     * dropping it would silently shorten somebody's inbox — so it is shown
     * with its type as the subject. The type is the bug report.
     */
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.subject).toBe('something.nobody.knows');
    expect(body.items[0]?.link).toBeNull();
  });

  it('carries the mandatory flag so the UI can label it [US-1202]', async () => {
    const ctx = await org();
    await notify(
      ctx.user.orgId,
      ctx.user.id,
      'escalation.goals_not_submitted',
      { daysOverdue: '3', escalationId: 'e1' },
      { mandatory: true },
    );

    const body = await inbox(ctx.cookie);

    /*
     * Read from the template, not from the row. `mandatory` on the row is set
     * *from* the template when the notification is enqueued, so a job payload
     * cannot mark a suppressible notice as compliance-mandatory — or the
     * reverse, which is the one that matters.
     */
    expect(body.items[0]?.mandatory).toBe(true);
    expect(body.items[0]?.subject).toContain('3 days');
  });

  it('refuses without a session', async () => {
    const response = await request(app).get('/notifications');

    expect(response.status).toBe(401);
  });
});

describe('POST /notifications/read [W6-18]', () => {
  it('marks the named notifications and returns the new count', async () => {
    const ctx = await org();
    const first = await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.approved', { sheetId: 's1' });
    await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.approved', { sheetId: 's2' });

    const response = await request(app)
      .post('/notifications/read')
      .set('Cookie', ctx.cookie)
      .send({ ids: [first.id] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ marked: 1, unread: 1 });
  });

  it('cannot mark somebody else’s notification read', async () => {
    const ctx = await org();
    const other = await memberWithSession(ctx.user.orgId, 'Priya');
    const theirs = await notify(ctx.user.orgId, other.user.id, 'goalsheet.approved', {
      sheetId: 's1',
    });

    const response = await request(app)
      .post('/notifications/read')
      .set('Cookie', ctx.cookie)
      .send({ ids: [theirs.id] });

    // Scoped in the `where`, so a foreign id marks nothing rather than failing.
    expect(response.body).toMatchObject({ marked: 0 });
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt,
    ).toBeNull();
  });

  it('keeps the original timestamp when something is marked twice', async () => {
    const ctx = await org();
    const one = await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.approved', { sheetId: 's1' });

    await request(app)
      .post('/notifications/read')
      .set('Cookie', ctx.cookie)
      .send({ ids: [one.id] });

    const first = await prisma.notification.findUniqueOrThrow({ where: { id: one.id } });

    const second = await request(app)
      .post('/notifications/read')
      .set('Cookie', ctx.cookie)
      .send({ ids: [one.id] });

    // "When did I first see this" is the question a read receipt answers.
    expect((second.body as { marked: number }).marked).toBe(0);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: one.id } })).readAt?.getTime(),
    ).toBe(first.readAt?.getTime());
  });

  it('rejects an empty list before touching the database', async () => {
    const ctx = await org();

    const response = await request(app)
      .post('/notifications/read')
      .set('Cookie', ctx.cookie)
      .send({ ids: [] });

    expect(response.status).toBe(400);
  });

  it('writes no audit event, because opening an inbox is not a change', async () => {
    const ctx = await org();
    const one = await notify(ctx.user.orgId, ctx.user.id, 'goalsheet.approved', { sheetId: 's1' });

    await request(app)
      .post('/notifications/read')
      .set('Cookie', ctx.cookie)
      .send({ ids: [one.id] });

    // A trail filled with read receipts is a trail nobody reads.
    const events = await prisma.auditEvent.findMany({
      where: { orgId: ctx.user.orgId, entityType: 'Notification' },
    });
    expect(events).toEqual([]);
  });
});

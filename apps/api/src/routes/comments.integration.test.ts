import { prisma } from '@aura/db';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createUser } from '../auth/index.js';

/** W4-12 — threaded discussion on a sheet. Closes F-12. */

const app = createApp();

let seq = 0;
const uniqueEmail = (): string => `w4-cmt-${String(Date.now())}-${String(++seq)}@example.com`;
const PASSWORD = 'correct-horse-battery-staple';

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];

  if (Array.isArray(raw)) {
    return raw as string[];
  }
  return typeof raw === 'string' ? [raw] : [];
}

type Comment = {
  id: string;
  body: string | null;
  deleted: boolean;
  authorId: string;
  authorName: string;
  goalId: string | null;
  parentId: string | null;
  editedAt: string | null;
};

/**
 * A sheet with three people around it: its owner, their manager, and a
 * colleague with no reporting line to either.
 */
async function discussion() {
  const signup = await request(app)
    .post('/auth/signup')
    .send({ organizationName: 'Aura', name: 'Marcus', email: uniqueEmail(), password: PASSWORD });

  const managerCookie = cookiesFrom(signup);
  const manager = (signup.body as { user: { id: string; orgId: string } }).user;

  const withSession = async (name: string, managerId: string | null) => {
    const email = uniqueEmail();
    await createUser({ email, password: PASSWORD, name, orgId: manager.orgId });
    const user = await prisma.user.update({
      where: { email },
      data: { roles: ['EMPLOYEE'], status: 'ACTIVE', managerId },
      select: { id: true, name: true },
    });
    const login = await request(app).post('/auth/login').send({ email, password: PASSWORD });

    return { user, cookie: cookiesFrom(login) };
  };

  const employee = await withSession('Priya', manager.id);
  const stranger = await withSession('Ravi', null);

  const cycle = await prisma.reviewCycle.create({
    data: {
      orgId: manager.orgId,
      name: `FY-${String(Date.now())}-${String(++seq)}`,
      fiscalYear: 2026,
      status: 'ACTIVE',
      ratingScale: { min: 1, max: 3, labels: { '1': 'Below', '2': 'Meets', '3': 'Exceeds' } },
    },
    select: { id: true },
  });

  const sheet = await prisma.goalSheet.create({
    data: {
      orgId: manager.orgId,
      userId: employee.user.id,
      cycleId: cycle.id,
      status: 'APPROVED',
      goals: {
        create: [
          {
            thrustArea: 'BUSINESS_GROWTH',
            title: 'Grow ARR',
            uom: 'NUMERIC',
            direction: 'HIGHER_IS_BETTER',
            target: '100',
            weightage: 100,
          },
        ],
      },
    },
    select: { id: true, goals: { select: { id: true } } },
  });

  return {
    managerCookie,
    manager,
    employee,
    stranger,
    sheetId: sheet.id,
    goalId: sheet.goals[0]?.id ?? '',
  };
}

type Ctx = Awaited<ReturnType<typeof discussion>>;

const post = (ctx: Ctx, cookie: string[], body: Record<string, unknown>) =>
  request(app).post(`/sheets/${ctx.sheetId}/comments`).set('Cookie', cookie).send(body);

const read = (ctx: Ctx, cookie: string[], query = '') =>
  request(app).get(`/sheets/${ctx.sheetId}/comments${query}`).set('Cookie', cookie);

describe('posting and reading [W4-12]', () => {
  it('attributes a comment to a real user with a timestamp', async () => {
    const ctx = await discussion();

    const response = await post(ctx, ctx.employee.cookie, { body: 'I hit the target in Q3.' });

    expect(response.status).toBe(201);

    const comment = (response.body as { comment: Comment }).comment;
    // A real user id, not a display name. The prototype's whole identity
    // problem was string comparison standing in for a foreign key (F-02, F-05).
    expect(comment.authorId).toBe(ctx.employee.user.id);
    expect(comment.body).toBe('I hit the target in Q3.');
  });

  it('lets both sides of the discussion take part', async () => {
    const ctx = await discussion();

    await post(ctx, ctx.employee.cookie, { body: 'Here is my evidence.' });
    await post(ctx, ctx.managerCookie, { body: 'Noted, thank you.' });

    const thread = (read(ctx, ctx.employee.cookie));
    const comments = ((await thread).body as { comments: Comment[] }).comments;

    // A thread only one side can reach is not a discussion (US-602).
    expect(comments.map((entry) => entry.authorName)).toEqual(['Priya', 'Marcus']);
  });

  it('shows the thread oldest first, so a conversation reads forwards', async () => {
    const ctx = await discussion();

    await post(ctx, ctx.employee.cookie, { body: 'First.' });
    await post(ctx, ctx.employee.cookie, { body: 'Second.' });

    const comments = ((await read(ctx, ctx.employee.cookie)).body as { comments: Comment[] })
      .comments;

    expect(comments.map((entry) => entry.body)).toEqual(['First.', 'Second.']);
  });

  it('scopes a comment to one goal and filters by it', async () => {
    const ctx = await discussion();

    await post(ctx, ctx.employee.cookie, { body: 'About this goal.', goalId: ctx.goalId });
    await post(ctx, ctx.employee.cookie, { body: 'About the sheet.' });

    const scoped = ((await read(ctx, ctx.employee.cookie, `?goalId=${ctx.goalId}`))
      .body as { comments: Comment[] }).comments;

    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.body).toBe('About this goal.');
  });

  it('refuses a goal that belongs to another sheet', async () => {
    const ctx = await discussion();
    const other = await discussion();

    const response = await post(ctx, ctx.employee.cookie, {
      body: 'Wrong sheet.',
      goalId: other.goalId,
    });

    // The org filter stops another tenant's goal; it does not stop another
    // sheet's.
    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('UNKNOWN_GOAL');
  });

  it('threads a reply to a parent', async () => {
    const ctx = await discussion();
    const parent = (await post(ctx, ctx.employee.cookie, { body: 'Question?' })).body as {
      comment: Comment;
    };

    const reply = await post(ctx, ctx.managerCookie, {
      body: 'Answer.',
      parentId: parent.comment.id,
    });

    expect(reply.status).toBe(201);
    expect((reply.body as { comment: Comment }).comment.parentId).toBe(parent.comment.id);
  });

  it('refuses a parent from another discussion', async () => {
    const ctx = await discussion();
    const other = await discussion();
    const parent = (await post(other, other.employee.cookie, { body: 'Elsewhere.' })).body as {
      comment: Comment;
    };

    const response = await post(ctx, ctx.employee.cookie, {
      body: 'Reply.',
      parentId: parent.comment.id,
    });

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('UNKNOWN_PARENT');
  });

  it('requires a body', async () => {
    const ctx = await discussion();

    expect((await post(ctx, ctx.employee.cookie, {})).status).toBe(400);
  });
});

describe('who can see the discussion [W4-12]', () => {
  it('hides it from a colleague with no reporting line', async () => {
    const ctx = await discussion();
    await post(ctx, ctx.employee.cookie, { body: 'Private to my chain.' });

    const response = await read(ctx, ctx.stranger.cookie);

    // 404 rather than 403: a 403 would confirm the sheet exists.
    expect(response.status).toBe(404);
  });

  it('refuses a colleague posting into it', async () => {
    const ctx = await discussion();

    expect((await post(ctx, ctx.stranger.cookie, { body: 'Butting in.' })).status).toBe(404);
  });

  it('hides it across an organization boundary', async () => {
    const ctx = await discussion();
    const other = await request(app).post('/auth/signup').send({
      organizationName: 'Rival',
      name: 'Rival Admin',
      email: uniqueEmail(),
      password: PASSWORD,
    });

    expect((await read(ctx, cookiesFrom(other))).status).toBe(404);
  });
});

describe('editing and deleting [W4-12]', () => {
  const edit = (ctx: Ctx, cookie: string[], id: string, body: string) =>
    request(app)
      .patch(`/sheets/${ctx.sheetId}/comments/${id}`)
      .set('Cookie', cookie)
      .send({ body });

  it('edits inside the window and marks it edited', async () => {
    const ctx = await discussion();
    const created = (await post(ctx, ctx.employee.cookie, { body: 'Typo heer.' })).body as {
      comment: Comment;
    };

    const response = await edit(ctx, ctx.employee.cookie, created.comment.id, 'Typo here.');

    expect(response.status).toBe(200);

    const comment = (response.body as { comment: Comment }).comment;
    expect(comment.body).toBe('Typo here.');
    // Marked, not silent: a reply below it was written against the old words.
    expect(comment.editedAt).not.toBeNull();
  });

  it('refuses an edit after the window closes', async () => {
    const ctx = await discussion();
    const created = (await post(ctx, ctx.employee.cookie, { body: 'Original.' })).body as {
      comment: Comment;
    };

    // The deadline is stored on the row, so moving it back is exactly what
    // the passage of time would do -- no clock to fake.
    await prisma.sheetComment.update({
      where: { id: created.comment.id },
      data: { editableUntil: new Date(Date.now() - 1000) },
    });

    const response = await edit(ctx, ctx.employee.cookie, created.comment.id, 'Rewritten.');

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('EDIT_WINDOW_CLOSED');

    const after = await prisma.sheetComment.findUniqueOrThrow({
      where: { id: created.comment.id },
    });
    expect(after.body).toBe('Original.');
  });

  it('does not extend the window when a comment is edited', async () => {
    const ctx = await discussion();
    const created = (await post(ctx, ctx.employee.cookie, { body: 'One.' })).body as {
      comment: Comment;
    };
    const before = await prisma.sheetComment.findUniqueOrThrow({
      where: { id: created.comment.id },
      select: { editableUntil: true },
    });

    await edit(ctx, ctx.employee.cookie, created.comment.id, 'Two.');

    const after = await prisma.sheetComment.findUniqueOrThrow({
      where: { id: created.comment.id },
      select: { editableUntil: true },
    });

    // Otherwise a comment edited every fourteen minutes stays editable forever.
    expect(after.editableUntil.getTime()).toBe(before.editableUntil.getTime());
  });

  it('refuses someone editing another person comment', async () => {
    const ctx = await discussion();
    const created = (await post(ctx, ctx.employee.cookie, { body: 'Mine.' })).body as {
      comment: Comment;
    };

    const response = await edit(ctx, ctx.managerCookie, created.comment.id, 'Not yours.');

    // The manager may take part in this discussion -- COMMENT_ON_SHEET says so
    // -- and still may not put words in someone else's mouth. Two questions.
    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('NOT_AUTHOR');
  });

  it('leaves a tombstone on delete rather than a hole', async () => {
    const ctx = await discussion();
    const parent = (await post(ctx, ctx.employee.cookie, { body: 'Delete me.' })).body as {
      comment: Comment;
    };
    await post(ctx, ctx.managerCookie, { body: 'A reply.', parentId: parent.comment.id });

    const response = await request(app)
      .delete(`/sheets/${ctx.sheetId}/comments/${parent.comment.id}`)
      .set('Cookie', ctx.employee.cookie);

    expect(response.status).toBe(200);

    const comments = ((await read(ctx, ctx.employee.cookie)).body as { comments: Comment[] })
      .comments;

    // The row keeps its place, its author and its timestamp, and loses its
    // words. Dropping it entirely would strand the reply below it.
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ deleted: true, body: null });
    expect(comments[1]?.parentId).toBe(parent.comment.id);
  });

  it('refuses to edit a deleted comment', async () => {
    const ctx = await discussion();
    const created = (await post(ctx, ctx.employee.cookie, { body: 'Gone.' })).body as {
      comment: Comment;
    };

    await request(app)
      .delete(`/sheets/${ctx.sheetId}/comments/${created.comment.id}`)
      .set('Cookie', ctx.employee.cookie);

    const response = await edit(ctx, ctx.employee.cookie, created.comment.id, 'Back again.');

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('DELETED');
  });

  it('audits every change to the discussion', async () => {
    const ctx = await discussion();
    const created = (await post(ctx, ctx.employee.cookie, { body: 'One.' })).body as {
      comment: Comment;
    };
    await edit(ctx, ctx.employee.cookie, created.comment.id, 'Two.');
    await request(app)
      .delete(`/sheets/${ctx.sheetId}/comments/${created.comment.id}`)
      .set('Cookie', ctx.employee.cookie);

    const events = await prisma.auditEvent.findMany({
      where: { entityId: created.comment.id },
      select: { action: true },
    });

    expect(events.map((event) => event.action).sort()).toEqual([
      'comment.create',
      'comment.delete',
      'comment.edit',
    ]);
  });
});

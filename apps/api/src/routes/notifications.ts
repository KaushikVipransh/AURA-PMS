/**
 * The in-app inbox (PRD US-1201) — W6-18's data source.
 *
 * **Rendered on read, not on write.** The row stores a dotted type and a
 * payload; the words come from `NOTIFICATION_TEMPLATES` in `@aura/core` at the
 * moment somebody asks. Storing the rendered sentence instead would freeze the
 * wording of every notification ever sent, so fixing a typo would fix it only
 * for the future — and the same event would read differently depending on when
 * it happened.
 *
 * That is also why the email dispatcher (W5-03) renders from the same table:
 * an inbox and an email about the same event say the same thing because there
 * is one place the words live.
 *
 * **No `can()` call here, and that is deliberate.** These are the caller's own
 * notifications and nobody else's — the `where` clause is `userId:
 * req.actor.userId`, not a filter the client can influence. There is no
 * per-subject question to ask, because the subject is always the actor.
 */

import { renderNotification, UnknownNotificationError } from '@aura/core';
import { listNotificationsQuerySchema, markNotificationsReadRequestSchema } from '@aura/contracts';
import { Router } from 'express';

import { authenticated } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { parseBody, parseQuery } from '../validate.js';

export const notificationsRouter: Router = Router();

notificationsRouter.use(requireAuth);

/** The payload as the renderer wants it: flat strings, whatever was stored. */
function templateData(payload: unknown): Record<string, string> {
  if (payload === null || typeof payload !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
  );
}

/**
 * US-1201 — the inbox, with its unread count.
 *
 * The count is a separate `count()` rather than the length of the page, because
 * a badge showing "25" when there are 200 unread is worse than no badge. It
 * uses the `[userId, readAt]` index that exists for exactly this.
 */
notificationsRouter.get(
  '/',
  authenticated(async (req, res) => {
    const parsed = parseQuery(listNotificationsQuerySchema, req.query);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const query = parsed.data;
    const mine = { userId: req.actor.userId, channel: 'IN_APP' as const };

    const [rows, unread] = await Promise.all([
      req.db.notification.findMany({
        where: { ...mine, ...(query.unreadOnly ? { readAt: null } : {}) },
        take: query.limit + 1,
        ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          userId: true,
          type: true,
          channel: true,
          status: true,
          payload: true,
          mandatory: true,
          readAt: true,
          createdAt: true,
        },
      }),
      req.db.notification.count({ where: { ...mine, readAt: null } }),
    ]);

    const page = rows.slice(0, query.limit);

    res.status(200).json({
      unread,
      items: page.map((row) => {
        const data = templateData(row.payload);

        try {
          const rendered = renderNotification(row.type, data);

          return {
            id: row.id,
            type: row.type,
            subject: rendered.subject,
            body: rendered.body,
            /* The deep link US-1201 asks for. It comes from the template, so
               the destination for an event is decided in one place rather than
               guessed at by whoever renders it. */
            link: rendered.link,
            category: rendered.category,
            mandatory: rendered.mandatory,
            readAt: row.readAt,
            createdAt: row.createdAt,
          };
        } catch (error) {
          /*
           * An unrenderable notification is shown, not hidden.
           *
           * `renderNotification` throws on an unknown type so a *job* fails
           * loudly rather than sending an empty message. Here the row already
           * exists and dropping it would silently shorten somebody's inbox —
           * so it is listed with its type as the subject, which is honest and
           * findable. The type is the bug report.
           */
          return {
            id: row.id,
            type: row.type,
            subject: row.type,
            body:
              error instanceof UnknownNotificationError
                ? 'This notification cannot be displayed. Its type is not one this version knows about.'
                : 'This notification cannot be displayed.',
            link: null,
            category: 'SYSTEM',
            mandatory: row.mandatory,
            readAt: row.readAt,
            createdAt: row.createdAt,
          };
        }
      }),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  }),
);

/**
 * US-1201 — mark read, individually or in bulk.
 *
 * Scoped to the caller in the `where` clause, so a list containing somebody
 * else's id marks nothing rather than failing: the ids simply do not match any
 * row this person owns. `updateMany` returns how many it touched, which is what
 * comes back — a client that sent five ids and reads `count: 3` knows.
 *
 * Not audited. The audit trail records changes to the record of what happened
 * (PRD US-1101); "Priya opened her inbox" is not one of those, and a trail
 * filled with read receipts is a trail nobody reads.
 */
notificationsRouter.post(
  '/read',
  authenticated(async (req, res) => {
    const parsed = parseBody(markNotificationsReadRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const result = await req.db.notification.updateMany({
      where: {
        id: { in: [...parsed.data.ids] },
        userId: req.actor.userId,
        // Already-read rows keep their original timestamp: "when did I first
        // see this" is the question a read receipt answers.
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    const unread = await req.db.notification.count({
      where: { userId: req.actor.userId, channel: 'IN_APP', readAt: null },
    });

    res.status(200).json({ marked: result.count, unread });
  }),
);

/**
 * Threaded discussion on a goal sheet (PRD US-602) — W4-12, closes F-12.
 *
 * Mounted under the sheet, because a comment has no meaning apart from the
 * sheet it is about: `/sheets/:sheetId/comments`.
 */

import { can } from '@aura/core';
import { createCommentRequestSchema, updateCommentRequestSchema } from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import {
  CommentStateError,
  createComment,
  deleteComment,
  editComment,
  listComments,
} from '../services/comments.js';
import { reportingChain } from '../services/orgchart.js';
import { auditActor } from '../services/users.js';
import { parseBody } from '../validate.js';

function pathParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];

  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function requestContext(req: AuthedRequest): { ip: string | undefined; userAgent: string | undefined } {
  const userAgent = req.headers['user-agent'];

  return { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent : undefined };
}

function sendCommentError(res: Response, error: CommentStateError): void {
  const status =
    error.code === 'NOT_AUTHOR'
      ? 403
      : error.code === 'UNKNOWN_GOAL' || error.code === 'UNKNOWN_PARENT'
        ? 422
        : 409;

  res.status(status).json({ error: error.message, code: error.code });
}

/**
 * Whether the caller may take part in this sheet's discussion.
 *
 * `COMMENT_ON_SHEET` grants the employee, their chain and HR — which is exactly
 * US-602's "visible to employee, manager chain, and HR". A thread only one side
 * can reach is not a discussion.
 */
async function mayDiscuss(req: AuthedRequest, sheetId: string) {
  const sheet = await req.db.goalSheet.findUnique({
    where: { id: sheetId },
    select: { id: true, userId: true },
  });

  if (sheet === null) {
    return null;
  }

  const allowed = can(req.actor, 'COMMENT_ON_SHEET', {
    orgId: req.actor.orgId,
    subjectUserId: sheet.userId,
    managerChainIds: await reportingChain(req.db, req.actor.orgId, sheet.userId),
  });

  return allowed ? sheet : null;
}

export const commentsRouter: Router = Router({ mergeParams: true });

commentsRouter.use(requireAuth);

/** US-602 — the thread, oldest first, optionally scoped to one goal. */
commentsRouter.get(
  '/',
  authenticated(async (req, res) => {
    const sheetId = pathParam(req.params, 'sheetId');
    const sheet = await mayDiscuss(req, sheetId);

    if (sheet === null) {
      // 404 rather than 403: a 403 would confirm the sheet exists.
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const goalId = req.query['goalId'];

    res.status(200).json({
      comments: await listComments(
        req.db,
        sheet.id,
        typeof goalId === 'string' && goalId !== '' ? goalId : undefined,
      ),
    });
  }),
);

/** US-602 — post a comment. */
commentsRouter.post(
  '/',
  authenticated(async (req, res) => {
    const sheetId = pathParam(req.params, 'sheetId');
    const sheet = await mayDiscuss(req, sheetId);

    if (sheet === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const parsed = parseBody(createCommentRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    try {
      const comment = await createComment(
        req.db,
        auditActor(req.actor, requestContext(req)),
        sheet.id,
        parsed.data,
      );
      res.status(201).json({ comment });
    } catch (error) {
      if (error instanceof CommentStateError) {
        sendCommentError(res, error);
        return;
      }
      throw error;
    }
  }),
);

/** US-602 — edit inside the window. */
commentsRouter.patch(
  '/:commentId',
  authenticated(async (req, res) => {
    const sheet = await mayDiscuss(req, pathParam(req.params, 'sheetId'));

    if (sheet === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const parsed = parseBody(updateCommentRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    try {
      const comment = await editComment(
        req.db,
        auditActor(req.actor, requestContext(req)),
        pathParam(req.params, 'commentId'),
        parsed.data.body,
      );
      res.status(200).json({ comment });
    } catch (error) {
      if (error instanceof CommentStateError) {
        sendCommentError(res, error);
        return;
      }
      throw error;
    }
  }),
);

/** US-602 — delete, leaving a tombstone. */
commentsRouter.delete(
  '/:commentId',
  authenticated(async (req, res) => {
    const sheet = await mayDiscuss(req, pathParam(req.params, 'sheetId'));

    if (sheet === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    try {
      const comment = await deleteComment(
        req.db,
        auditActor(req.actor, requestContext(req)),
        pathParam(req.params, 'commentId'),
      );
      res.status(200).json({ comment });
    } catch (error) {
      if (error instanceof CommentStateError) {
        sendCommentError(res, error);
        return;
      }
      throw error;
    }
  }),
);

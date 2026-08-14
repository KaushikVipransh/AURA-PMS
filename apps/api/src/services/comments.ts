/**
 * Threaded discussion on a goal sheet (PRD US-602) — closes F-12.
 *
 * The prototype had nowhere to have this conversation, so it happened in email
 * and the context was gone by the time anyone needed it — which is exactly when
 * a rating is disputed six months later.
 *
 * Two decisions here are about what a thread has to survive:
 *
 *   - **Editing closes after a window.** A comment somebody has already replied
 *     to must not change out from under the reply, and "he edited it afterwards"
 *     is not a thing an audit trail should have to arbitrate. The deadline is
 *     stored on the row at insert rather than recomputed, so the server and the
 *     client cannot disagree about when it passed.
 *   - **Deleting leaves a tombstone.** The row stays and the body goes. A thread
 *     that silently loses a message reads as a thread that never had it, and
 *     the replies below stop making sense.
 */

import { COMMENT_EDIT_WINDOW_MINUTES, type CreateCommentRequest } from '@aura/contracts';
import type { AuditActor } from '@aura/core';

import type { ScopedPrisma } from '../db/scoped.js';
import type { AuditedTx } from './withAudit.js';
import { withAudit } from './withAudit.js';

const COMMENT_VIEW = {
  id: true,
  sheetId: true,
  goalId: true,
  parentId: true,
  authorId: true,
  body: true,
  editableUntil: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
} as const;

export class CommentStateError extends Error {
  readonly code: 'EDIT_WINDOW_CLOSED' | 'NOT_AUTHOR' | 'UNKNOWN_GOAL' | 'UNKNOWN_PARENT' | 'DELETED';

  constructor(code: CommentStateError['code'], message: string) {
    super(message);
    this.name = 'CommentStateError';
    this.code = code;
  }
}

type CommentRow = {
  id: string;
  sheetId: string;
  goalId: string | null;
  parentId: string | null;
  authorId: string;
  body: string;
  editableUntil: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

/**
 * The wire shape of a comment.
 *
 * A deleted comment keeps its position, its author and its timestamp and loses
 * its words. Returning the body of a deleted comment would make the delete
 * cosmetic; omitting the row entirely would break the thread above it.
 */
function present(row: CommentRow & { author?: { name: string } }) {
  const deleted = row.deletedAt !== null;

  return {
    id: row.id,
    sheetId: row.sheetId,
    goalId: row.goalId,
    parentId: row.parentId,
    authorId: row.authorId,
    authorName: row.author?.name ?? '',
    body: deleted ? null : row.body,
    deleted,
    editableUntil: row.editableUntil,
    editedAt: row.editedAt,
    createdAt: row.createdAt,
  };
}

/** US-602 — the thread on a sheet, oldest first, optionally one goal's. */
export async function listComments(db: ScopedPrisma, sheetId: string, goalId?: string) {
  const rows = await db.sheetComment.findMany({
    where: { sheetId, ...(goalId === undefined ? {} : { goalId }) },
    orderBy: { createdAt: 'asc' },
    select: { ...COMMENT_VIEW, author: { select: { name: true } } },
  });

  return rows.map(present);
}

/** US-602 — post a comment, optionally scoped to a goal or replying to one. */
export async function createComment(
  db: ScopedPrisma,
  actor: AuditActor,
  sheetId: string,
  input: CreateCommentRequest,
) {
  return withAudit(
    db,
    actor,
    { action: 'comment.create', entityType: 'SheetComment' },
    async (tx) => {
      if (input.goalId !== null) {
        // Scoped to a goal on *this* sheet. The org filter stops another
        // tenant's goal; it does not stop another sheet's.
        const goal = await tx.goal.count({ where: { id: input.goalId, sheetId } });

        if (goal === 0) {
          throw new CommentStateError('UNKNOWN_GOAL', 'That goal is not on this sheet.');
        }
      }

      if (input.parentId !== null) {
        const parent = await tx.sheetComment.count({ where: { id: input.parentId, sheetId } });

        if (parent === 0) {
          throw new CommentStateError(
            'UNKNOWN_PARENT',
            'That comment is not part of this discussion.',
          );
        }
      }

      const created = await tx.sheetComment.create({
        data: {
          orgId: actor.orgId,
          sheetId,
          goalId: input.goalId,
          parentId: input.parentId,
          authorId: actor.userId,
          body: input.body,
          /* Stored, not recomputed on read. Two places deriving "is this still
             editable" is two places that can disagree, and the disagreement
             would only ever show up in the argument the window exists to
             prevent. */
          editableUntil: new Date(Date.now() + COMMENT_EDIT_WINDOW_MINUTES * 60_000),
        },
        select: COMMENT_VIEW,
      });

      return { value: present(created), after: created, entityId: created.id };
    },
  );
}

/** Load a comment and check the actor may change it. */
async function ownComment(
  tx: AuditedTx,
  commentId: string,
  actor: AuditActor,
  requireWindow: boolean,
): Promise<CommentRow> {
  const comment = await tx.sheetComment.findUniqueOrThrow({
    where: { id: commentId, orgId: actor.orgId },
    select: COMMENT_VIEW,
  });

  /*
   * Authorship, not the policy table.
   *
   * `COMMENT_ON_SHEET` in W2-06 answers "may you take part in this
   * discussion", which a manager and HR both may. Neither of them may put
   * words in someone else's mouth, and that is a different question with a
   * different answer — so it is asked here rather than folded into the first.
   */
  if (comment.authorId !== actor.userId) {
    throw new CommentStateError('NOT_AUTHOR', 'Only the author can change their own comment.');
  }

  if (comment.deletedAt !== null) {
    throw new CommentStateError('DELETED', 'That comment has been deleted.');
  }

  if (requireWindow && Date.now() > comment.editableUntil.getTime()) {
    throw new CommentStateError(
      'EDIT_WINDOW_CLOSED',
      `A comment can only be edited within ${String(COMMENT_EDIT_WINDOW_MINUTES)} minutes of posting.`,
    );
  }

  return comment;
}

/** US-602 — edit within the window, and never after it. */
export async function editComment(
  db: ScopedPrisma,
  actor: AuditActor,
  commentId: string,
  body: string,
) {
  return withAudit(
    db,
    actor,
    { action: 'comment.edit', entityType: 'SheetComment', entityId: commentId },
    async (tx) => {
      const before = await ownComment(tx, commentId, actor, true);

      const after = await tx.sheetComment.update({
        where: { id: commentId },
        // The window itself is not extended by an edit: otherwise a comment
        // edited every fourteen minutes would stay editable forever.
        data: { body, editedAt: new Date() },
        select: COMMENT_VIEW,
      });

      return { value: present(after), before, after };
    },
  );
}

/** US-602 — delete, leaving a tombstone the thread can still hang from. */
export async function deleteComment(db: ScopedPrisma, actor: AuditActor, commentId: string) {
  return withAudit(
    db,
    actor,
    { action: 'comment.delete', entityType: 'SheetComment', entityId: commentId },
    async (tx) => {
      const before = await ownComment(tx, commentId, actor, false);

      const after = await tx.sheetComment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
        select: COMMENT_VIEW,
      });

      return { value: present(after), before, after };
    },
  );
}

/**
 * The notification inbox (PRD US-1201) — W6-18.
 *
 * **Every item deep-links to the thing that needs doing.** An inbox that says
 * "your sheet was returned" and leaves you to find it is a to-do list that
 * makes work rather than removing it. The link comes from the notification
 * template in `@aura/core`, so where an event sends you is decided in one
 * place — the same place the email dispatcher reads.
 *
 * **Mandatory notices are labelled rather than hidden** (US-1202). A compliance
 * notice cannot be turned off; pretending otherwise, or quietly filtering it
 * out of a preference screen, would be the system lying about what it does.
 *
 * Opening the inbox does not mark anything read. That is a deliberate refusal:
 * "read" here means somebody said they had dealt with it, and a page that
 * clears its own badge on render turns the badge into decoration.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useInbox, useMarkRead } from '../lib/records.js';

export function InboxPage() {
  const [unreadOnly, setUnreadOnly] = useState(true);
  const inbox = useInbox(unreadOnly);
  const markRead = useMarkRead();

  const items = inbox.data?.items ?? [];
  const unread = inbox.data?.unread ?? 0;
  const unreadIds = items.filter((item) => item.readAt === null).map((item) => item.id);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          Inbox{' '}
          {unread > 0 && (
            <span
              className="ml-1 rounded-full bg-slate-900 px-2 py-0.5 align-middle text-sm text-white"
              data-testid="unread-badge"
            >
              {unread}
            </span>
          )}
        </h1>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
            }}
          />
          Unread only
        </label>
      </div>

      <button
        type="button"
        onClick={() => {
          markRead.mutate(unreadIds, {
            onSuccess: () => {
              toast.success('Marked read.');
            },
          });
        }}
        disabled={unreadIds.length === 0 || markRead.isPending}
        className="mt-4 rounded border px-4 py-2 text-sm disabled:opacity-50"
      >
        Mark {unreadIds.length} read
      </button>

      {inbox.isPending ? (
        <p className="mt-6 text-sm" role="status">
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">
          {unreadOnly ? 'Nothing unread.' : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-3" data-testid="inbox-list">
          {items.map((item) => (
            <li
              key={item.id}
              className={
                item.readAt === null ? 'rounded border border-slate-400 p-4' : 'rounded border p-4'
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium">
                  {item.readAt === null && (
                    /* The word as well as the border. "Unread" is not
                       something a heavier outline conveys to everyone. */
                    <span className="sr-only">Unread: </span>
                  )}
                  {item.subject}
                </h2>
                <time dateTime={item.createdAt} className="text-xs text-slate-600">
                  {new Date(item.createdAt).toLocaleDateString()}
                </time>
              </div>

              <p className="mt-1 text-sm text-slate-700">{item.body}</p>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {item.link !== null && (
                  <Link to={item.link} className="text-sm underline">
                    Go to it
                  </Link>
                )}

                {item.mandatory && (
                  <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                    Compliance notice — cannot be turned off
                  </span>
                )}

                {item.readAt === null && (
                  <button
                    type="button"
                    onClick={() => {
                      markRead.mutate([item.id]);
                    }}
                    disabled={markRead.isPending}
                    className="text-xs underline disabled:opacity-50"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

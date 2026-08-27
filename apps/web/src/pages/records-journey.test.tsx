import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../lib/query.js';
import { AuditPage } from './AuditPage.js';
import { InboxPage } from './InboxPage.js';

/** W6-17, W6-18 — the audit trail and the inbox. */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Longest fragment first, so `/notifications/read` never matches as `/notifications`. */
function serve(routes: Readonly<Record<string, unknown>>): void {
  const ordered = Object.entries(routes).sort(([a], [b]) => b.length - a.length);

  fetchMock.mockImplementation((url: string) => {
    for (const [fragment, body] of ordered) {
      if (String(url).includes(fragment)) {
        return Promise.resolve(json(body));
      }
    }
    return Promise.resolve(json({ ok: true }));
  });
}

const render_ = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

function lastBody(fragment: string): Record<string, unknown> {
  const calls = fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(fragment) &&
      typeof (init as { body?: unknown } | undefined)?.body === 'string',
  );
  const last = calls[calls.length - 1];

  return JSON.parse(String((last?.[1] as { body?: string } | undefined)?.body)) as Record<
    string,
    unknown
  >;
}

describe('AuditPage [W6-17]', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    id: 'ev1',
    orgId: 'o1',
    actorId: 'u-marcus',
    action: 'goalsheet.approve',
    entityType: 'GoalSheet',
    entityId: 's1',
    before: { status: 'PENDING', userId: 'u1', approverId: null },
    after: { status: 'APPROVED', userId: 'u1', approverId: 'u-marcus' },
    changedFields: ['status', 'approverId'],
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    createdAt: '2026-04-11T09:31:02.117Z',
    ...over,
  });

  const AUDIT = { items: [event()], nextCursor: null };

  it('reads a dotted action as a sentence', async () => {
    serve({ '/audit': AUDIT });

    render_(<AuditPage />);

    // `goalsheet.approve` is precise and unreadable at a glance in a list of
    // two hundred.
    expect(await screen.findByText(/approved a sheet/)).toBeInTheDocument();
  });

  it('names the real actor, not a string somebody typed', async () => {
    serve({ '/audit': AUDIT });

    render_(<AuditPage />);

    // F-09 was a trail attributed to "System Compliance Board".
    expect(await screen.findByText(/by u-marcus/)).toBeInTheDocument();
  });

  it('summarises what changed without being opened', async () => {
    serve({ '/audit': AUDIT });

    render_(<AuditPage />);

    expect(await screen.findByText(/2 fields: status, approverId/)).toBeInTheDocument();
  });

  it('shows only the changed fields in the diff', async () => {
    serve({ '/audit': AUDIT });

    render_(<AuditPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Show the diff' }));

    const diff = screen.getByTestId('diff-ev1');
    expect(diff).toHaveTextContent('status');
    expect(diff).toHaveTextContent('approverId');
    // `userId` is identical on both sides and would be pure noise.
    expect(diff).not.toHaveTextContent('userId');
  });

  it('says "not set" rather than leaving a cell that reads as a bug', async () => {
    serve({ '/audit': AUDIT });

    render_(<AuditPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Show the diff' }));

    const diff = screen.getByTestId('diff-ev1');
    const row = within(diff).getByText('approverId').closest('tr');

    expect(within(row as HTMLElement).getByText('not set')).toBeInTheDocument();
  });

  it('offers the unchanged fields behind a second toggle', async () => {
    serve({ '/audit': AUDIT });

    render_(<AuditPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Show the diff' }));
    await user.click(screen.getByRole('button', { name: /Every field, including unchanged/ }));

    expect(screen.getByTestId('diff-ev1')).toHaveTextContent('userId');
  });

  it('filters by action prefix, so "goalsheet." finds every verb on a sheet', async () => {
    serve({ '/audit': AUDIT });

    render_(<AuditPage />);
    const user = userEvent.setup();

    await screen.findByTestId('audit-list');
    await user.selectOptions(screen.getByLabelText('What happened'), 'goalsheet.');

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('action=goalsheet.')),
      ).toBe(true);
    });
  });

  it('offers no way to edit or delete an entry', async () => {
    serve({ '/audit': AUDIT });

    render_(<AuditPage />);

    await screen.findByTestId('audit-list');
    // An audit trail somebody can tidy is not evidence. The API has no
    // endpoint for it either.
    expect(screen.queryByRole('button', { name: /delete|edit|remove/i })).not.toBeInTheDocument();
  });

  it('explains an empty result as "none happened", not "none survived"', async () => {
    serve({ '/audit': { items: [], nextCursor: null } });

    render_(<AuditPage />);

    expect(await screen.findByText(/not that they were removed/)).toBeInTheDocument();
  });

  it('handles a create, which has nothing before it', async () => {
    serve({
      '/audit': {
        items: [
          event({
            id: 'ev2',
            action: 'user.invite',
            before: null,
            after: { email: 'priya@example.com', status: 'INVITED' },
            changedFields: ['email', 'status'],
          }),
        ],
        nextCursor: null,
      },
    });

    render_(<AuditPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Show the diff' }));

    const diff = screen.getByTestId('diff-ev2');
    expect(diff).toHaveTextContent('priya@example.com');
    expect(within(diff).getAllByText('not set').length).toBeGreaterThan(0);
  });
});

describe('InboxPage [W6-18]', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    type: 'goalsheet.returned',
    subject: 'Your goal sheet was returned',
    body: 'Marcus asked for changes to two goals.',
    link: '/goals',
    category: 'APPROVAL',
    mandatory: false,
    readAt: null,
    createdAt: '2026-04-11T09:31:02.117Z',
    ...over,
  });

  const INBOX = { unread: 3, items: [item()], nextCursor: null };

  it('shows the unread count as a badge', async () => {
    serve({ '/notifications': INBOX });

    render_(<InboxPage />);

    // The count is the server's, over every unread row — not the length of
    // this page, which would show 1 when there are 200.
    expect(await screen.findByTestId('unread-badge')).toHaveTextContent('3');
  });

  it('deep-links each item to the thing that needs doing', async () => {
    serve({ '/notifications': INBOX });

    render_(<InboxPage />);

    const link = await screen.findByRole('link', { name: 'Go to it' });
    expect(link).toHaveAttribute('href', '/goals');
  });

  it('does not mark anything read just by being opened', async () => {
    serve({ '/notifications': INBOX });

    render_(<InboxPage />);

    await screen.findByTestId('inbox-list');
    /*
     * "Read" means somebody said they had dealt with it. A page that clears
     * its own badge on render turns the badge into decoration.
     */
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/read'))).toBe(false);
  });

  it('marks one read on request', async () => {
    serve({ '/notifications': INBOX });

    render_(<InboxPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Mark read' }));

    await waitFor(() => {
      expect(lastBody('/notifications/read')).toEqual({ ids: ['n1'] });
    });
  });

  it('marks the whole page read in bulk', async () => {
    serve({
      '/notifications': {
        unread: 2,
        items: [item(), item({ id: 'n2', subject: 'Another' })],
        nextCursor: null,
      },
    });

    render_(<InboxPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Mark 2 read' }));

    await waitFor(() => {
      expect(lastBody('/notifications/read')).toEqual({ ids: ['n1', 'n2'] });
    });
  });

  it('labels a compliance notice rather than hiding it [US-1202]', async () => {
    serve({
      '/notifications': {
        unread: 1,
        items: [item({ mandatory: true, subject: 'Your goals are overdue' })],
        nextCursor: null,
      },
    });

    render_(<InboxPage />);

    // A compliance notice cannot be turned off; pretending otherwise would be
    // the system lying about what it does.
    expect(await screen.findByText(/cannot be turned off/)).toBeInTheDocument();
  });

  it('announces unread status in words, not only as a heavier border', async () => {
    serve({ '/notifications': INBOX });

    render_(<InboxPage />);

    expect(await screen.findByText('Unread:')).toBeInTheDocument();
  });

  it('offers no mark-read control on something already read', async () => {
    serve({
      '/notifications': {
        unread: 0,
        items: [item({ readAt: '2026-04-12T00:00:00.000Z' })],
        nextCursor: null,
      },
    });

    render_(<InboxPage />);

    await screen.findByTestId('inbox-list');
    expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
  });

  it('switches between unread-only and everything', async () => {
    serve({ '/notifications': INBOX });

    render_(<InboxPage />);
    const user = userEvent.setup();

    await screen.findByTestId('inbox-list');
    await user.click(screen.getByLabelText('Unread only'));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('unreadOnly=false')),
      ).toBe(true);
    });
  });
});

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../lib/query.js';
import { QueuePage } from './QueuePage.js';
import { RatingPage } from './RatingPage.js';
import { ReviewPage } from './ReviewPage.js';

/** W6-09, W6-10, W6-11 — the manager journey. */

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

const CYCLE = { id: 'cyc1', name: 'FY26', fiscalYear: 2026, status: 'ACTIVE', phases: [] };

const row = (over: Record<string, unknown> = {}) => ({
  sheetId: 's1',
  userId: 'u1',
  userName: 'Priya',
  status: 'PENDING',
  submittedAt: '2026-04-01T00:00:00.000Z',
  goalCount: 3,
  score: 0.8,
  selfAppraisalSubmitted: false,
  rated: false,
  actions: ['APPROVE', 'RETURN'],
  dueAt: '2026-04-10T00:00:00.000Z',
  daysOverdue: 0,
  ...over,
});

const QUEUE = {
  cycleId: 'cyc1',
  items: [row()],
  counts: { total: 1, awaitingApproval: 1, awaitingRating: 0, overdue: 0 },
};

const GOAL = {
  id: 'g1',
  thrustArea: 'BUSINESS_GROWTH',
  title: 'Grow ARR',
  uom: 'NUMERIC',
  direction: 'HIGHER_IS_BETTER',
  target: '100',
  weightage: 100,
  actualAchievement: '80',
  status: 'ON_TRACK',
};

const REVIEW = {
  sheet: {
    id: 's1',
    userId: 'u1',
    cycleId: 'cyc1',
    status: 'PENDING',
    submittedAt: '2026-04-01T00:00:00.000Z',
    approvedAt: null,
    goals: [GOAL],
  },
  owner: { id: 'u1', name: 'Priya', email: 'priya@example.com' },
  score: { score: 0.8, percent: 80 },
  checkIns: [
    {
      at: '2026-05-01T00:00:00.000Z',
      actorId: 'u1',
      changes: [
        {
          goalId: 'g1',
          title: 'Grow ARR',
          fromActual: null,
          toActual: '80',
          fromStatus: 'NOT_STARTED',
          toStatus: 'ON_TRACK',
        },
      ],
    },
  ],
};

const APPRAISAL = {
  sheetId: 's1',
  scale: { min: 1, max: 5 },
  computedScore: 0.8,
  computedOnScale: 4.2,
  appraisal: {
    selfNarrative: 'A steady year.',
    selfRating: null,
    selfSubmittedAt: '2026-06-01T00:00:00.000Z',
    managerRating: null,
    finalRating: null,
    releasedAt: null,
  },
  goals: [
    {
      id: 'g1',
      title: 'Grow ARR',
      target: '100',
      actualAchievement: '80',
      weightage: 100,
      computedScore: 0.8,
      selfNarrative: 'Landed two large accounts in Q3.',
      managerRating: null,
      managerNarrative: null,
    },
  ],
};

/**
 * Route each call by URL fragment.
 *
 * `/sheets/s1/review` and `/appraisals/s1` are matched before the bare
 * `/sheets`, because the rating page asks for both and a first-match-wins
 * router would otherwise answer the review call with a goal sheet.
 */
function serve(routes: Readonly<Record<string, unknown>>, missing: readonly string[] = []): void {
  fetchMock.mockImplementation((url: string) => {
    const path = String(url);

    for (const fragment of missing) {
      if (path.includes(fragment)) {
        return Promise.resolve(json({ error: 'Not found' }, 404));
      }
    }
    for (const [fragment, body] of Object.entries(routes)) {
      if (path.includes(fragment)) {
        return Promise.resolve(json(body));
      }
    }
    return Promise.resolve(json({ error: 'Unexpected call' }, 500));
  });
}

const render_ = (ui: React.ReactElement, path = '/queue') =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/queue" element={ui} />
          <Route path="/queue/:sheetId" element={ui} />
          <Route path="/queue/:sheetId/rating" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The parsed body of the last writing call whose URL contains `fragment`. */
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

describe('QueuePage [W6-09]', () => {
  it('shows only the actions the server granted for a row', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/queue': {
        ...QUEUE,
        items: [row({ sheetId: 's2', userName: 'Mia', actions: ['APPROVE'] })],
      },
    });

    render_(<QueuePage />);

    await screen.findByText('Mia');
    /* Mia is an indirect report: W2-06 grants approval on REPORTS but rating
       on DIRECT_REPORT only, so the row carries APPROVE and not RATE. The page
       does not work that out — a page that did would eventually offer a button
       the API refuses. */
    expect(screen.getByRole('link', { name: 'Review' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rate' })).not.toBeInTheDocument();
  });

  it('marks an overdue row in words as well as in colour', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/queue': { ...QUEUE, items: [row({ daysOverdue: 3 })] },
    });

    render_(<QueuePage />);

    // Colour alone is not a signal everybody receives.
    expect(await screen.findByText('Overdue by 3 days')).toBeInTheDocument();
  });

  it('counts what there is to do', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/queue': {
        ...QUEUE,
        counts: { total: 5, awaitingApproval: 2, awaitingRating: 1, overdue: 1 },
      },
    });

    render_(<QueuePage />);

    const counts = await screen.findByTestId('queue-counts');
    expect(counts).toHaveTextContent('2 to approve');
    expect(counts).toHaveTextContent('1 to rate');
  });

  it('filters to a status without fetching again', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/queue': {
        ...QUEUE,
        items: [row(), row({ sheetId: 's2', userName: 'Sam', status: 'APPROVED', actions: [] })],
      },
    });

    render_(<QueuePage />);
    const user = userEvent.setup();

    await screen.findByText('Priya');
    const before = fetchMock.mock.calls.length;

    await user.selectOptions(screen.getByLabelText('Show'), 'APPROVED');

    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.queryByText('Priya')).not.toBeInTheDocument();
    // Filtering is a view over what arrived, not a round trip.
    expect(fetchMock.mock.calls).toHaveLength(before);
  });

  it('sorts by name on request', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/queue': {
        ...QUEUE,
        items: [row({ userName: 'Zoe' }), row({ sheetId: 's2', userName: 'Ann' })],
      },
    });

    render_(<QueuePage />);
    const user = userEvent.setup();

    await screen.findByText('Zoe');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'NAME');

    const names = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);
    expect(names).toEqual(['Ann', 'Zoe']);
  });

  it('approves the selected sheets one request each [F-29]', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/queue': {
        ...QUEUE,
        items: [row(), row({ sheetId: 's2', userName: 'Sam' })],
      },
    });

    render_(<QueuePage />);
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Select Priya'));
    await user.click(screen.getByLabelText('Select Sam'));
    await user.click(screen.getByRole('button', { name: 'Approve 2 selected' }));

    await waitFor(() => {
      const approvals = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/approve'),
      );
      // Two approvals, not one batch: each snapshots its own sheet, writes its
      // own audit row and notifies its own employee.
      expect(approvals).toHaveLength(2);
    });
  });

  it('reports which sheets failed rather than only that something did', async () => {
    fetchMock.mockImplementation((url: string) => {
      const path = String(url);

      if (path.includes('/s2/approve')) {
        return Promise.resolve(json({ error: 'That sheet is no longer pending.' }, 409));
      }
      if (path.includes('/approve')) {
        return Promise.resolve(json({ ok: true }));
      }
      if (path.includes('/cycles')) {
        return Promise.resolve(json({ cycles: [CYCLE] }));
      }
      return Promise.resolve(
        json({ ...QUEUE, items: [row(), row({ sheetId: 's2', userName: 'Sam' })] }),
      );
    });

    render_(<QueuePage />);
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Select Priya'));
    await user.click(screen.getByLabelText('Select Sam'));
    await user.click(screen.getByRole('button', { name: 'Approve 2 selected' }));

    // `Promise.all` would have rejected on Sam and lost the fact that Priya's
    // approval went through.
    await waitFor(() => {
      const approvals = fetchMock.mock.calls.filter(([url]) => String(url).includes('/approve'));
      expect(approvals).toHaveLength(2);
    });
  });

  it('says so when nothing is waiting', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/queue': { cycleId: 'cyc1', items: [], counts: { total: 0, awaitingApproval: 0, awaitingRating: 0, overdue: 0 } },
    });

    render_(<QueuePage />);

    expect(await screen.findByText(/Nothing is waiting on you right now/)).toBeInTheDocument();
  });
});

describe('ReviewPage [W6-10]', () => {
  const routes = {
    '/cycles': { cycles: [CYCLE] },
    '/review': REVIEW,
  };

  it('shows the sheet with its owner and server-computed score', async () => {
    serve(routes);

    render_(<ReviewPage />, '/queue/s1');

    expect(await screen.findByRole('heading', { name: 'Priya' })).toBeInTheDocument();
    expect(screen.getByText(/score 80%/)).toBeInTheDocument();
  });

  it('shows the check-in history behind the actuals', async () => {
    serve(routes);

    render_(<ReviewPage />, '/queue/s1');

    const history = await screen.findByTestId('check-in-history');
    expect(history).toHaveTextContent('Grow ARR: — → 80');
  });

  it('will not adjust until something has changed and a note is written', async () => {
    serve(routes);

    render_(<ReviewPage />, '/queue/s1');
    const user = userEvent.setup();

    const weightage = await screen.findByLabelText('Weightage %');
    expect(screen.getByRole('button', { name: /Save 0 adjustments/ })).toBeDisabled();

    await user.clear(weightage);
    await user.type(weightage, '90');

    // Changed, but still unexplained — the employee is notified with the note,
    // so an adjustment without one is a surprise rather than a message.
    expect(screen.getByRole('button', { name: /Save 1 adjustment/ })).toBeDisabled();

    await user.type(screen.getByLabelText('Note'), 'Rebalanced towards uptime.');
    expect(screen.getByRole('button', { name: /Save 1 adjustment/ })).toBeEnabled();
  });

  it('sends only the goals whose weightage moved', async () => {
    serve(routes);

    render_(<ReviewPage />, '/queue/s1');
    const user = userEvent.setup();

    const weightage = await screen.findByLabelText('Weightage %');
    await user.clear(weightage);
    await user.type(weightage, '90');
    await user.type(screen.getByLabelText('Note'), 'Rebalanced.');
    await user.click(screen.getByRole('button', { name: /Save 1 adjustment/ }));

    await waitFor(() => {
      const adjustments = lastBody('/adjust')['adjustments'] as Record<string, unknown>[];
      expect(adjustments).toEqual([{ goalId: 'g1', weightage: 90 }]);
    });
  });

  it('warns live when an adjustment would break the total [F-10]', async () => {
    serve(routes);

    render_(<ReviewPage />, '/queue/s1');
    const user = userEvent.setup();

    const weightage = await screen.findByLabelText('Weightage %');
    await user.clear(weightage);
    await user.type(weightage, '90');

    // The same `validateWeightages` the schema and the API call. The prototype
    // had three disagreeing answers to this question.
    expect(await screen.findByTestId('weightage-issues')).toHaveTextContent('90');
  });

  it('requires a reason before returning [US-305]', async () => {
    serve(routes);

    render_(<ReviewPage />, '/queue/s1');
    const user = userEvent.setup();

    await screen.findByLabelText('What should change?');
    expect(screen.getByRole('button', { name: 'Return' })).toBeDisabled();

    await user.type(screen.getByLabelText('What should change?'), 'Uptime target is too low.');
    await user.click(screen.getByRole('button', { name: 'Return' }));

    await waitFor(() => {
      expect(lastBody('/return')['reason']).toBe('Uptime target is too low.');
    });
  });

  it('carries the flagged goals with the return', async () => {
    serve(routes);

    render_(<ReviewPage />, '/queue/s1');
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Flag for rework'));
    await user.type(screen.getByLabelText('What should change?'), 'Please revise.');
    await user.click(screen.getByRole('button', { name: 'Return' }));

    await waitFor(() => {
      expect(lastBody('/return')['goalIds']).toEqual(['g1']);
    });
  });

  it('says what approving costs, on the button’s own line', async () => {
    serve(routes);

    render_(<ReviewPage />, '/queue/s1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Approve and lock' }));

    expect(screen.getByText(/only progress can be recorded/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/s1/approve'))).toBe(true);
    });
  });

  it('offers no decisions once the sheet is no longer pending', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/review': { ...REVIEW, sheet: { ...REVIEW.sheet, status: 'APPROVED' } },
    });

    render_(<ReviewPage />, '/queue/s1');

    await screen.findByRole('heading', { name: 'Priya' });
    expect(screen.queryByRole('button', { name: 'Approve and lock' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/no longer be approved/i);
  });

  it('explains a sheet it cannot see rather than showing an empty form', async () => {
    serve({ '/cycles': { cycles: [CYCLE] } }, ['/review']);

    render_(<ReviewPage />, '/queue/s1');

    expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
  });
});

describe('RatingPage [W6-11]', () => {
  const routes = { '/cycles': { cycles: [CYCLE] }, '/review': REVIEW, '/appraisals': APPRAISAL };

  it('puts the self-appraisal, the computed score and the history in front of the rating', async () => {
    serve(routes);

    render_(<RatingPage />, '/queue/s1/rating');

    // US-702's acceptance criterion, as three assertions: what they said, what
    // the engine computed, and how the number got there.
    expect(await screen.findByTestId('self-g1')).toHaveTextContent('Landed two large accounts');
    expect(screen.getByTestId('score-g1')).toHaveTextContent('80%');
    expect(screen.getByTestId('rating-check-ins')).toHaveTextContent('Grow ARR: — → 80');
  });

  it('bounds the rating inputs by the cycle’s own scale [US-203]', async () => {
    serve(routes);

    render_(<RatingPage />, '/queue/s1/rating');

    // A 7 on a 1-5 cycle is a number that parses and means nothing.
    const rating = await screen.findByLabelText('Rating (1–5)');
    expect(rating).toHaveAttribute('min', '1');
    expect(rating).toHaveAttribute('max', '5');
  });

  it('demands a justification for every goal and for the overall rating [F-14]', async () => {
    serve(routes);

    render_(<RatingPage />, '/queue/s1/rating');

    const blockers = await screen.findByTestId('rating-blockers');
    expect(blockers).toHaveTextContent('Grow ARR needs a rating.');
    expect(blockers).toHaveTextContent('Grow ARR needs a justification.');
    expect(blockers).toHaveTextContent('Justify the overall rating.');
    expect(screen.getByRole('button', { name: 'Submit rating' })).toBeDisabled();
  });

  it('submits per-goal ratings and the overall one together', async () => {
    serve(routes);

    render_(<RatingPage />, '/queue/s1/rating');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Rating (1–5)'), '4');
    await user.type(screen.getByLabelText('Why this rating?'), 'Beat the target on both counts.');
    await user.type(screen.getByLabelText('Overall rating (1–5)'), '4');
    await user.type(screen.getByLabelText('Justification'), 'A strong year overall.');
    await user.click(screen.getByRole('button', { name: 'Submit rating' }));

    await waitFor(() => {
      const body = lastBody('/rating');
      expect(body['ratings']).toEqual([
        { goalId: 'g1', rating: 4, commentary: 'Beat the target on both counts.' },
      ]);
      expect(body['overallRating']).toBe(4);
    });
  });

  it('refuses to rate before the self-appraisal lands [US-702]', async () => {
    serve({
      ...routes,
      '/appraisals': {
        ...APPRAISAL,
        appraisal: { ...APPRAISAL.appraisal, selfSubmittedAt: null },
      },
    });

    render_(<RatingPage />, '/queue/s1/rating');

    // The server refuses this too. Saying so here means finding out before
    // writing four hundred words.
    expect(await screen.findByText(/self-appraisal has not been submitted/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Rating (1–5)')).toBeDisabled();
  });

  it('says an appraisal already rated goes through calibration next', async () => {
    serve({
      ...routes,
      '/appraisals': {
        ...APPRAISAL,
        appraisal: { ...APPRAISAL.appraisal, managerRating: 4 },
      },
    });

    render_(<RatingPage />, '/queue/s1/rating');

    await screen.findByLabelText('Rating (1–5)');
    expect(screen.getByText(/already submitted a rating/i)).toBeInTheDocument();
  });

  it('explains itself when there is no appraisal to rate', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/review': REVIEW }, ['/appraisals']);

    render_(<RatingPage />, '/queue/s1/rating');

    expect(await screen.findByText(/no appraisal to rate here yet/i)).toBeInTheDocument();
  });
});

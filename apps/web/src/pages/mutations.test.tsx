import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { useAuth } from '../lib/auth-context.js';
import { createQueryClient } from '../lib/query.js';
import { AppraisalPage } from './AppraisalPage.js';
import { CheckInPage } from './CheckInPage.js';
import { GoalsPage } from './GoalsPage.js';

/**
 * W6-06 … W6-08 — what each screen actually sends.
 *
 * Separated from the rendering tests because these assert on the request
 * bodies. A form that looks right and posts the wrong shape is the failure
 * these catch, and it is invisible to a test that only reads the DOM.
 */

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

const sheetWith = (status: string, goals: unknown[]) => ({
  sheet: {
    id: 's1',
    userId: 'u1',
    cycleId: 'cyc1',
    status,
    submittedAt: null,
    approvedAt: null,
    goals,
  },
  score: { score: 0.8, percent: 80 },
});

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

function serve(routes: Readonly<Record<string, unknown>>): void {
  fetchMock.mockImplementation((url: string) => {
    for (const [fragment, body] of Object.entries(routes)) {
      if (String(url).includes(fragment)) {
        return Promise.resolve(json(body));
      }
    }
    return Promise.resolve(json({ ok: true }));
  });
}

const render_ = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

/**
 * The parsed body of the last *writing* call whose URL contains `fragment`.
 *
 * Reads and writes share a URL here -- `PUT /sheets/:cycleId` saves and
 * `GET /sheets/:cycleId` reloads -- and the refetch that follows a successful
 * save is the last call of the two. Taking it blindly parsed `undefined`,
 * which is how this helper failed the first time.
 */
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

describe('GoalsPage sends [W6-06]', () => {
  it('posts the edited goals when a draft is saved', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets/cyc1': sheetWith('DRAFT', [GOAL]) });

    render_(<GoalsPage />);
    const user = userEvent.setup();

    await screen.findByDisplayValue('Grow ARR');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(lastBody('/sheets/cyc1')['goals']).toBeDefined();
    });

    const goals = lastBody('/sheets/cyc1')['goals'] as Record<string, unknown>[];
    // Direction travels explicitly. Nothing downstream infers it from the
    // title, which is what F-06 was.
    expect(goals[0]).toMatchObject({ title: 'Grow ARR', direction: 'HIGHER_IS_BETTER' });
  });

  it('adds and removes goal rows', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets/cyc1': sheetWith('DRAFT', [GOAL]) });

    render_(<GoalsPage />);
    const user = userEvent.setup();

    await screen.findByDisplayValue('Grow ARR');
    await user.click(screen.getByRole('button', { name: 'Add a goal' }));

    expect(screen.getAllByLabelText('Title')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Remove goal 2' }));

    expect(screen.getAllByLabelText('Title')).toHaveLength(1);
  });

  it('changes a direction when the other radio is chosen [F-06]', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets/cyc1': sheetWith('DRAFT', [GOAL]) });

    render_(<GoalsPage />);
    const user = userEvent.setup();

    await screen.findByDisplayValue('Grow ARR');
    await user.click(screen.getByRole('radio', { name: /Lower is better/ }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      const goals = lastBody('/sheets/cyc1')['goals'] as Record<string, unknown>[];
      expect(goals[0]?.['direction']).toBe('LOWER_IS_BETTER');
    });
  });

  it('submits the sheet by id once the blockers clear', async () => {
    const balanced = [
      { ...GOAL, id: 'g1', title: 'A', weightage: 34 },
      { ...GOAL, id: 'g2', title: 'B', weightage: 33 },
      { ...GOAL, id: 'g3', title: 'C', weightage: 33 },
    ];
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets/cyc1': sheetWith('DRAFT', balanced) });

    render_(<GoalsPage />);
    const user = userEvent.setup();

    await screen.findByDisplayValue('A');
    await user.click(screen.getByRole('button', { name: /Submit for approval/ }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/sheets/s1/submit')),
      ).toBe(true);
    });
  });
});

describe('CheckInPage sends [W6-07]', () => {
  it('carries an edited actual and status', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets/cyc1': sheetWith('APPROVED', [GOAL]) });

    render_(<CheckInPage />);
    const user = userEvent.setup();

    const actual = await screen.findByLabelText('Actual achievement');
    await user.clear(actual);
    await user.type(actual, '95');
    await user.selectOptions(screen.getByLabelText('Status'), 'COMPLETED');
    await user.click(screen.getByRole('button', { name: 'Record progress' }));

    await waitFor(() => {
      const updates = lastBody('/check-in')['updates'] as Record<string, unknown>[];
      expect(updates[0]).toEqual({
        goalId: 'g1',
        actualAchievement: '95',
        status: 'COMPLETED',
      });
    });
  });
});

describe('AppraisalPage sends [W6-08]', () => {
  const APPRAISAL = {
    sheetId: 's1',
    scale: { min: 1, max: 5 },
    computedScore: 0.8,
    computedOnScale: 4.2,
    appraisal: null,
    goals: [
      {
        id: 'g1',
        title: 'Grow ARR',
        target: '100',
        actualAchievement: '80',
        weightage: 100,
        computedScore: 0.8,
        selfNarrative: null,
        managerRating: null,
        managerNarrative: null,
      },
    ],
  };

  async function fillAndClick(name: string): Promise<void> {
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/What happened/), 'Landed two accounts.');
    await user.type(screen.getByLabelText('Overall summary'), 'A steady year.');
    await user.click(screen.getByRole('button', { name }));
  }

  it('saves a draft to the PUT endpoint', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/sheets/cyc1': sheetWith('APPROVED', [GOAL]),
      '/appraisals/s1': APPRAISAL,
    });

    render_(<AppraisalPage />);
    await fillAndClick('Save draft');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/appraisals/s1/self') &&
          (init as { method?: string } | undefined)?.method === 'PUT',
      );
      expect(call).toBeDefined();
    });
  });

  it('submits to the separate submit endpoint, which locks it', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/sheets/cyc1': sheetWith('APPROVED', [GOAL]),
      '/appraisals/s1': APPRAISAL,
    });

    render_(<AppraisalPage />);
    await fillAndClick('Submit');

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/self/submit')),
      ).toBe(true);
    });
  });

  it('sends one entry per goal, keyed by id', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/sheets/cyc1': sheetWith('APPROVED', [GOAL]),
      '/appraisals/s1': APPRAISAL,
    });

    render_(<AppraisalPage />);
    await fillAndClick('Save draft');

    await waitFor(() => {
      const entries = lastBody('/appraisals/s1/self')['entries'] as Record<string, unknown>[];
      expect(entries).toEqual([{ goalId: 'g1', commentary: 'Landed two accounts.' }]);
    });
  });
});

describe('signing out [W6-04]', () => {
  function SignOutHarness() {
    const { user, signOut } = useAuth();

    return (
      <div>
        <p>{user === null ? 'signed out' : user.name}</p>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  it('clears the identity even when the request fails', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/auth/logout')
        ? Promise.reject(new TypeError('offline'))
        : Promise.resolve(
            json({
              user: {
                id: 'u1',
                orgId: 'o1',
                name: 'Priya',
                email: 'priya@example.com',
                roles: ['EMPLOYEE'],
                timeZone: 'UTC',
              },
            }),
          ),
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <AuthProvider>
          <SignOutHarness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await screen.findByText('Priya');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    // A person who asked to be signed out should not still see their own
    // dashboard because the network blipped.
    expect(await screen.findByText('signed out')).toBeInTheDocument();
  });
});

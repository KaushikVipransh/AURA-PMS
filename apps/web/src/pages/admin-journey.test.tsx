import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../lib/query.js';
import { CycleSetupPage } from './CycleSetupPage.js';
import { UsersPage } from './UsersPage.js';

/** W6-12, W6-13 — the administration journey. */

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

/**
 * Route each call by URL fragment, **longest fragment first**.
 *
 * `/users/import` contains `/users`, so a first-match-wins router answers the
 * import with the roster — which is how the first run of this file failed, in
 * six tests at once, with `errors` undefined inside the page. Ordering by
 * specificity removes the trap rather than asking every caller to remember it.
 */
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
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

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

describe('CycleSetupPage [W6-12]', () => {
  const CYCLES = {
    cycles: [
      { id: 'c1', name: 'FY25', fiscalYear: 2025, status: 'CLOSED', phases: [] },
      { id: 'c2', name: 'FY26', fiscalYear: 2026, status: 'DRAFT', phases: [] },
    ],
  };

  it('will not create a cycle without a name', async () => {
    serve({ '/cycles': CYCLES });

    render_(<CycleSetupPage />);

    const blockers = await screen.findByTestId('cycle-blockers');
    expect(blockers).toHaveTextContent('Give the cycle a name.');
    expect(screen.getByRole('button', { name: /Create as draft/ })).toBeDisabled();
  });

  it('sends the phases, the scale and the thresholds together', async () => {
    serve({ '/cycles': CYCLES });

    render_(<CycleSetupPage />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'FY27 Annual');
    await user.click(screen.getByRole('button', { name: /Create as draft/ }));

    await waitFor(() => {
      const body = lastBody('/cycles');
      expect(body['name']).toBe('FY27 Annual');
      // The scale travels with the cycle because it is snapshotted onto it —
      // changing it next year must not re-interpret this year's ratings.
      expect(body['ratingScale']).toMatchObject({ min: 1, max: 5 });
      expect(body['escalationRules']).toMatchObject({ manager: 3, skipLevelHr: 7 });
      expect((body['phases'] as unknown[]).length).toBe(5);
    });
  });

  it('relabels every point when the scale is resized', async () => {
    serve({ '/cycles': CYCLES });

    render_(<CycleSetupPage />);
    const user = userEvent.setup();

    const max = await screen.findByLabelText('Points (1 to…)');
    await user.clear(max);
    await user.type(max, '3');

    // Regenerated rather than patched: a scale that grew with unlabelled
    // points is refused by the schema, and stale labels for points that no
    // longer exist are worse.
    expect(screen.getByLabelText('Label for 3')).toBeInTheDocument();
    expect(screen.queryByLabelText('Label for 5')).not.toBeInTheDocument();
  });

  it('names overlapping phases before anybody submits [US-201]', async () => {
    serve({ '/cycles': CYCLES });

    render_(<CycleSetupPage />);
    const user = userEvent.setup();

    // Drag goal setting's end past the start of check-ins.
    const goalEnd = await screen.findByLabelText('To', { selector: '#to-GOAL_SETTING' });
    await user.clear(goalEnd);
    await user.type(goalEnd, '2099-12-31');

    expect(await screen.findByTestId('phase-overlaps')).toHaveTextContent('overlaps');
    expect(screen.getByRole('button', { name: /Create as draft/ })).toBeDisabled();
  });

  it('survives a date field being emptied, and says what is missing', async () => {
    serve({ '/cycles': CYCLES });

    render_(<CycleSetupPage />);
    const user = userEvent.setup();

    await user.clear(await screen.findByLabelText('To', { selector: '#to-GOAL_SETTING' }));

    /*
     * This crashed the page. `findPhaseOverlaps` asserts its inputs are real
     * dates and throws a RangeError otherwise — correct for a domain function,
     * fatal in a render — and an emptied field used to arrive as the string
     * "T00:00:00.000Z". Clearing a date is an ordinary thing to do.
     */
    expect(screen.getByRole('heading', { name: 'Set up a review cycle' })).toBeInTheDocument();
    expect(screen.getByTestId('cycle-blockers')).toHaveTextContent('Goal setting needs dates.');
  });

  it('offers activation only for a draft, and says what it costs', async () => {
    serve({ '/cycles': CYCLES });

    render_(<CycleSetupPage />);

    const list = await screen.findByTestId('cycle-list');
    expect(list).toHaveTextContent('FY26');
    // One button, for the one draft. A closed cycle is not re-openable here.
    expect(screen.getAllByRole('button', { name: 'Activate' })).toHaveLength(1);
  });

  it('activates a draft cycle by id', async () => {
    serve({ '/cycles': CYCLES });

    render_(<CycleSetupPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Activate' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/cycles/c2/activate')),
      ).toBe(true);
    });
  });
});

describe('UsersPage · invite and deactivate [W6-13]', () => {
  const USERS = {
    items: [
      {
        id: 'u1',
        orgId: 'o1',
        name: 'Priya Sharma',
        email: 'priya@example.com',
        roles: ['EMPLOYEE'],
        status: 'ACTIVE',
        managerId: null,
        teamId: null,
        timeZone: 'UTC',
      },
    ],
    nextCursor: null,
  };

  it('lists the organization', async () => {
    serve({ '/users': USERS });

    render_(<UsersPage />);

    expect(await screen.findByTestId('user-table')).toHaveTextContent('priya@example.com');
  });

  it('sends the role and the manager with an invitation [US-101]', async () => {
    serve({ '/users': USERS });

    render_(<UsersPage />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Marcus Chen');
    await user.type(screen.getByLabelText('Email'), 'marcus@example.com');
    await user.selectOptions(screen.getByLabelText('Role'), 'MANAGER');
    await user.selectOptions(screen.getByLabelText('Manager'), 'u1');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => {
      // Set at invite time, so the org chart is right from the first day.
      expect(lastBody('/users/invite')).toMatchObject({
        email: 'marcus@example.com',
        role: 'MANAGER',
        managerId: 'u1',
      });
    });
  });

  it('offers deactivation, never deletion [US-106]', async () => {
    serve({ '/users': USERS });

    render_(<UsersPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/users/u1/deactivate')),
      ).toBe(true);
    });
    // A departing employee's history is what a disputed appraisal is settled
    // from. There is no delete button, here or anywhere.
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});

describe('UsersPage · the CSV import [W6-13, US-205]', () => {
  const USERS = { items: [], nextCursor: null };
  const HEADER = 'name,email,role,managerEmail,teamName';

  const previewOf = (over: Record<string, unknown> = {}) => ({
    dryRun: true,
    created: 2,
    skipped: 0,
    errors: [],
    ...over,
  });

  async function paste(text: string): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Paste the file'));
    await user.paste(text);

    return user;
  }

  it('cannot import before a preview has been run', async () => {
    serve({ '/users': USERS });

    render_(<UsersPage />);
    await paste(`${HEADER}\nA,a@example.com,EMPLOYEE,,`);

    // Nothing is written until somebody has read what would happen.
    expect(screen.getByRole('button', { name: /^Import 0 people$/ })).toBeDisabled();
  });

  it('previews without writing, and says so', async () => {
    serve({ '/users': USERS, '/users/import': previewOf() });

    render_(<UsersPage />);
    const user = await paste(`${HEADER}\nA,a@example.com,EMPLOYEE,,\nB,b@example.com,EMPLOYEE,,`);
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByTestId('import-preview')).toHaveTextContent('2');
    expect(lastBody('/users/import')['dryRun']).toBe(true);
  });

  it('reports row-level errors against the spreadsheet’s own line numbers', async () => {
    serve({
      '/users': USERS,
      '/users/import': previewOf({
        created: 1,
        errors: [{ row: 2, email: 'b@example.com', message: 'Their manager could not be imported.' }],
      }),
    });

    render_(<UsersPage />);
    const user = await paste(`${HEADER}\nA,a@example.com,EMPLOYEE,,\nB,b@example.com,EMPLOYEE,,`);
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const preview = await screen.findByTestId('import-preview');
    // The server counts data rows; the file has a header above them, so data
    // row 2 is line 3 in the spreadsheet somebody is reading beside this.
    expect(preview).toHaveTextContent('3');
    expect(preview).toHaveTextContent('manager could not be imported');
  });

  it('flags lines it could not even read, alongside the server’s findings', async () => {
    serve({ '/users': USERS, '/users/import': previewOf({ created: 1 }) });

    render_(<UsersPage />);
    const user = await paste(`${HEADER}\nA,a@example.com,EMPLOYEE,,\n,b@example.com,EMPLOYEE,,`);
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByTestId('import-preview')).toHaveTextContent('No name on this line');
  });

  it('discards a preview once the file changes', async () => {
    serve({ '/users': USERS, '/users/import': previewOf() });

    render_(<UsersPage />);
    const user = await paste(`${HEADER}\nA,a@example.com,EMPLOYEE,,`);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByTestId('import-preview');

    await user.click(screen.getByLabelText('Paste the file'));
    await user.paste('\nB,b@example.com,EMPLOYEE,,');

    // A preview of a file nobody is importing any more is the most convincing
    // kind of wrong.
    expect(await screen.findByTestId('stale-preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import 0 people$/ })).toBeDisabled();
  });

  it('commits with the same request and the flag flipped', async () => {
    serve({ '/users': USERS, '/users/import': previewOf() });

    render_(<UsersPage />);
    const user = await paste(`${HEADER}\nA,a@example.com,EMPLOYEE,,\nB,b@example.com,EMPLOYEE,,`);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByTestId('import-preview');

    const previewBody = lastBody('/users/import');

    await user.click(screen.getByRole('button', { name: /^Import 2 people$/ }));

    await waitFor(() => {
      const commitBody = lastBody('/users/import');
      expect(commitBody['dryRun']).toBe(false);
      // Same rows, so what the preview described is what was written.
      expect(commitBody['rows']).toEqual(previewBody['rows']);
    });
  });

  it('says which column is missing rather than failing silently', async () => {
    serve({ '/users': USERS });

    render_(<UsersPage />);
    const user = await paste('name,email\nA,a@example.com');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByTestId('csv-error')).toHaveTextContent('role');
    // Never reached the server: there was nothing to ask it.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/import'))).toBe(false);
  });

  it('refuses a file with a header and nothing else', async () => {
    serve({ '/users': USERS });

    render_(<UsersPage />);
    const user = await paste(HEADER);
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByTestId('csv-error')).toHaveTextContent('no rows');
  });

  it('sends a quoted name intact, commas and all', async () => {
    serve({ '/users': USERS, '/users/import': previewOf({ created: 1 }) });

    render_(<UsersPage />);
    const user = await paste(`${HEADER}\n"Sharma, Priya",priya@example.com,EMPLOYEE,,`);
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      const rows = lastBody('/users/import')['rows'] as Record<string, unknown>[];
      // `split(',')` would have shifted every field after this one, producing
      // an import that succeeds and is wrong.
      expect(rows[0]).toMatchObject({ name: 'Sharma, Priya', email: 'priya@example.com' });
    });
  });
});

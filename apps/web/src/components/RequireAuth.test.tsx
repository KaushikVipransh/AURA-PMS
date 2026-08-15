import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { createQueryClient } from '../lib/query.js';
import { RequireAuth } from './RequireAuth.js';

/** W6-04 — the guard, and the client half of F-01. */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = (user: unknown): Response =>
  new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const EMPLOYEE = {
  id: 'u1',
  orgId: 'o1',
  name: 'Priya',
  email: 'priya@example.com',
  roles: ['EMPLOYEE'],
  timeZone: 'UTC',
};

function renderAt(path: string, roles?: readonly string[]) {
  /* A fresh client per render, so one test's cached session cannot answer the
     next one's question. */
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>Sign in</p>} />
          <Route path="/" element={<p>Home</p>} />
          <Route
            path="/secret"
            element={
              <RequireAuth {...(roles === undefined ? {} : { roles: roles as never })}>
                <p>Secret</p>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('RequireAuth', () => {
  it('lets a signed-in user through', async () => {
    fetchMock.mockResolvedValue(session(EMPLOYEE));

    renderAt('/secret');

    expect(await screen.findByText('Secret')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to the login page', async () => {
    fetchMock.mockResolvedValue(session(null));

    renderAt('/secret');

    expect(await screen.findByText('Sign in')).toBeInTheDocument();
  });

  it('waits for the session check rather than bouncing on a refresh', async () => {
    // A guard that redirected while the cookie was still being resolved would
    // send every signed-in user to the login page on every hard refresh.
    let resolve: ((value: Response) => void) | undefined;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { resolve = r; }));

    renderAt('/secret');

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();

    resolve?.(session(EMPLOYEE));
    expect(await screen.findByText('Secret')).toBeInTheDocument();
  });

  it('refuses a role the user does not hold', async () => {
    fetchMock.mockResolvedValue(session(EMPLOYEE));

    renderAt('/secret', ['ORG_ADMIN']);

    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('admits a user who holds one of several roles', async () => {
    fetchMock.mockResolvedValue(
      session({ ...EMPLOYEE, roles: ['EMPLOYEE', 'HR_ADMIN'] }),
    );

    // An HR administrator is usually also an employee with their own sheet,
    // which the prototype's single-string role could not express.
    renderAt('/secret', ['HR_ADMIN']);

    expect(await screen.findByText('Secret')).toBeInTheDocument();
  });

  it('grants nothing on the strength of localStorage', async () => {
    /*
     * The F-01 regression test. The prototype's guard read exactly this key
     * and compared it to a role name, so this line was a complete
     * authentication bypass.
     */
    window.localStorage.setItem('atomquest_role', 'admin');
    fetchMock.mockResolvedValue(session(null));

    renderAt('/secret', ['ORG_ADMIN']);

    expect(await screen.findByText('Sign in')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();

    window.localStorage.clear();
  });

  it('treats a failed session check as signed out', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    // "I do not know who you are" is the safe reading of every failure here.
    renderAt('/secret');

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });
  });
});

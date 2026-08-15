import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { createQueryClient } from '../lib/query.js';
import { LoginPage } from './LoginPage.js';
import { Placeholder } from './Placeholder.js';

/** W6-04, W6-05 — signing in, and how a failure is reported. */

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

const USER = {
  id: 'u1',
  orgId: 'o1',
  name: 'Priya',
  email: 'priya@example.com',
  roles: ['EMPLOYEE'],
  timeZone: 'UTC',
};

function renderLogin(state?: { from: string }) {
  /* A fresh client per render, so one test's cached session cannot answer the
     next one's question. */
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
      <MemoryRouter
        initialEntries={[{ pathname: '/login', ...(state === undefined ? {} : { state }) }]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Home</p>} />
          <Route path="/goals" element={<Placeholder title="My goals" task="W6-06" />} />
        </Routes>
      </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  it('labels both fields, so the form is usable without sight', async () => {
    fetchMock.mockResolvedValue(json({ user: null }));

    renderLogin();

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('signs in and lands on the home page', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ user: null }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValue(json({ user: USER }));

    renderLogin();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'priya@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('returns to the page the visitor was trying to reach', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ user: null }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValue(json({ user: USER }));

    // A guard that always lands on the dashboard loses the link somebody sent
    // you, which is the whole reason the path travels in router state.
    renderLogin({ from: '/goals' });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'priya@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('My goals')).toBeInTheDocument();
  });

  it('gives one message for a wrong password and an unknown address', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ user: null }))
      .mockResolvedValue(json({ error: 'Invalid credentials' }, 401));

    renderLogin();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-entirely');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    /*
     * Distinguishing the two would turn this form into an account oracle:
     * "does bob@rival.example have an account here" answered by a login
     * attempt. The server refuses to distinguish them either (US-103).
     */
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That email and password do not match an account.');
    expect(alert.textContent).not.toMatch(/no such user|unknown email|wrong password/i);
  });

  it('associates the failure with the fields for a screen reader', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ user: null }))
      .mockResolvedValue(json({ error: 'Invalid credentials' }, 401));

    renderLogin();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'nope-nope-nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    });
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', 'signin-error');
  });

  it('reports a server fault differently from bad credentials', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ user: null }))
      .mockResolvedValue(json({ error: 'Internal server error' }, 500));

    renderLogin();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Telling someone their password is wrong when the database is down sends
    // them to reset a password that was never the problem.
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed. Please try again.');
  });

  it('sends an already-signed-in visitor straight through', async () => {
    fetchMock.mockResolvedValue(json({ user: USER }));

    renderLogin();

    expect(await screen.findByText('Home')).toBeInTheDocument();
  });
});

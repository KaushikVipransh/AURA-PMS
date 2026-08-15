/**
 * Sign in (W6-04).
 *
 * The page this replaces had three buttons — "Login as Employee", "Login as
 * Manager", "Login as Admin" — each of which wrote a string into
 * `localStorage` and navigated. There was no password, no server call, and no
 * account: the role *was* the credential (PLAN.md F-01).
 */

import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { ApiRequestError } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

export function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const returnTo = (location.state as { from?: string } | null)?.from ?? '/';

  if (!loading && user !== null) {
    return <Navigate to={returnTo} replace />;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signIn(email, password);
      await navigate(returnTo, { replace: true });
    } catch (cause) {
      /*
       * One message for a wrong password and an unknown address.
       *
       * Distinguishing them would turn this form into an account oracle:
       * "does bob@rival.example have an account here" answered by a login
       * attempt. The server refuses to distinguish them either (US-103).
       */
      const message =
        cause instanceof ApiRequestError && cause.status === 401
          ? 'That email and password do not match an account.'
          : 'Sign-in failed. Please try again.';

      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Sign in to AuraPMS</h1>

      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => { setEmail(event.target.value); }}
            /* Described by the error when there is one, so a screen reader
               announces the reason rather than only the field name. */
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : 'signin-error'}
            className="rounded border px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => { setPassword(event.target.value); }}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : 'signin-error'}
            className="rounded border px-3 py-2"
          />
        </div>

        {error !== null && (
          <p id="signin-error" role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

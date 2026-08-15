/**
 * The one way this app talks to the server (W6-02).
 *
 * **Replaces twenty hardcoded `https://aurapms-backend.vercel.app/...` string
 * literals** scattered through four page components (PLAN.md F-12). Each was a
 * separate decision about a base URL, a header set and an error shape, and
 * they disagreed: some parsed JSON before checking the status, some ignored the
 * status entirely, none sent credentials. One client means one answer to each
 * of those questions.
 *
 * The base URL comes from the environment. A build for staging and a build for
 * production differ by a variable rather than by a commit, and — more to the
 * point — nobody can ship a page that talks to a stranger's server because they
 * copied a fetch call.
 */

import type { ApiError } from '@aura/contracts';

/**
 * Where the API lives.
 *
 * Defaults to a same-origin `/api` prefix, which is what a reverse proxy in
 * front of both apps gives you. An absolute default pointing anywhere real
 * would be the F-12 problem again with one URL instead of twenty.
 */
export const API_BASE_URL: string =
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

/** A failure the server described. Carries the status so callers can branch. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** Per-field messages, for a form to render inline rather than in a toast. */
  readonly fields: Readonly<Record<string, readonly string[]>> | undefined;
  readonly detail: readonly string[] | undefined;

  constructor(
    status: number,
    message: string,
    options: {
      code?: string | undefined;
      fields?: Readonly<Record<string, readonly string[]>> | undefined;
      detail?: readonly string[] | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = options.code;
    this.fields = options.fields;
    this.detail = options.detail;
  }

  /** Whether this is the server saying "sign in", rather than "you may not". */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/** Raised when the request never reached a server at all. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The server could not be reached.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

type RequestOptions = {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly signal?: AbortSignal;
};

/**
 * Listeners for an unauthenticated response.
 *
 * A module-level set rather than a React context, because the interceptor has
 * to work for calls made outside a component tree — a query prefetch, a
 * background refetch — and a hook cannot reach those.
 */
const unauthenticatedListeners = new Set<() => void>();

/** Register a handler for 401s. Returns a function that removes it. */
export function onUnauthenticated(listener: () => void): () => void {
  unauthenticatedListeners.add(listener);

  return () => {
    unauthenticatedListeners.delete(listener);
  };
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path}`;

  if (query === undefined) {
    return url;
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    // Omitted rather than sent as the string "undefined", which is what a
    // template-literal query string does and what the prototype's did.
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  const search = params.toString();

  return search === '' ? url : `${url}?${search}`;
}

/** Read the server's error shape, falling back to something honest. */
async function toError(response: Response): Promise<ApiRequestError> {
  let body: Partial<ApiError> & { code?: string; detail?: string[] } = {};

  try {
    body = (await response.json()) as typeof body;
  } catch {
    /* A non-JSON error body is a proxy or a crash, not the API. Falling
       through leaves the status-derived message below, which is the honest
       thing to show. */
  }

  return new ApiRequestError(
    response.status,
    body.error ?? `Request failed with status ${String(response.status)}`,
    {
      code: body.code,
      fields: body.fields,
      detail: body.detail,
    },
  );
}

/**
 * Make a request.
 *
 * `credentials: 'include'` on every call, because the session is an httpOnly
 * cookie — which is the point of W3-01. A token in `localStorage` would be
 * readable by any script on the page, and the prototype's identity model was
 * exactly that (F-01).
 *
 * The status is checked **before** the body is parsed. The prototype's pages
 * did the reverse in several places, so a 500 with an HTML error page threw a
 * JSON parse error and the user saw "Unexpected token <".
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';

  let response: Response;

  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: 'include',
      headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause) {
    // A DNS failure and a 500 are different problems with different fixes, and
    // collapsing them into one message sends people to the wrong place.
    throw new NetworkError(cause);
  }

  if (response.status === 401) {
    for (const listener of unauthenticatedListeners) {
      listener();
    }
  }

  if (!response.ok) {
    throw await toError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** The verbs, so a call site reads as what it does. */
export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal): Promise<T> =>
    request<T>(path, { method: 'GET', ...(query === undefined ? {} : { query }), ...(signal === undefined ? {} : { signal }) }),

  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: body ?? {} }),

  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PUT', body: body ?? {} }),

  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: body ?? {} }),

  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
} as const;

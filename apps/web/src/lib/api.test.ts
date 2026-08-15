import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, NetworkError, api, onUnauthenticated, request } from './api.js';

/** W6-02 — the one client. */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('request', () => {
  it('sends credentials on every call', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await request('/me');

    // The session is an httpOnly cookie. Without this the browser sends
    // nothing and every guarded route answers 401.
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('omits undefined query parameters rather than sending the string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await api.get('/sheets', { cycleId: 'c1', status: undefined });

    // A template literal would have produced `status=undefined`, which the
    // server then tries to parse as a status.
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('cycleId=c1');
    expect(url).not.toContain('undefined');
  });

  it('sends no query string at all when there are no parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await api.get('/teams', {});

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('?');
  });

  it('checks the status before parsing the body', async () => {
    // An HTML error page from a proxy. The prototype parsed first, so the user
    // saw "Unexpected token <" instead of what went wrong.
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(request('/me')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(request('/me')).rejects.toThrow(/502/);
  });

  it('carries the server message, code and field errors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'That sheet is already APPROVED.', code: 'NOT_DRAFT', detail: ['a', 'b'] },
        409,
      ),
    );

    try {
      await request('/sheets/1/submit');
      expect.unreachable('should have thrown');
    } catch (error) {
      const failure = error as ApiRequestError;
      expect(failure.status).toBe(409);
      expect(failure.code).toBe('NOT_DRAFT');
      expect(failure.detail).toEqual(['a', 'b']);
    }
  });

  it('distinguishes a network failure from a server error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    // A DNS failure and a 500 are different problems with different fixes.
    await expect(request('/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('returns undefined for a 204 rather than trying to parse it', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(request('/things/1')).resolves.toBeUndefined();
  });

  it('sets a JSON content type only when there is a body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await api.get('/me');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: {} });

    fetchMock.mockResolvedValue(jsonResponse({}));
    await api.post('/auth/login', { email: 'a@b.com' });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { 'content-type': 'application/json' },
    });
  });

  it('marks a 401 as unauthenticated rather than merely failed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthenticated' }, 401));

    try {
      await request('/me');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiRequestError).isUnauthenticated).toBe(true);
    }
  });

  it('does not treat a 403 as a session problem', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Forbidden' }, 403));

    try {
      await request('/cycles');
      expect.unreachable('should have thrown');
    } catch (error) {
      // "You may not" is not "sign in again", and redirecting on a 403 would
      // sign people out for opening the wrong page.
      expect((error as ApiRequestError).isUnauthenticated).toBe(false);
    }
  });
});

describe('the unauthenticated interceptor', () => {
  it('notifies listeners on a 401', async () => {
    const listener = vi.fn();
    const remove = onUnauthenticated(listener);

    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthenticated' }, 401));
    await request('/me').catch(() => undefined);

    expect(listener).toHaveBeenCalledOnce();
    remove();
  });

  it('stops notifying once removed', async () => {
    const listener = vi.fn();
    onUnauthenticated(listener)();

    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthenticated' }, 401));
    await request('/me').catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not fire on a successful response', async () => {
    const listener = vi.fn();
    const remove = onUnauthenticated(listener);

    fetchMock.mockResolvedValue(jsonResponse({ user: null }));
    await request('/auth/session');

    expect(listener).not.toHaveBeenCalled();
    remove();
  });
});

describe('the verbs', () => {
  it.each([
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
    ['delete', 'DELETE'],
  ] as const)('%s issues a %s', async (verb, method) => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await (api[verb] as (path: string) => Promise<unknown>)('/things');

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method });
  });
});

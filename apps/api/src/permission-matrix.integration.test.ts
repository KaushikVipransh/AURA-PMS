import request from 'supertest';
import { describe, expect, it } from 'vitest';


import { ROUTER_MOUNTS, createApp } from './app.js';
import { listRoutes, type RouteRef } from './routes/introspect.js';

/**
 * W3-09 — every registered route, enumerated from the Express router at
 * runtime and checked against a declared expectation.
 *
 * The point is not the assertions on the routes that exist today. It is that
 * **a new route with no entry in this file fails the build**. A permission
 * test that lists routes by hand goes stale the first time someone adds one,
 * and goes stale silently, which is the failure mode that matters: the suite
 * still passes, and the new endpoint is the unguarded one.
 */

const app = createApp();

/** How a route is expected to answer an unauthenticated request. */
type Expectation = {
  /** `guarded`: must answer 401. `public`: deliberately open. */
  readonly access: 'guarded' | 'public';
  /** Why, for the routes that are open on purpose. */
  readonly reason?: string;
};

/**
 * The declared surface. One entry per route, keyed `METHOD path`.
 *
 * Adding a route without adding a line here fails `covers every registered
 * route`, which is the only assertion in this file that cannot rot.
 */
const EXPECTED: Readonly<Record<string, Expectation>> = {
  /*
   * The auth library's own mounted surface, registered with `app.all` and so
   * appearing once per verb. Public by necessity: sign-in and the callbacks
   * that establish a session are reached by definition without one. Its own
   * handlers do the authorisation, which is why the boundary in W3-02 keeps
   * that library in one place where it can be reasoned about.
   */
  'GET /api/auth/*splat': { access: 'public', reason: 'Auth library routes; it authorises internally.' },
  'POST /api/auth/*splat': { access: 'public', reason: 'Auth library routes; it authorises internally.' },
  'PUT /api/auth/*splat': { access: 'public', reason: 'Auth library routes; it authorises internally.' },
  'PATCH /api/auth/*splat': { access: 'public', reason: 'Auth library routes; it authorises internally.' },
  'DELETE /api/auth/*splat': { access: 'public', reason: 'Auth library routes; it authorises internally.' },

  'GET /healthz': {
    access: 'public',
    reason: 'Liveness probe. Reveals nothing and must work before anyone signs in.',
  },

  'GET /openapi.json': {
    access: 'public',
    reason:
      'Describes the shape of requests, not the data in them. Every endpoint it names is ' +
      'guarded whether or not it is written down, which this file asserts independently.',
  },
  'GET /docs': { access: 'public', reason: 'Renders the document above; holds nothing itself.' },

  'POST /auth/signup': {
    access: 'public',
    reason: 'Creates the first account of a new organization; there is nobody to authenticate as yet.',
  },
  'POST /auth/login': { access: 'public', reason: 'The endpoint that establishes a session.' },
  'POST /auth/forgot': {
    access: 'public',
    reason: 'Reached precisely by someone who cannot sign in. Always answers 202 (US-103).',
  },
  'POST /auth/reset': {
    access: 'public',
    reason: 'Authenticated by the emailed token, not by a session.',
  },
  'POST /auth/logout': {
    access: 'public',
    reason: 'Idempotent and safe without a session: a caller asking to be signed out is obliged.',
  },
  'GET /auth/session': { access: 'guarded' },

  'GET /me': { access: 'guarded' },

  'GET /cycles': { access: 'guarded' },
  'POST /cycles': { access: 'guarded' },
  'PATCH /cycles/:id': { access: 'guarded' },
  'POST /cycles/:id/activate': { access: 'guarded' },
  'POST /cycles/:id/close': { access: 'guarded' },

  'GET /sheets/:cycleId': { access: 'guarded' },
  'PUT /sheets/:cycleId': { access: 'guarded' },
  'POST /sheets/:id/submit': { access: 'guarded' },
  'POST /sheets/:id/check-in': { access: 'guarded' },
  'POST /sheets/:id/approve': { access: 'guarded' },
  'POST /sheets/:id/return': { access: 'guarded' },
  'POST /sheets/:id/adjust': { access: 'guarded' },
  'GET /sheets/:id/revisions': { access: 'guarded' },
  'GET /sheets/:id/review': { access: 'guarded' },

  'GET /notifications': { access: 'guarded' },
  'POST /notifications/read': { access: 'guarded' },

  'GET /queue': { access: 'guarded' },

  'GET /sheets/:sheetId/comments': { access: 'guarded' },
  'POST /sheets/:sheetId/comments': { access: 'guarded' },
  'PATCH /sheets/:sheetId/comments/:commentId': { access: 'guarded' },
  'DELETE /sheets/:sheetId/comments/:commentId': { access: 'guarded' },

  'POST /users/invite': { access: 'guarded' },
  'GET /users': { access: 'guarded' },
  'POST /users/import': { access: 'guarded' },
  'GET /users/:id': { access: 'guarded' },
  'POST /users/:id/deactivate': { access: 'guarded' },

  'GET /teams': { access: 'guarded' },
  'POST /teams': { access: 'guarded' },
  'GET /teams/:id': { access: 'guarded' },

  'GET /org-chart': { access: 'guarded' },
  'GET /org-chart/:userId/chain': { access: 'guarded' },

  'GET /shared-goals': { access: 'guarded' },
  'POST /shared-goals': { access: 'guarded' },
  'POST /shared-goals/preview': { access: 'guarded' },

  'GET /appraisals/:sheetId': { access: 'guarded' },
  'PUT /appraisals/:sheetId/self': { access: 'guarded' },
  'POST /appraisals/:sheetId/self/submit': { access: 'guarded' },
  'POST /appraisals/:sheetId/rating': { access: 'guarded' },
  'POST /appraisals/:sheetId/acknowledge': { access: 'guarded' },

  'GET /calibration': { access: 'guarded' },
  'POST /calibration/adjust': { access: 'guarded' },
  'POST /calibration/release': { access: 'guarded' },

  'GET /analytics': { access: 'guarded' },
  'GET /compliance': { access: 'guarded' },
  'GET /escalations': { access: 'guarded' },
  'POST /escalations/:id/resolve': { access: 'guarded' },
  'GET /audit': { access: 'guarded' },
};

/** A representative request for a route, with its parameters filled in. */
function sampleRequest(route: RouteRef) {
  const path = route.path
    .replace(/:(\w+)/g, 'clw0000000000000000000000')
    .replace(/\*\w+/g, 'get-session');
  const agent = request(app);

  switch (route.method) {
    case 'GET':
      return agent.get(path);
    case 'PUT':
      return agent.put(path).send({});
    case 'PATCH':
      return agent.patch(path).send({});
    case 'DELETE':
      return agent.delete(path);
    default:
      return agent.post(path).send({});
  }
}

const routes = listRoutes(app, ROUTER_MOUNTS);
const key = (route: RouteRef): string => `${route.method} ${route.path}`;

describe('the route surface is fully declared', () => {
  it('finds routes at all, so an empty enumeration cannot pass vacuously', () => {
    // Without this, a broken `listRoutes` would make every other assertion
    // here trivially true -- the classic way a matrix test stops testing.
    expect(routes.length).toBeGreaterThanOrEqual(55);
  });

  it('covers every registered route', () => {
    const undeclared = routes.map(key).filter((k) => !(k in EXPECTED));

    expect(
      undeclared,
      'A route was added without an entry in EXPECTED. Add one, choosing ' +
        '`guarded` or `public` deliberately -- a route nobody classified is a ' +
        'route nobody checked.',
    ).toEqual([]);
  });

  it('has no stale entries for routes that no longer exist', () => {
    const live = new Set(routes.map(key));
    const stale = Object.keys(EXPECTED).filter((k) => !live.has(k));

    expect(stale).toEqual([]);
  });

  it('gives a reason for every route that is open on purpose', () => {
    for (const [name, expectation] of Object.entries(EXPECTED)) {
      if (expectation.access === 'public') {
        expect(expectation.reason, `${name} is public with no reason given`).toBeTruthy();
      }
    }
  });
});

describe('guarded routes refuse an unauthenticated request', () => {
  const guarded = routes.filter((route) => EXPECTED[key(route)]?.access === 'guarded');

  it('there are some, so this block is not vacuous', () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  it.each(guarded.map((route) => [key(route), route] as const))(
    '%s answers 401 with no session',
    async (_name, route) => {
      const response = await sampleRequest(route);

      expect(response.status).toBe(401);
    },
  );

  it.each(guarded.map((route) => [key(route), route] as const))(
    '%s leaks no data in its refusal',
    async (_name, route) => {
      const response = await sampleRequest(route);
      const body = JSON.stringify(response.body);

      // A 401 body should say that and nothing else -- no record, no hint that
      // the id exists, no stack.
      expect(body).toBe(JSON.stringify({ error: 'Unauthenticated' }));
    },
  );
});

describe('public routes are reachable without a session', () => {
  const open = routes.filter((route) => EXPECTED[key(route)]?.access === 'public');

  it.each(open.map((route) => [key(route), route] as const))(
    '%s never demands a session',
    async (_name, route) => {
      const response = await sampleRequest(route);

      /*
       * Asserted on the body, not the status.
       *
       * "Not 401" is the wrong test: `POST /auth/login` answers 401 for an
       * empty body, correctly — that is a credentials failure, not a session
       * requirement, and the first version of this assertion failed on it. The
       * distinction that matters is *why*, and the two are distinguishable
       * because only the session guard says `Unauthenticated`.
       */
      expect(JSON.stringify(response.body)).not.toContain('Unauthenticated');
    },
  );
});

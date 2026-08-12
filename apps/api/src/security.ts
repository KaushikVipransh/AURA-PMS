/**
 * The middleware that runs before anything interesting (PRD §9).
 *
 * Each piece here replaces something the prototype did not have at all. The
 * API was deployed with `cors()` and no authentication, which meant any page on
 * the internet could read and write the whole database from a visitor's browser
 * (PLAN.md F-01).
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import helmet, { type HelmetOptions } from 'helmet';
import type { RequestHandler } from 'express';

/**
 * Response headers.
 *
 * This is a JSON API with no HTML surface of its own, so the interesting parts
 * are the ones that matter when a browser is tricked into treating a response
 * as something else: `nosniff`, a frame denial, and a CSP that permits nothing.
 */
const HELMET_OPTIONS: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  /* The SPA is served from a different origin and needs to read these
     responses; COEP would break that for no gain on a JSON API. */
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
};

export function securityHeaders(): RequestHandler {
  return helmet(HELMET_OPTIONS);
}

/**
 * Ten attempts per fifteen minutes, per address, on the credential endpoints.
 *
 * Rate limiting is the only thing standing between a leaked password list and
 * an account, because a correct password is indistinguishable from a guessed
 * one. Applied to `/auth/*` specifically: the same limit on read endpoints
 * would break an ordinary dashboard.
 *
 * **Known limitation.** This uses the library's default in-memory store, so the
 * count is per process. With more than one API instance the effective limit is
 * ten times the instance count, and a restart resets it. The task specified a
 * Postgres store; the package it named does not exist on npm under that name,
 * and adopting an unvetted alternative for a security control is worse than
 * shipping a documented gap. Recorded in TASKS.md as an item for W7, where the
 * deployment topology is decided and a shared store can be chosen against a
 * real instance count.
 */
export function authRateLimit(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    /* Counts failures and successes alike. Only counting failures lets an
       attacker who guesses correctly keep going, which is precisely the moment
       the limit should still apply. */
    skipSuccessfulRequests: false,
    message: { error: 'Too many attempts. Try again later.' },
    /* Disabled in tests: the suite makes far more than ten auth calls, and a
       limiter that fires mid-suite would fail unrelated assertions in ways
       that look like auth bugs. The limiter has its own tests, which enable it
       deliberately. */
    skip: () => process.env['NODE_ENV'] === 'test' && process.env['RATE_LIMIT_IN_TEST'] !== 'on',
  });
}

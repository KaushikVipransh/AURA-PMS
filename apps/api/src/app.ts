/**
 * The Express application, as a value.
 *
 * Built by a function rather than at module scope so tests can construct one
 * without starting a listener, and so the CORS allowlist is read per-app rather
 * than frozen at import time.
 *
 * This replaces `server.js`, the prototype's transitional 501 shell. What it
 * deliberately does not carry over is recorded there and in PLAN.md: an open
 * `cors()` with no allowlist and no authentication at all (F-01), a hardcoded
 * `employeeId: 'emp-123'` (F-02), a module-level `GLOBAL_ACTIVE_PERIOD` whose
 * setter rewrote every sheet ever created (F-03), and a check-in route that
 * trusted the client's whole payload against a locked sheet (F-04).
 */

import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { authRoutes } from './auth/index.js';
import { authRouter } from './routes/auth.js';
import { cyclesRouter, meRouter } from './routes/cycles.js';
import { sharedGoalsRouter } from './routes/sharedGoals.js';
import { sheetsRouter } from './routes/sheets.js';
import { orgChartRouter, teamsRouter } from './routes/teams.js';
import { usersRouter } from './routes/users.js';
import { authRateLimit, securityHeaders } from './security.js';

/**
 * Origins allowed to send credentialed requests.
 *
 * An explicit allowlist from the environment. The prototype's bare `cors()`
 * emitted `Access-Control-Allow-Origin: *`, which made every endpoint readable
 * and writable from any page on the internet — and with no authentication
 * behind it, that was the whole database (F-01).
 */
function allowedOrigins(): string[] {
  return (process.env['CORS_ORIGINS'] ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Where each router is mounted.
 *
 * Declared as data so route introspection (W3-09) can recover a route's full
 * path. Express 5 compiles a mount path into an opaque matcher function and
 * keeps no copy of the original string, so the prefix cannot be read back off
 * the layer — but the router object itself can be matched by identity, which
 * is stable across versions in a way that walking internals is not.
 *
 * Mounting *from* this list rather than alongside it is what keeps the two
 * from drifting: there is no second place to add a router.
 */
export const ROUTER_MOUNTS = [
  { prefix: '/auth', router: authRouter },
  { prefix: '/users', router: usersRouter },
  { prefix: '/me', router: meRouter },
  { prefix: '/cycles', router: cyclesRouter },
  { prefix: '/sheets', router: sheetsRouter },
  { prefix: '/teams', router: teamsRouter },
  { prefix: '/org-chart', router: orgChartRouter },
  { prefix: '/shared-goals', router: sharedGoalsRouter },
] as const;

export function createApp(): Express {
  const app = express();

  /* Trusts exactly one proxy hop. Required for the rate limiter to see a real
     client address behind Railway's load balancer, and deliberately not
     `true` -- trusting every hop lets a client spoof X-Forwarded-For and give
     itself a fresh rate-limit bucket per request. */
  app.set('trust proxy', 1);

  app.use(securityHeaders());
  app.use(cors({ origin: allowedOrigins(), credentials: true }));

  /* Before the routers, so a flood is refused without touching the database. */
  app.use('/auth', authRateLimit());
  app.use('/api/auth', authRateLimit());

  /*
   * The auth library's own routes are mounted BEFORE the JSON body parser.
   * Its handler reads the raw request stream, and a parser that has already
   * consumed the body leaves it with nothing to read — a failure that presents
   * as a hang rather than an error.
   */
  app.all('/api/auth/*splat', authRoutes);

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  for (const mount of ROUTER_MOUNTS) {
    app.use(mount.prefix, mount.router);
  }

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found', path: req.path });
  });

  /*
   * Nothing about the error reaches the client.
   *
   * A stack trace or a database message names table columns, file paths and
   * library versions — a free reconnaissance report. It is logged server-side
   * in W7; here it is simply not sent.
   */
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    /* Silent in tests so a suite asserting a 500 does not print a stack, but
       `DEBUG_ERRORS=on` brings it back -- an error handler that hides the
       cause makes every 500 look identical while you are trying to find one. */
    if (process.env['NODE_ENV'] !== 'test' || process.env['DEBUG_ERRORS'] === 'on') {
      console.error(error);
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

/**
 * AuraPMS API — transitional shell.
 *
 * The Mongoose implementation was removed in W1-14. Every route below is a
 * deliberate 501 stub, rewritten in TypeScript against Prisma across Waves 3
 * and 4. Nothing here talks to a database.
 *
 * Keeping the shell rather than deleting the file outright means the route
 * surface stays visible and reviewable while it is replaced endpoint by
 * endpoint, and `apps/web` keeps something to point at until W6-02 swaps in the
 * generated client.
 *
 * What is NOT carried over, on purpose — see PLAN.md:
 *   F-01  open `cors()` with no allowlist and no authentication at all
 *   F-02  a hardcoded `employeeId: 'emp-123'` / `employeeName: 'Vipransh Kaushik'`
 *   F-03  `GLOBAL_ACTIVE_PERIOD`, and a period switch that ran
 *         `updateMany({}, { $set: { quarter } })` across every historical sheet
 *   F-04  a check-in route that trusted the client's whole payload on a locked sheet
 *   F-08  an escalation engine that floored overdue days at four
 */

dotenv.config();

const app = express();

// Explicit allowlist. The prototype's bare `cors()` made every endpoint
// writable from any origin (F-01).
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', phase: 'wave-1' });
});

/** Routes land in Waves 3-4. Until then this is honest about its state. */
app.use('/api', (req, res) => {
  res.status(501).json({
    error: 'Not implemented',
    detail:
      'The MongoDB implementation was removed in W1-14. This endpoint is rewritten ' +
      'against Prisma in Waves 3-4. See TASKS.md.',
    path: req.path,
  });
});

if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT ?? 5000;
  app.listen(port, () => {
    console.warn(`AuraPMS API (transitional shell) listening on http://localhost:${port}`);
  });
}

export default app;

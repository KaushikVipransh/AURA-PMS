/**
 * The job queue (W5-01).
 *
 * pg-boss, backed by the same Postgres the rest of the system uses. Not Redis,
 * not SQS: a job that enqueues in one transaction with the change that caused
 * it cannot be orphaned by a rollback, and that property is the whole reason
 * `withAudit` puts the audit row inside the transaction too. A second datastore
 * would put the queue outside every transaction in the codebase.
 *
 * **This is the half of F-08 that made the prototype's escalations fiction.**
 * That engine ran only when an admin clicked a button, and its "notification
 * chain" wrote a status string onto a document — nothing was ever sent to
 * anyone. A worker on a schedule is what makes "the system acts on its own"
 * true rather than aspirational.
 */

import { PgBoss, type QueueOptions } from 'pg-boss';

/** Every queue this worker knows about, named once. */
export const QUEUES = {
  /** Nightly sweep for missed deadlines (W5-02). */
  escalationSweep: 'escalation.sweep',
  /** One notification, rendered and delivered (W5-04). */
  notificationDispatch: 'notification.dispatch',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * How many connections pg-boss may hold.
 *
 * Small and explicit. The worker's own Prisma pool is separate (see below), so
 * this process holds two pools against a database whose connection limit is
 * the thing that falls over first under load.
 */
const POOL_SIZE = 4;

/**
 * Build a pg-boss instance with its own connection pool.
 *
 * **Sharing the Prisma pool was tried first and does not work.** pg-boss ships
 * `fromPrisma`, which hands it the Prisma client as a SQL executor, and it
 * fails on the very first query: the installation check selects
 * `to_regclass(...)`, and Prisma cannot deserialize a `regclass` column —
 * "Failed to deserialize column of type 'regclass'". There is no way to cast
 * it from this side, because the SQL belongs to pg-boss. So the queue gets its
 * own bounded pool, and the cost is stated rather than hidden.
 *
 * `schema` keeps pg-boss's tables out of `public`, where the Prisma migrations
 * live. Sharing a schema would make `prisma migrate diff` see tables it does
 * not know about and offer to drop them.
 */
export function createBoss(connectionString: string = requireDatabaseUrl()): PgBoss {
  return new PgBoss({ connectionString, schema: 'pgboss', max: POOL_SIZE });
}

/** The database URL, or a startup failure that says which variable is missing. */
function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];

  if (url === undefined || url === '') {
    // Thrown at startup rather than defaulted. A worker pointed at the wrong
    // database is worse than one that refuses to start.
    throw new Error('DATABASE_URL is required for the job queue.');
  }

  return url;
}

/**
 * How long a finished job stays readable.
 *
 * Retention is a per-queue setting in pg-boss v12, not a constructor one. Kept
 * generous on purpose: "did the nightly sweep run on the 3rd, and what did it
 * decide" is a question a compliance dashboard has to be able to answer, and a
 * deleted row cannot.
 */
const RETENTION: QueueOptions = {
  retentionSeconds: 60 * 60 * 24 * 30,
  /* Two retries with backoff. A sweep that failed because the database was
     briefly unreachable should not wait a day for its next attempt, and one
     that fails three times is a real defect that retrying will not fix. */
  retryLimit: 2,
  retryBackoff: true,
};

/**
 * Declare every queue before anything sends to one.
 *
 * pg-boss v12 requires a queue to exist before a job can be enqueued, and
 * doing it here — from the same list the handlers register against — means a
 * new queue cannot be half-wired: there is one place to add it.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, RETENTION);
  }
}

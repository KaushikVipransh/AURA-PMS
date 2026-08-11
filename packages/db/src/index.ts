/**
 * @aura/db — Prisma schema, generated client, migrations, and seed data.
 *
 * Exports a lazily-constructed singleton PrismaClient. The org-scoping client
 * extension (W3-06) wraps this so every query filters by the actor's
 * organization, which is the structural fix for PLAN.md F-02.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { pino } from 'pino';

import { PrismaClient } from '../generated/prisma/client.js';

export * from '../generated/prisma/enums.js';
export { PrismaClient } from '../generated/prisma/client.js';

const logger = pino({
  name: '@aura/db',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

function createPrismaClient(): PrismaClient {
  const connectionString = process.env['DATABASE_URL'];

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env — see the README quick start.',
    );
  }

  // Prisma 7 connects through a driver adapter rather than a `url` in the
  // schema. The adapter owns the connection pool, which is what makes a
  // long-lived API process the right shape for this app (TECH_STACK.md §11).
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });

  logger.debug('Prisma client initialised');

  return client;
}

/**
 * Reuse one client across hot reloads. Without this, every reload under `tsx
 * watch` opens a fresh pool and Postgres eventually refuses connections.
 */
const globalForPrisma = globalThis as unknown as { auraPrisma?: PrismaClient };

let client: PrismaClient | undefined;

/** Construct on first use, then reuse. */
export function getPrisma(): PrismaClient {
  client ??= globalForPrisma.auraPrisma ?? createPrismaClient();

  if (process.env['NODE_ENV'] !== 'production') {
    globalForPrisma.auraPrisma = client;
  }

  return client;
}

/**
 * The client, as a property-access-triggered lazy proxy.
 *
 * Construction is deferred deliberately. An eager singleton means that merely
 * importing an enum or a type from this package opens a database connection,
 * which breaks every consumer that has no database — unit tests in
 * `packages/core`, the contract schemas, and CI jobs that only typecheck.
 * Callers still get the plain `prisma.user.findMany()` ergonomics.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = getPrisma();
    const value: unknown = Reflect.get(instance, property);

    // Bind methods back to the real client; an unbound `this` breaks Prisma's
    // internals in ways that surface far from here.
    if (typeof value === 'function') {
      return (value as (...args: never[]) => unknown).bind(instance);
    }

    return value;
  },
});

/** Close the pool. Used by test teardown and graceful shutdown. */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
    delete globalForPrisma.auraPrisma;
  }
}

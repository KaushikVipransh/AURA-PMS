import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Test-side database helpers.
 *
 * Not exported from the package root — importing this pulls in test-only
 * behaviour that has no business in application code.
 */

/**
 * The transactional client handed to a test body.
 *
 * This is exactly what Prisma passes to a `$transaction` callback: the full
 * client minus the connection- and extension-level methods that make no sense
 * inside an open transaction. Hand-rolling a different Omit here fails to
 * assign, so keep it aligned with Prisma's own shape.
 */
export type TestDb = Omit<
  PrismaClient,
  '$on' | '$connect' | '$disconnect' | '$extends' | '$use'
>;

let testClient: PrismaClient | undefined;

function connectionString(): string {
  const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];

  if (!url) {
    throw new Error(
      'No test database. Integration tests must run under vitest.integration.config.ts, ' +
        'which starts one via global setup.',
    );
  }

  return url;
}

/** Shared client against the disposable container. */
export function testPrisma(): PrismaClient {
  testClient ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString() }),
  });

  return testClient;
}

/**
 * Sentinel used to unwind the transaction. Never escapes this module.
 *
 * An Error subclass rather than a Symbol: throwing a non-Error loses the stack
 * trace, so if this ever does escape it is diagnosable rather than a bare
 * `Symbol()` in the logs.
 */
class RollbackSignal extends Error {
  constructor() {
    super('aura.test.rollback');
    this.name = 'RollbackSignal';
  }
}

/**
 * Run `body` inside a transaction that is always rolled back.
 *
 * Isolation without truncation: every test sees a pristine database, tests can
 * run in any order, and nothing leaks between them. Note that `body` must use
 * the `tx` handed to it — writes through the ambient `prisma` singleton fall
 * outside the transaction and will not be undone.
 */
export async function withTestDb<T>(body: (tx: TestDb) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let captured = false;

  try {
    await testPrisma().$transaction(async (tx) => {
      result = await body(tx);
      captured = true;
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }

  if (!captured) {
    throw new Error('withTestDb: transaction unwound before the body completed.');
  }

  return result as T;
}

/** Close the pool. Called from vitest teardown. */
export async function closeTestDb(): Promise<void> {
  if (testClient) {
    await testClient.$disconnect();
    testClient = undefined;
  }
}

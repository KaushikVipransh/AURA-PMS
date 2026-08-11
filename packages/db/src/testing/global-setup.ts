import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Vitest global setup for integration tests.
 *
 * Starts a disposable Postgres, applies the real migrations to it, and hands
 * the connection string to the test workers. Tests therefore run against
 * genuine constraints — unique indexes, foreign keys, enum types — rather than
 * a mock.
 *
 * That matters here specifically. The prototype's most dangerous defects were
 * persistence-layer defects: a destructive `updateMany` (PLAN.md F-03), an
 * unvalidated overwrite of a locked sheet (F-04), and a cascade that bypassed
 * every weightage rule (F-05). A mocked client cannot catch any of them.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('aurapms_test')
    .withUsername('aura')
    .withPassword('aura_test')
    .start();

  const url = container.getConnectionUri();

  // Workers read this; see vitest.integration.config.ts.
  process.env['DATABASE_URL'] = url;
  process.env['TEST_DATABASE_URL'] = url;

  // `migrate deploy`, not `db push` — this exercises the same migration files
  // that run in production, so a broken migration fails here rather than on
  // deploy.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

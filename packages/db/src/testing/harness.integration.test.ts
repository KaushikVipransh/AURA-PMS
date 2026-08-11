import { afterAll, describe, expect, it } from 'vitest';

import { closeTestDb, testPrisma, withTestDb } from './index.js';

/** Proves the harness itself works before any model relies on it. */
describe('integration harness', () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it('runs against a real Postgres with the real migrations applied', async () => {
    const rows = await testPrisma().$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at`;

    // `migrate deploy` ran, so the same migration files that reach production
    // are what these tests execute against.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.migration_name.endsWith('_init'))).toBe(true);
  });

  it('has the shared enum types as real Postgres types', async () => {
    const rows = await testPrisma().$queryRaw<{ typname: string }[]>`
      SELECT typname FROM pg_type WHERE typname IN ('Role', 'GoalDirection', 'Uom')
    `;

    expect(rows.map((r) => r.typname).sort()).toStrictEqual([
      'GoalDirection',
      'Role',
      'Uom',
    ]);
  });

  it('rolls back everything a test writes', async () => {
    await withTestDb(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE harness_probe (id int primary key)`);
      await tx.$executeRawUnsafe(`INSERT INTO harness_probe VALUES (1)`);

      const inside = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM harness_probe`,
      );
      expect(Number(inside[0]?.n)).toBe(1);
    });

    // Outside the transaction the table must not exist at all. If this ever
    // starts passing by finding an empty table, isolation has silently broken.
    const leaked = await testPrisma().$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'harness_probe'
      ) AS exists
    `;

    expect(leaked[0]?.exists).toBe(false);
  });

  it('propagates real failures instead of swallowing them as rollbacks', async () => {
    await expect(withTestDb(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});

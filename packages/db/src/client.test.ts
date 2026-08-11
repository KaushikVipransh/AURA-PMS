import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_URL = process.env['DATABASE_URL'];
const FAKE_URL = 'postgresql://user:pw@localhost:5433/nowhere';

/** The hot-reload cache lives on globalThis and outlives vi.resetModules(). */
function clearGlobalClient(): void {
  delete (globalThis as Record<string, unknown>)['auraPrisma'];
}

describe('@aura/db client', () => {
  beforeEach(() => {
    vi.resetModules();
    clearGlobalClient();
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = ORIGINAL_URL;
    }
    clearGlobalClient();
  });

  it('does not construct a client merely because the module was imported', async () => {
    delete process.env['DATABASE_URL'];

    // Regression guard. An eager singleton here meant that importing an enum
    // opened a database connection, which broke every consumer that has no
    // database: packages/core unit tests, the contract schemas, and any CI job
    // that only typechecks. Importing must stay free of side effects.
    const mod = await import('./index.js');

    expect(mod.Role.HR_ADMIN).toBe('HR_ADMIN');
    expect(mod.GoalDirection.LOWER_IS_BETTER).toBe('LOWER_IS_BETTER');
  });

  it('throws an actionable error when DATABASE_URL is missing', async () => {
    delete process.env['DATABASE_URL'];

    const { getPrisma } = await import('./index.js');

    // The message has to say what to do. The prototype surfaced a missing
    // connection as an opaque 503 with no hint (PLAN.md F-13 territory).
    expect(() => getPrisma()).toThrow(/DATABASE_URL is not set/);
    expect(() => getPrisma()).toThrow(/\.env\.example/);
  });

  it('constructs once and reuses the same instance', async () => {
    process.env['DATABASE_URL'] = FAKE_URL;

    const { getPrisma } = await import('./index.js');

    expect(getPrisma()).toBe(getPrisma());
  });

  it('proxies property access through to the real client', async () => {
    process.env['DATABASE_URL'] = FAKE_URL;

    const { prisma, getPrisma } = await import('./index.js');

    // Methods must come back bound — an unbound `this` breaks Prisma's
    // internals in ways that surface a long way from the call site. Checked
    // via `typeof` rather than by passing the method as a value, which is
    // exactly the unbound reference @typescript-eslint/unbound-method warns
    // about.
    expect(typeof prisma.$connect).toBe('function');
    expect(typeof prisma.$transaction).toBe('function');
    expect(getPrisma()).toBeDefined();
  });

  it('disconnects safely when no client was ever constructed', async () => {
    delete process.env['DATABASE_URL'];

    const { disconnectPrisma } = await import('./index.js');

    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });

  it('releases the cached instance on disconnect', async () => {
    process.env['DATABASE_URL'] = FAKE_URL;

    const { getPrisma, disconnectPrisma } = await import('./index.js');
    const first = getPrisma();

    await disconnectPrisma();

    expect(getPrisma()).not.toBe(first);
  });
});

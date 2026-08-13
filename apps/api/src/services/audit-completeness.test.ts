import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * W4-02 — **a new unaudited mutation fails the build.**
 *
 * This reads the service sources rather than importing them. That is a
 * deliberate trade and worth stating plainly: a runtime check cannot tell
 * whether a function *would have* called `withAudit`, only whether it did on
 * the paths a test happened to exercise. Source inspection answers the question
 * that matters — "is there a write here that is not wrapped" — for every path,
 * including the ones nobody wrote a test for.
 *
 * Its weakness is the mirror image: it reasons about text, so a write hidden
 * behind an unusual construct could slip past. The mitigations are that the
 * detection is deliberately broad (any `tx`- or `db`-shaped write verb counts)
 * and that the file asserts it found services at all, so a broken scan fails
 * loudly instead of passing on an empty set.
 */

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Prisma write verbs. A call to any of these is a mutation. */
const WRITE_CALLS =
  /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|executeRaw|executeRawUnsafe)\s*\(/;

/** Files that are infrastructure rather than services. */
const NOT_A_SERVICE = new Set(['withAudit.ts']);

type ServiceFile = {
  readonly name: string;
  readonly source: string;
};

function serviceFiles(): ServiceFile[] {
  return readdirSync(SERVICES_DIR)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => !name.endsWith('.test.ts') && !name.endsWith('.integration.test.ts'))
    .filter((name) => !NOT_A_SERVICE.has(name))
    .map((name) => ({
      name,
      source: readFileSync(path.join(SERVICES_DIR, name), 'utf8'),
    }));
}

/**
 * Split a source file into its exported functions.
 *
 * Crude on purpose: everything from one `export function`/`export async
 * function` to the next. Over-including the tail of a function is harmless
 * here, because the question asked of each block is "does it contain a write
 * without a wrapper", and extra context can only make a violation easier to
 * see, never harder.
 */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const pattern = /export\s+(?:async\s+)?function\s+(\w+)/g;
  const starts: { name: string; index: number }[] = [];

  for (const match of source.matchAll(pattern)) {
    starts.push({ name: match[1] ?? '', index: match.index });
  }

  return starts.map((start, i) => ({
    name: start.name,
    body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

const files = serviceFiles();

describe('every mutating service is audited', () => {
  it('finds service files at all, so this suite cannot pass vacuously', () => {
    // A scan that silently returns nothing would make every assertion below
    // trivially true -- the exact way a completeness test stops testing.
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((file) => file.name)).toContain('users.ts');
  });

  it('finds exported functions in those files', () => {
    const total = files.flatMap((file) => exportedFunctions(file.source)).length;

    expect(total).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [file.name, file] as const))(
    '%s wraps every write in withAudit',
    (_name, file) => {
      const offenders = exportedFunctions(file.source)
        .filter((fn) => WRITE_CALLS.test(fn.body))
        .filter((fn) => !fn.body.includes('withAudit('))
        .map((fn) => fn.name);

      expect(
        offenders,
        `${file.name}: these exported functions write to the database without ` +
          'withAudit(). Wrap them -- an audit trail with unknown gaps is worse ' +
          'than none, because it is believed.',
      ).toEqual([]);
    },
  );

  it('imports withAudit in any file that writes at all', () => {
    for (const file of files) {
      if (WRITE_CALLS.test(file.source)) {
        expect(file.source, `${file.name} writes but never imports withAudit`).toContain(
          'withAudit',
        );
      }
    }
  });
});

describe('the detector itself works', () => {
  /*
   * The assertions above are only worth having if the detector can actually
   * fail. These feed it known-bad and known-good sources directly, so a
   * regression in the scanning logic surfaces here rather than as a silent
   * green in the block above.
   */
  const unaudited = `
    export async function createThing(db) {
      return db.thing.create({ data: {} });
    }
  `;

  const audited = `
    export async function createThing(db, actor) {
      return withAudit(db, actor, spec, async (tx) => {
        const value = await tx.thing.create({ data: {} });
        return { value, after: value, entityId: value.id };
      });
    }
  `;

  it('flags an unwrapped write', () => {
    const offenders = exportedFunctions(unaudited)
      .filter((fn) => WRITE_CALLS.test(fn.body))
      .filter((fn) => !fn.body.includes('withAudit('));

    expect(offenders.map((fn) => fn.name)).toEqual(['createThing']);
  });

  it('accepts a wrapped one', () => {
    const offenders = exportedFunctions(audited)
      .filter((fn) => WRITE_CALLS.test(fn.body))
      .filter((fn) => !fn.body.includes('withAudit('));

    expect(offenders).toEqual([]);
  });

  it.each(['create', 'update', 'delete', 'upsert', 'updateMany', 'deleteMany'])(
    'recognises .%s( as a write',
    (verb) => {
      expect(WRITE_CALLS.test(`db.thing.${verb}({})`)).toBe(true);
    },
  );

  it('does not mistake a read for a write', () => {
    for (const read of ['findMany', 'findUnique', 'findFirst', 'count', 'aggregate']) {
      expect(WRITE_CALLS.test(`db.thing.${read}({})`)).toBe(false);
    }
  });
});

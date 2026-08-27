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
/**
 * A write, recognised by Prisma's shape rather than by verb alone.
 *
 * `<client>.<model>.<verb>(` — two dots — is what every model write in this
 * codebase looks like, and requiring both is what tells `tx.user.delete(...)`
 * from `candidates.delete(...)` on a plain `Map`. The verb-only version of
 * this pattern flagged `planImport`, a pure function that touches no database
 * at all, which is the false positive that makes people start adding
 * exceptions to a completeness test — and an exception list is how it stops
 * being one.
 *
 * The raw escapes are matched separately: they hang directly off the client
 * and so have only one dot.
 */
const WRITE_CALLS =
  /\.\w+\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(|\.\$executeRaw(Unsafe)?\s*\(/;

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

type Fn = { name: string; body: string; exported: boolean };

/**
 * Split a source file into its top-level functions, exported or not.
 *
 * **Splitting on every declaration rather than only exported ones is the whole
 * accuracy of this test**, and the first version got it wrong. It sliced from
 * one `export function` to the next, so a private helper was attributed to
 * whichever export happened to precede it — and `readAppraisal`, a function
 * that writes nothing, was reported as an unaudited mutation because the
 * private `ensureAppraisal` sat below it in the file. A checker that names the
 * wrong function teaches people to reorder code until it goes quiet, which is
 * worse than one that misses things.
 *
 * Anchored to the start of a line, so a nested closure stays part of its
 * parent rather than becoming a block of its own.
 */
function functionsIn(source: string): Fn[] {
  const pattern = /^(export\s+)?(?:async\s+)?function\s+(\w+)/gm;
  const starts: { name: string; index: number; exported: boolean }[] = [];

  for (const match of source.matchAll(pattern)) {
    starts.push({
      name: match[2] ?? '',
      index: match.index,
      exported: match[1] !== undefined,
    });
  }

  return starts.map((start, i) => ({
    name: start.name,
    exported: start.exported,
    body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

/**
 * The functions that would let a write reach the database unaudited.
 *
 * Two ways that happens, and both are checked:
 *
 *   1. An **exported** function writes in its own body without `withAudit`.
 *      It is callable from a router, a job or a script, so its writes are
 *      reachable directly.
 *   2. A **private** helper writes, and some exported function calls it from
 *      outside a `withAudit` wrapper. The helper cannot be called from another
 *      module, so the only way its writes escape the transaction is through an
 *      unwrapped export in the same file.
 *
 * The second rule is what the first version of this file lacked, and it is
 * strictly stronger: `ensureAppraisal` writing inside `withAudit` is fine,
 * and the same helper called from an unwrapped reader is not.
 */
function offendersIn(source: string): string[] {
  const functions = functionsIn(source);
  const writesDirectly = (fn: Fn): boolean => WRITE_CALLS.test(fn.body);
  const wrapped = (fn: Fn): boolean => fn.body.includes('withAudit(');

  const dangerousHelpers = functions
    .filter((fn) => !fn.exported && writesDirectly(fn))
    .map((fn) => fn.name);

  return functions
    .filter((fn) => fn.exported)
    .filter(
      (fn) =>
        !wrapped(fn) &&
        (writesDirectly(fn) ||
          dangerousHelpers.some((helper) => new RegExp(`\\b${helper}\\s*\\(`).test(fn.body))),
    )
    .map((fn) => fn.name);
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
    const total = files.flatMap((file) => functionsIn(file.source)).filter((fn) => fn.exported)
      .length;

    expect(total).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [file.name, file] as const))(
    '%s wraps every write in withAudit',
    (_name, file) => {
      expect(
        offendersIn(file.source),
        `${file.name}: these exported functions write to the database without ` +
          'withAudit(), directly or through a private helper. Wrap them -- an ' +
          'audit trail with unknown gaps is worse than none, because it is believed.',
      ).toEqual([]);
    },
  );

  it.each(files.map((file) => [file.name, file] as const))(
    '%s is actually parsed, so its result is not a vacuous pass',
    (_name, file) => {
      // A file whose writes live only in arrow functions would yield no
      // blocks, and `offendersIn` would report nothing for the best possible
      // reason and the worst possible cause.
      if (WRITE_CALLS.test(file.source)) {
        expect(functionsIn(file.source).length).toBeGreaterThan(0);
      }
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
  /*
   * Flush left, deliberately. The splitter anchors declarations to the start
   * of a line so that a nested closure stays part of its parent, which means
   * an indented fixture would parse as no functions at all -- and every
   * assertion below would pass on an empty set. This is the shape of the
   * vacuous-green failure the block above guards against, one level down.
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
    expect(offendersIn(unaudited)).toEqual(['createThing']);
  });

  it('flags an unwrapped raw escape, which has only one dot', () => {
    expect(
      offendersIn(`
export async function wipe(db) {
  return db.$executeRawUnsafe('DELETE FROM things');
}
`),
    ).toEqual(['wipe']);
  });

  it('does not mistake a Map or a Set for a table', () => {
    /*
     * `planImport` is a pure planner that deletes from a `Map` of candidate
     * rows. Under the verb-only pattern it was reported as an unaudited
     * writer — and the tempting fix, an exception list, is how a completeness
     * test stops being one.
     */
    expect(
      offendersIn(`
export function planRows(rows) {
  const candidates = new Map();
  const seen = new Set();

  candidates.delete('a');
  seen.delete('b');
  rows.forEach((row) => candidates.set(row.id, row));

  return [...candidates.values()];
}
`),
    ).toEqual([]);
  });

  it('accepts a wrapped one', () => {
    expect(offendersIn(audited)).toEqual([]);
  });

  /*
   * The attribution cases. These are the ones the first version of this file
   * got wrong, in both directions: it blamed a reader for a helper it never
   * called, and it would have missed a helper called from an unwrapped export.
   */
  const readerAboveAWritingHelper = `
export async function readThing(db) {
  return db.thing.findMany();
}

async function saveThing(tx) {
  return tx.thing.create({ data: {} });
}

export async function writeThing(db, actor) {
  return withAudit(db, actor, spec, async (tx) => saveThing(tx));
}
`;

  const helperCalledFromAnUnwrappedExport = `
async function saveThing(tx) {
  return tx.thing.create({ data: {} });
}

export async function readThing(db) {
  await saveThing(db);
  return db.thing.findMany();
}
`;

  it('does not blame a reader for a helper that sits below it', () => {
    // `readThing` writes nothing and calls nothing that writes. Reporting it
    // teaches people to shuffle declarations until the checker goes quiet.
    expect(offendersIn(readerAboveAWritingHelper)).toEqual([]);
  });

  it('flags an export that reaches a writing helper outside a wrapper', () => {
    // The helper is private, so this unwrapped export is the only way its
    // write escapes the transaction -- which is exactly the gap to catch.
    expect(offendersIn(helperCalledFromAnUnwrappedExport)).toEqual(['readThing']);
  });

  it('does not mistake a mention of the helper name for a call', () => {
    const mentionsOnly = `
async function saveThing(tx) {
  return tx.thing.create({ data: {} });
}

export async function readThing(db) {
  // saveThing is documented here and not called.
  return db.thing.findMany();
}
`;

    expect(offendersIn(mentionsOnly)).toEqual([]);
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

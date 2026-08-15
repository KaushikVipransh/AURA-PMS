import { describe, expect, it } from 'vitest';

/**
 * W6-02, W6-04, W6-05 — **the prototype's client-side habits cannot come back.**
 *
 * Three greps, as a test. Each corresponds to a finding in PLAN.md, and each
 * would otherwise be re-introduced by one copied line in one new component:
 *
 *   - F-12: twenty hardcoded `aurapms-backend.vercel.app` URLs.
 *   - F-01: identity read from `localStorage`.
 *   - F-14: failures reported through `alert()`.
 *
 * **Comments are stripped before searching.** The explanations of what was
 * removed and why are worth keeping — they are the only record of the
 * reasoning — and a check that could not tell prose from code would force
 * their deletion to stay green. Testing the code is the point; testing the
 * prose would just make the codebase quieter about its own history.
 */

/*
 * Sources are read through Vite's raw glob rather than `node:fs`.
 *
 * Not incidental: pulling in `node:fs` means adding `node` to this app's
 * `types`, which makes `process`, `Buffer` and `__dirname` typecheck inside
 * components. A browser app that compiles Node globals is one import away from
 * shipping a runtime error that TypeScript approved of.
 */
const sources = import.meta.glob('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Remove block comments, line comments and JSX comment expressions. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const files = Object.entries<string>(sources)
  .filter(([name]) => !/\.test\.tsx?$/.test(name))
  .map(([name, code]) => ({
    name: name.replace(/^\.{0,2}\/?(src\/)?/, ''),
    code: stripComments(code),
  }));

describe('the comment stripper', () => {
  it('removes a block comment', () => {
    expect(stripComments('/* alert(1) */ const a = 1;')).not.toContain('alert(');
  });

  it('removes a line comment', () => {
    expect(stripComments('  // alert(1)\nconst a = 1;')).not.toContain('alert(');
  });

  it('leaves real code alone', () => {
    // Without this the suite would pass by stripping everything, which is the
    // way a source-scanning test stops testing.
    expect(stripComments('const a = alert(1);')).toContain('alert(');
  });
});

describe('the prototype client is gone', () => {
  it('finds source files at all, so these assertions are not vacuous', () => {
    expect(files.length).toBeGreaterThan(4);
    expect(files.map((file) => file.name)).toContain('lib/api.ts');
  });

  it('has no hardcoded backend URL anywhere [F-12]', () => {
    const offenders = files.filter((file) => file.code.includes('aurapms-backend'));

    expect(offenders.map((file) => file.name)).toEqual([]);
  });

  it('reaches no absolute http URL outside the configured base [F-12]', () => {
    // A different hardcoded host would be the same mistake with a new name.
    const offenders = files.filter((file) => /fetch\(\s*['"`]https?:/.test(file.code));

    expect(offenders.map((file) => file.name)).toEqual([]);
  });

  it('never reads identity from localStorage [F-01]', () => {
    const offenders = files.filter((file) => /\blocalStorage\b/.test(file.code));

    expect(
      offenders.map((file) => file.name),
      'Identity comes from the server session, not from client storage. ' +
        'The prototype compared a localStorage string to a role name, so anyone ' +
        'could type themselves into an admin.',
    ).toEqual([]);
  });

  it('never calls alert() [F-14]', () => {
    const offenders = files.filter((file) => /(^|[^.\w])alert\s*\(/.test(file.code));

    expect(
      offenders.map((file) => file.name),
      'Failures are reported through toasts and inline field errors. `alert()` ' +
        'blocks the main thread, cannot be styled or stacked, and says nothing ' +
        'a screen reader can associate with the field that caused it.',
    ).toEqual([]);
  });

  it('calls fetch in exactly one place', () => {
    const callers = files.filter((file) => /\bfetch\s*\(/.test(file.code));

    // One client means one answer to "what base URL, what headers, does it
    // send credentials, and what happens on a non-2xx".
    expect(callers.map((file) => file.name)).toEqual(['lib/api.ts']);
  });
});

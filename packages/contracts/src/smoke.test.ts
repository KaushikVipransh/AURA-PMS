import { describe, expect, it } from 'vitest';

import * as pkg from './index.js';

/* Placeholder so the runner has work before real suites land. Delete once this
   package has genuine tests. */
describe('@aura/contracts', () => {
  it('is wired into the test runner and exports a module', () => {
    expect(pkg).toBeTypeOf('object');
  });
});

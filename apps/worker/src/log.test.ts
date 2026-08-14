import { afterEach, describe, expect, it, vi } from 'vitest';

import { log } from './log.js';

/** The one place the worker is allowed to reach `console`, so it is tested. */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('log', () => {
  it('prefixes every line so worker output is greppable in a shared stream', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    log.info('started');

    expect(info).toHaveBeenCalledWith('[worker] started');
  });

  it('passes detail through as a second argument rather than stringifying it', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const detail = { raised: 3 };

    log.info('escalation sweep', detail);

    // Interpolating it would flatten an object to "[object Object]", which is
    // the shape of a log line that looks informative and carries nothing.
    expect(info).toHaveBeenCalledWith('[worker] escalation sweep', detail);
  });

  it('sends errors to console.error, not to the info stream', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    log.error('shutdown failed', new Error('nope'));

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toBe('[worker] shutdown failed');
  });

  it('omits the detail argument entirely when there is none', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    log.error('bare');

    // `undefined` as a trailing argument prints "undefined" in most consoles.
    expect(error).toHaveBeenCalledWith('[worker] bare');
  });
});

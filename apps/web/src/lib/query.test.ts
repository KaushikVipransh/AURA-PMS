import { describe, expect, it } from 'vitest';

import { ApiRequestError, NetworkError } from './api.js';
import { describeError, shouldRetry } from './query.js';

/** W6-03 — the retry policy and the message people actually see. */

describe('shouldRetry', () => {
  it('retries a network failure', () => {
    expect(shouldRetry(0, new NetworkError(new Error('offline')))).toBe(true);
  });

  it('retries a server error', () => {
    expect(shouldRetry(0, new ApiRequestError(503, 'Unavailable'))).toBe(true);
  });

  it('does not retry a validation failure', () => {
    // Retrying a 400 sends the same invalid body three more times and delays
    // the message that would have told the user what to fix.
    expect(shouldRetry(0, new ApiRequestError(400, 'Bad request'))).toBe(false);
  });

  it('does not retry a refusal', () => {
    expect(shouldRetry(0, new ApiRequestError(403, 'Forbidden'))).toBe(false);
  });

  it('does not retry a missing record', () => {
    expect(shouldRetry(0, new ApiRequestError(404, 'Not found'))).toBe(false);
  });

  it('gives up after two attempts', () => {
    expect(shouldRetry(2, new NetworkError(new Error('offline')))).toBe(false);
  });

  it('does not retry something it cannot classify', () => {
    expect(shouldRetry(0, new Error('who knows'))).toBe(false);
  });
});

describe('describeError', () => {
  it('uses the server message when there is one', () => {
    expect(describeError(new ApiRequestError(409, 'That sheet is already APPROVED.'))).toBe(
      'That sheet is already APPROVED.',
    );
  });

  it('says the server was unreachable rather than showing a stack', () => {
    expect(describeError(new NetworkError(new Error('ECONNREFUSED')))).toContain(
      'could not be reached',
    );
  });

  it('falls back without leaking an internal message', () => {
    // A raw exception string names files and libraries. It belongs in a log,
    // not in a toast.
    expect(describeError(new Error('Cannot read properties of undefined'))).toBe(
      'Something went wrong.',
    );
  });
});

/**
 * Operational logging for the worker.
 *
 * A worker with no output is a worker nobody can tell is alive, and "did the
 * nightly sweep run" is the first question anyone asks of it — so startup,
 * shutdown and per-job results are informational events worth emitting, not
 * warnings.
 *
 * The `no-console` rule permits only `warn` and `error`, which is right for
 * request-handling code where a stray `log` becomes noise in a hot path. This
 * module is the one documented exception, in one place, so the rule keeps
 * working everywhere else — and so W7's structured logger has a single seam to
 * replace rather than a dozen call sites to find.
 */

/* eslint-disable no-console */

export type Logger = {
  info(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
};

const emit =
  (level: 'info' | 'error') =>
  (message: string, detail?: unknown): void => {
    const line = `[worker] ${message}`;

    if (detail === undefined) {
      console[level](line);
      return;
    }
    console[level](line, detail);
  };

export const log: Logger = {
  info: emit('info'),
  error: emit('error'),
};

/**
 * Where outbound email goes.
 *
 * A seam, not an implementation. W5 installs the Resend transport here; until
 * then the default writes to the log so a developer can follow a reset link
 * without a mail account, and the integration suite installs a capturing one.
 *
 * The alternative — reading the token out of the `verification` table in tests
 * — was rejected: it couples the test to how the auth library happens to store
 * tokens today, and it would keep passing if the email were never sent at all.
 * Capturing at the transport asserts the thing that actually matters, which is
 * that a message went out with a usable token in it.
 */

export type OutboundEmail = {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** Structured extras — the reset token and URL, for the dev log and tests. */
  readonly meta?: Readonly<Record<string, string>>;
};

export type Mailer = {
  send(email: OutboundEmail): Promise<void>;
};

/**
 * The default. Logs and discards.
 *
 * `console.warn` rather than `console.log` because the lint config permits it,
 * and because an email that was not really sent deserves to look like a
 * warning in a log someone is reading.
 */
const loggingMailer: Mailer = {
  send(email: OutboundEmail): Promise<void> {
    if (process.env['NODE_ENV'] !== 'test') {
      console.warn(`[mail] to=${email.to} subject=${email.subject}`, email.meta ?? {});
    }
    return Promise.resolve();
  },
};

let current: Mailer = loggingMailer;

/** Install a transport. W5 calls this with Resend; tests call it with a spy. */
export function setMailer(mailer: Mailer): void {
  current = mailer;
}

/** Restore the logging default. */
export function resetMailer(): void {
  current = loggingMailer;
}

export function getMailer(): Mailer {
  return current;
}

/**
 * The email adapter (W5-03).
 *
 * An interface with two implementations and a default that **cannot send**.
 * That default is the point: a test suite that could reach a real provider is
 * one bad environment variable away from emailing four hundred employees about
 * a seeded cycle, and no assertion protects against that after the fact.
 *
 * The live implementation is chosen only when a key is present, so sending is
 * something an environment opts into rather than something a test has to
 * remember to opt out of.
 */

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly link: string;
};

export type EmailResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string };

export type EmailAdapter = {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailResult>;
};

/**
 * The default. Records nothing, sends nothing, and reports success.
 *
 * Reporting success rather than failure is deliberate: a development or test
 * environment with no mail provider has not *failed* to deliver, and marking
 * every notification `FAILED` would make the delivery log (US-1203) useless
 * exactly where it is read most.
 */
export const noopEmailAdapter: EmailAdapter = {
  name: 'noop',
  send: () => Promise.resolve({ ok: true, id: 'noop' }),
};

/** Wrap a message body and its link into the HTML actually sent. */
export function renderEmailHtml(message: EmailMessage): string {
  const escape = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  /*
   * Escaped, because a notification body carries user-supplied text -- a
   * returned-sheet reason is typed by a manager, and a shared-goal title by
   * whoever created it. Interpolating either into HTML unescaped is stored
   * XSS with an email client as the sink.
   */
  return [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">',
    `<h2 style="margin:0 0 12px">${escape(message.subject)}</h2>`,
    `<p style="margin:0 0 16px">${escape(message.body)}</p>`,
    `<p><a href="${escape(message.link)}">Open in AuraPMS</a></p>`,
    '</body></html>',
  ].join('');
}

/**
 * Resend, over its REST API.
 *
 * `fetch` rather than the SDK: this is one POST, and a dependency that exists
 * to make one POST is a dependency to keep patched forever.
 */
export function resendAdapter(apiKey: string, from: string): EmailAdapter {
  return {
    name: 'resend',
    async send(message) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: message.to,
            subject: message.subject,
            html: renderEmailHtml(message),
          }),
        });

        if (!response.ok) {
          // The provider's message, not a stack. It is what says whether the
          // address bounced or the key expired.
          return { ok: false, reason: `Resend responded ${String(response.status)}` };
        }

        const body = (await response.json()) as { id?: string };

        return { ok: true, id: body.id ?? 'unknown' };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
  };
}

/**
 * The adapter this process should use.
 *
 * Reads the environment at call time rather than at import, so a test can set
 * and unset the variable around a case without module-cache games.
 */
export function emailAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): EmailAdapter {
  const apiKey = env['RESEND_API_KEY'];
  const from = env['EMAIL_FROM'];

  if (apiKey === undefined || apiKey === '' || from === undefined || from === '') {
    return noopEmailAdapter;
  }

  return resendAdapter(apiKey, from);
}

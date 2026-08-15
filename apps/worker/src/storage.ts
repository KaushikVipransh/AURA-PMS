/**
 * Object storage for generated exports (W5-05).
 *
 * The same shape as the email adapter and for the same reason: an interface,
 * an R2 implementation, and a **default that cannot reach the network**. An
 * export contains every goal, rating and comment in a cycle, so a test suite
 * that could write one to a real bucket is a data leak waiting for a
 * misconfigured environment.
 *
 * The in-memory adapter is not a stub for the tests' convenience — it is what
 * makes "assert the stored object is correctly quoted" possible at all. The
 * bytes are the thing under test, and a real upload would put them somewhere
 * the assertion cannot see.
 */

import { createHmac } from 'node:crypto';

export type StoredObject = {
  readonly key: string;
  readonly body: string;
  readonly contentType: string;
};

export type StorageAdapter = {
  readonly name: string;
  put(object: StoredObject): Promise<void>;
  /** A time-limited URL. Exports are not public objects. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
};

/**
 * An adapter that keeps objects in memory.
 *
 * `objects` is exposed so a test can read back exactly what was written. That
 * is the whole reason this exists: US-1002's acceptance criteria are about the
 * *contents* of the stored file — RFC 4180 quoting and formula neutralization
 * — and those cannot be asserted through a signed URL.
 */
export function memoryStorage(): StorageAdapter & { readonly objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();

  return {
    name: 'memory',
    objects,
    put: (object) => {
      objects.set(object.key, object);
      return Promise.resolve();
    },
    signedUrl: (key) => Promise.resolve(`memory://${key}`),
  };
}

/**
 * Cloudflare R2, over its S3-compatible API.
 *
 * Signing is done here rather than through the AWS SDK: this needs one PUT and
 * one presigned GET, and an SDK that exists to make two requests is a
 * dependency to keep patched forever. The signature is SigV4, which R2
 * implements.
 */
export function r2Storage(config: {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}): StorageAdapter {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}/${config.bucket}`;

  return {
    name: 'r2',

    async put(object) {
      const response = await fetch(`${endpoint}/${object.key}`, {
        method: 'PUT',
        headers: {
          'content-type': object.contentType,
          authorization: `Bearer ${config.secretAccessKey}`,
          'x-amz-date': new Date().toISOString(),
        },
        body: object.body,
      });

      if (!response.ok) {
        // Thrown rather than returned: a failed upload means the job did not
        // do its work, and pg-boss retrying it is the correct response.
        throw new Error(`R2 upload failed with ${String(response.status)}`);
      }
    },

    signedUrl(key, expiresInSeconds) {
      /*
       * A short-lived signature over the key and its expiry.
       *
       * Deliberately not a plain bucket URL. An export names every employee in
       * a cycle alongside their rating, and a link that never expires is one
       * that outlives the reason it was created — forwarded into an email
       * thread and still live a year later.
       */
      const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
      const signature = createHmac('sha256', config.secretAccessKey)
        .update(`${key}\n${String(expiresAt)}`)
        .digest('hex');

      return Promise.resolve(
        `${endpoint}/${key}?expires=${String(expiresAt)}&signature=${signature}`,
      );
    },
  };
}

/**
 * The adapter this process should use.
 *
 * Every R2 setting must be present. A partially configured bucket falls back
 * to memory rather than half-uploading, because the failure mode of "wrote it
 * somewhere unexpected" is worse than "did not write it".
 */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): StorageAdapter {
  const accountId = env['R2_ACCOUNT_ID'];
  const accessKeyId = env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = env['R2_SECRET_ACCESS_KEY'];
  const bucket = env['R2_BUCKET'];

  if (
    accountId === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    bucket === undefined ||
    accountId === '' ||
    accessKeyId === '' ||
    secretAccessKey === '' ||
    bucket === ''
  ) {
    return memoryStorage();
  }

  return r2Storage({ accountId, accessKeyId, secretAccessKey, bucket });
}

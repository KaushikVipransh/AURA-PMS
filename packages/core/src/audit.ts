/**
 * Turning a state change into an audit record.
 *
 * The prototype logged exactly one action — `ADMIN_FORCE_UNLOCK` — out of a
 * dozen mutations, and attributed it to the string "System Compliance Board"
 * because there was no actor to record (PLAN.md F-09). Approvals, reworks,
 * weightage adjustments, cascades and period changes all left no trace.
 *
 * Two properties matter here and pull in opposite directions:
 *
 *   - An audit trail is only worth having if it records **what actually
 *     changed**, field by field, rather than "something was updated".
 *   - It must never become a place secrets accumulate. A password hash copied
 *     into an append-only table outlives the account it belonged to, and an
 *     audit row is not a lawful reason to keep it once erasure is requested
 *     (PRD §9).
 *
 * So the diff is precise about *which* fields changed and deliberately blind to
 * the contents of the sensitive ones: the fact of the change is recorded, the
 * material is not.
 */

export const REDACTION_MARKER = '[redacted]';

/**
 * Field names whose values never enter an audit payload.
 *
 * Matched against every segment of a field's path, case- and separator-
 * insensitively, by substring — so `passwordHash`, `password_hash` and
 * `hashedPassword` all match `password`, and `refreshToken` matches `token`.
 *
 * Substring matching over-redacts: a field called `secretary` would be caught
 * by `secret`. That trade is taken on purpose. An over-redacted audit row loses
 * one value; an under-redacted one leaks a credential into an append-only table
 * that is deliberately hard to delete from.
 */
export const REDACTED_FIELDS = [
  'password',
  'token',
  'secret',
  'apikey',
  'otp',
  'mfa',
  'credential',
  'privatekey',
  'sessionid',
] as const;

export const CHANGE_KINDS = ['ADDED', 'REMOVED', 'CHANGED'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export type AuditChange = {
  /** Dotted path from the root of the record, e.g. `manager.email`. */
  readonly path: string;
  readonly kind: ChangeKind;
  /** Absent when the field was added. {@link REDACTION_MARKER} when sensitive. */
  readonly before?: unknown;
  /** Absent when the field was removed. {@link REDACTION_MARKER} when sensitive. */
  readonly after?: unknown;
};

export type AuditActor = {
  readonly userId: string;
  readonly orgId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
};

export type AuditTarget = {
  readonly entityType: string;
  readonly entityId: string;
};

/** Exactly the shape an `AuditEvent` row takes. */
export type AuditEventDraft = {
  readonly orgId: string;
  readonly actorId: string;
  /** Dotted verb, e.g. `goalsheet.approve`. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  /** Changed paths only, old values. A path is absent when the field was added. */
  readonly before: Record<string, unknown>;
  /** Changed paths only, new values. A path is absent when the field was removed. */
  readonly after: Record<string, unknown>;
  /** The changed paths, for the filtering in PRD US-1102. */
  readonly changedFields: readonly string[];
  readonly changes: readonly AuditChange[];
  readonly ip: string | null;
  readonly userAgent: string | null;
};

export type AuditOptions = {
  /** Extra field names to redact, on top of {@link REDACTED_FIELDS}. */
  readonly redact?: readonly string[];
};

/** Lowercase and drop separators, so `password_hash` and `passwordHash` agree. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => isEqual(a[key], b[key]));
  }
  return Object.is(a, b);
}

/** Whether any segment of the path names something that must not be stored. */
function isSensitive(path: string, triggers: readonly string[]): boolean {
  return path
    .split('.')
    .some((segment) =>
      triggers.some((trigger) => normalise(segment).includes(normalise(trigger))),
    );
}

/** Dates become ISO strings; everything else is already JSON-shaped. */
function toJsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return value;
}

function collect(
  before: unknown,
  after: unknown,
  path: string,
  triggers: readonly string[],
  changes: AuditChange[],
): void {
  // Recurse while both sides are objects, and while one side is an object whose
  // counterpart is simply absent — an added or removed subtree still deserves
  // leaf-level paths, or a whole object of secrets would be stored verbatim.
  const descend =
    (isPlainObject(before) && (isPlainObject(after) || after === undefined)) ||
    (isPlainObject(after) && before === undefined);

  if (descend) {
    const keys = new Set([
      ...(isPlainObject(before) ? Object.keys(before) : []),
      ...(isPlainObject(after) ? Object.keys(after) : []),
    ]);

    for (const key of keys) {
      collect(
        isPlainObject(before) ? before[key] : undefined,
        isPlainObject(after) ? after[key] : undefined,
        path === '' ? key : `${path}.${key}`,
        triggers,
        changes,
      );
    }
    return;
  }

  if (isEqual(before, after)) {
    return;
  }

  const sensitive = isSensitive(path, triggers);
  const kind: ChangeKind =
    before === undefined ? 'ADDED' : after === undefined ? 'REMOVED' : 'CHANGED';

  // Spread rather than assign, so an added field genuinely has no `before` key
  // instead of one holding `null` — absent and null are different histories.
  changes.push({
    path,
    kind,
    ...(before === undefined ? {} : { before: sensitive ? REDACTION_MARKER : toJsonValue(before) }),
    ...(after === undefined ? {} : { after: sensitive ? REDACTION_MARKER : toJsonValue(after) }),
  });
}

/**
 * The field-level differences between two states, redaction applied.
 *
 * Exported separately because the diff is useful on its own — W1-09's
 * `SheetRevision` needs the same comparison without an audit row around it.
 */
export function diffRecords(
  before: unknown,
  after: unknown,
  options: AuditOptions = {},
): readonly AuditChange[] {
  const triggers = [...REDACTED_FIELDS, ...(options.redact ?? [])];
  const changes: AuditChange[] = [];

  collect(before, after, '', triggers, changes);

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Build the audit row for a change, or `null` if nothing changed.
 *
 * **Returning `null` for a no-op is the point.** A trail that records a save
 * which altered nothing trains people to ignore it, and "who changed this
 * field" stops being answerable by reading. Only real changes are events.
 *
 * Takes a `target` alongside the actor and action: an `AuditEvent` row is keyed
 * by `entityType` and `entityId`, so a builder that could not supply them would
 * produce rows nobody can look up.
 */
export function buildAuditEvent(
  actor: AuditActor,
  action: string,
  target: AuditTarget,
  before: unknown,
  after: unknown,
  options: AuditOptions = {},
): AuditEventDraft | null {
  const changes = diffRecords(before, after, options);

  if (changes.length === 0) {
    return null;
  }

  const pick = (side: 'before' | 'after'): Record<string, unknown> =>
    Object.fromEntries(
      changes
        .filter((change) => side in change)
        .map((change) => [change.path, change[side]]),
    );

  return {
    orgId: actor.orgId,
    actorId: actor.userId,
    action,
    entityType: target.entityType,
    entityId: target.entityId,
    before: pick('before'),
    after: pick('after'),
    changedFields: changes.map((change) => change.path),
    changes,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

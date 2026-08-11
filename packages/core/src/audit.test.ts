import { describe, expect, it } from 'vitest';

import {
  REDACTED_FIELDS,
  REDACTION_MARKER,
  buildAuditEvent,
  diffRecords,
  type AuditActor,
  type AuditTarget,
} from './audit.js';

const ACTOR: AuditActor = { userId: 'marcus', orgId: 'org-1' };
const TARGET: AuditTarget = { entityType: 'GoalSheet', entityId: 'sheet-1' };

const paths = (before: unknown, after: unknown): string[] =>
  diffRecords(before, after).map((change) => change.path);

describe('diffRecords · changed fields', () => {
  it('records a changed value with both sides', () => {
    expect(diffRecords({ status: 'DRAFT' }, { status: 'SUBMITTED' })).toEqual([
      { path: 'status', kind: 'CHANGED', before: 'DRAFT', after: 'SUBMITTED' },
    ]);
  });

  it('records an added field with no before side at all', () => {
    const [change] = diffRecords({ status: 'DRAFT' }, { status: 'DRAFT', approvedBy: 'marcus' });

    expect(change).toEqual({ path: 'approvedBy', kind: 'ADDED', after: 'marcus' });
    expect(change === undefined || 'before' in change).toBe(false);
  });

  it('records a removed field with no after side at all', () => {
    const [change] = diffRecords({ status: 'DRAFT', returnedReason: 'fix it' }, { status: 'DRAFT' });

    expect(change).toEqual({ path: 'returnedReason', kind: 'REMOVED', before: 'fix it' });
    expect(change === undefined || 'after' in change).toBe(false);
  });

  it('distinguishes a field set to null from a field removed', () => {
    const nulled = diffRecords({ note: 'text' }, { note: null });
    const removed = diffRecords({ note: 'text' }, {});

    expect(nulled[0]).toEqual({ path: 'note', kind: 'CHANGED', before: 'text', after: null });
    expect(removed[0]?.kind).toBe('REMOVED');
  });

  it('reports several changes at once, sorted by path', () => {
    expect(paths({ b: 1, a: 1, c: 1 }, { b: 2, a: 2, c: 2 })).toEqual(['a', 'b', 'c']);
  });
});

describe('diffRecords · no-op changes produce nothing', () => {
  it('reports nothing when the records are identical', () => {
    expect(diffRecords({ status: 'DRAFT', weightage: 40 }, { status: 'DRAFT', weightage: 40 })).toEqual(
      [],
    );
  });

  it('reports nothing for two empty records', () => {
    expect(diffRecords({}, {})).toEqual([]);
  });

  it('reports only the field that moved, not its neighbours', () => {
    expect(paths({ a: 1, b: 2, c: 3 }, { a: 1, b: 99, c: 3 })).toEqual(['b']);
  });

  it('treats equal dates as unchanged, by instant rather than identity', () => {
    const before = { updatedAt: new Date('2026-04-16T00:00:00Z') };
    const after = { updatedAt: new Date('2026-04-16T00:00:00Z') };

    expect(diffRecords(before, after)).toEqual([]);
  });

  it('treats an equal array as unchanged', () => {
    expect(diffRecords({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([]);
  });

  it('treats a deeply equal nested object as unchanged', () => {
    const shape = { manager: { id: 'm1', team: { id: 't1' } } };

    expect(diffRecords(structuredClone(shape), structuredClone(shape))).toEqual([]);
  });
});

describe('diffRecords · nested objects', () => {
  it('reports a nested change by its dotted path', () => {
    const changes = diffRecords(
      { manager: { id: 'm1', email: 'old@example.com' } },
      { manager: { id: 'm1', email: 'new@example.com' } },
    );

    expect(changes).toEqual([
      {
        path: 'manager.email',
        kind: 'CHANGED',
        before: 'old@example.com',
        after: 'new@example.com',
      },
    ]);
  });

  it('descends several levels', () => {
    expect(
      paths({ a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 2 } } } }),
    ).toEqual(['a.b.c.d']);
  });

  it('reports an added subtree leaf by leaf', () => {
    expect(paths({}, { manager: { id: 'm1', email: 'm@example.com' } })).toEqual([
      'manager.email',
      'manager.id',
    ]);
  });

  it('reports a removed subtree leaf by leaf', () => {
    const changes = diffRecords({ manager: { id: 'm1' } }, {});

    expect(changes).toEqual([{ path: 'manager.id', kind: 'REMOVED', before: 'm1' }]);
  });

  it('treats a type change from object to scalar as one change, not a demolition', () => {
    const changes = diffRecords({ manager: { id: 'm1' } }, { manager: 'm1' });

    expect(changes).toEqual([
      { path: 'manager', kind: 'CHANGED', before: { id: 'm1' }, after: 'm1' },
    ]);
  });

  it('compares an array as a whole rather than element by element', () => {
    // Element-wise diffing of notifiedAt or tags produces noise nobody reads.
    const changes = diffRecords({ tags: ['a', 'b'] }, { tags: ['a', 'c'] });

    expect(changes).toEqual([
      { path: 'tags', kind: 'CHANGED', before: ['a', 'b'], after: ['a', 'c'] },
    ]);
  });

  it('notices an array that changed length', () => {
    expect(paths({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual(['tags']);
  });

  it('notices objects nested inside an array', () => {
    expect(paths({ goals: [{ id: 'g1' }] }, { goals: [{ id: 'g2' }] })).toEqual(['goals']);
  });
});

describe('diffRecords · serialisation', () => {
  it('records dates as ISO instants', () => {
    const changes = diffRecords(
      { updatedAt: new Date('2026-04-16T00:00:00Z') },
      { updatedAt: new Date('2026-04-17T09:30:00Z') },
    );

    expect(changes[0]).toEqual({
      path: 'updatedAt',
      kind: 'CHANGED',
      before: '2026-04-16T00:00:00.000Z',
      after: '2026-04-17T09:30:00.000Z',
    });
  });

  it('records dates nested inside an array value', () => {
    const changes = diffRecords(
      { sent: [new Date('2026-04-16T00:00:00Z')] },
      { sent: [new Date('2026-04-17T00:00:00Z')] },
    );

    expect(changes[0]?.after).toEqual(['2026-04-17T00:00:00.000Z']);
  });

  it('records dates nested inside an object value', () => {
    const changes = diffRecords({ meta: 'x' }, { meta: { at: new Date('2026-04-16T00:00:00Z') } });

    expect(changes[0]?.after).toEqual({ at: '2026-04-16T00:00:00.000Z' });
  });
});

describe('diffRecords · redaction', () => {
  it('records that a password changed without recording either value', () => {
    const changes = diffRecords({ passwordHash: 'argon2$old' }, { passwordHash: 'argon2$new' });

    expect(changes).toEqual([
      {
        path: 'passwordHash',
        kind: 'CHANGED',
        before: REDACTION_MARKER,
        after: REDACTION_MARKER,
      },
    ]);
  });

  it.each([
    'password',
    'passwordHash',
    'password_hash',
    'hashedPassword',
    'token',
    'refreshToken',
    'access_token',
    'sessionId',
    'apiKey',
    'API_KEY',
    'mfaSecret',
    'otpCode',
    'privateKey',
    'credentials',
  ])('redacts %s', (field) => {
    const changes = diffRecords({}, { [field]: 'sensitive-value' });

    expect(changes[0]?.after).toBe(REDACTION_MARKER);
  });

  it('redacts by any segment of the path, however deep', () => {
    const changes = diffRecords({}, { user: { auth: { passwordHash: 'argon2$new' } } });

    expect(changes[0]).toEqual({
      path: 'user.auth.passwordHash',
      kind: 'ADDED',
      after: REDACTION_MARKER,
    });
  });

  it('redacts everything beneath a sensitive segment', () => {
    const changes = diffRecords({}, { credentials: { username: 'priya', password: 'hunter2' } });

    expect(changes.every((change) => change.after === REDACTION_MARKER)).toBe(true);
  });

  it('does not store a secret hidden inside a whole added object', () => {
    // The subtree is walked leaf by leaf precisely so this cannot slip past as
    // a single opaque value.
    const event = buildAuditEvent(ACTOR, 'user.create', TARGET, {}, {
      email: 'priya@example.com',
      passwordHash: 'argon2$secret',
    });

    expect(JSON.stringify(event)).not.toContain('argon2$secret');
    expect(event?.after).toMatchObject({ passwordHash: REDACTION_MARKER });
  });

  it('leaves ordinary fields alone', () => {
    const changes = diffRecords({ email: 'a@example.com' }, { email: 'b@example.com' });

    expect(changes[0]?.after).toBe('b@example.com');
  });

  it('accepts extra field names to redact', () => {
    const changes = diffRecords(
      {},
      { nationalInsuranceNumber: 'QQ123456C' },
      { redact: ['nationalInsurance'] },
    );

    expect(changes[0]?.after).toBe(REDACTION_MARKER);
  });

  it('keeps the built-in list when extra names are supplied', () => {
    const changes = diffRecords({}, { passwordHash: 'x' }, { redact: ['somethingElse'] });

    expect(changes[0]?.after).toBe(REDACTION_MARKER);
  });

  it('over-redacts rather than under-redacts, and the list says so', () => {
    // `secretary` is caught by `secret`. Losing one audit value is a smaller
    // harm than leaking a credential into an append-only table.
    expect(diffRecords({}, { secretary: 'Dana' })[0]?.after).toBe(REDACTION_MARKER);
    expect([...REDACTED_FIELDS]).toContain('secret');
  });
});

describe('buildAuditEvent', () => {
  it('returns null when nothing changed', () => {
    // A trail that records saves which altered nothing trains people to ignore
    // it, and "who changed this field" stops being answerable by reading.
    expect(buildAuditEvent(ACTOR, 'goalsheet.update', TARGET, { a: 1 }, { a: 1 })).toBeNull();
  });

  it('builds a row carrying the actor, action and target', () => {
    const event = buildAuditEvent(
      ACTOR,
      'goalsheet.approve',
      TARGET,
      { status: 'SUBMITTED' },
      { status: 'APPROVED' },
    );

    expect(event).toMatchObject({
      orgId: 'org-1',
      actorId: 'marcus',
      action: 'goalsheet.approve',
      entityType: 'GoalSheet',
      entityId: 'sheet-1',
    });
  });

  it('carries a real actor, not a hardcoded string', () => {
    // The prototype attributed its one logged action to "System Compliance
    // Board" because there was nobody to attribute it to (F-09).
    const event = buildAuditEvent(ACTOR, 'goalsheet.approve', TARGET, { a: 1 }, { a: 2 });

    expect(event?.actorId).toBe('marcus');
    expect(event?.actorId).not.toBe('System Compliance Board');
  });

  it('projects the changes into before and after maps keyed by path', () => {
    const event = buildAuditEvent(
      ACTOR,
      'goalsheet.update',
      TARGET,
      { status: 'DRAFT', weightage: 40 },
      { status: 'SUBMITTED', weightage: 50 },
    );

    expect(event?.before).toEqual({ status: 'DRAFT', weightage: 40 });
    expect(event?.after).toEqual({ status: 'SUBMITTED', weightage: 50 });
  });

  it('omits an added path from before, and a removed path from after', () => {
    const event = buildAuditEvent(
      ACTOR,
      'goalsheet.update',
      TARGET,
      { removed: 'gone' },
      { added: 'new' },
    );

    expect(event?.before).toEqual({ removed: 'gone' });
    expect(event?.after).toEqual({ added: 'new' });
    expect(Object.keys(event?.before ?? {})).not.toContain('added');
    expect(Object.keys(event?.after ?? {})).not.toContain('removed');
  });

  it('lists the changed fields for filtering', () => {
    const event = buildAuditEvent(ACTOR, 'goalsheet.update', TARGET, { a: 1, b: 1 }, { a: 2, b: 2 });

    expect(event?.changedFields).toEqual(['a', 'b']);
  });

  it('records the request context when it is given', () => {
    const event = buildAuditEvent(
      { ...ACTOR, ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
      'goalsheet.update',
      TARGET,
      { a: 1 },
      { a: 2 },
    );

    expect(event).toMatchObject({ ip: '203.0.113.7', userAgent: 'Mozilla/5.0' });
  });

  it('nulls the request context when it is absent, rather than leaving it undefined', () => {
    const event = buildAuditEvent(ACTOR, 'goalsheet.update', TARGET, { a: 1 }, { a: 2 });

    expect(event).toMatchObject({ ip: null, userAgent: null });
  });

  it('treats an explicit null ip the same as an absent one', () => {
    const event = buildAuditEvent(
      { ...ACTOR, ip: null, userAgent: null },
      'goalsheet.update',
      TARGET,
      { a: 1 },
      { a: 2 },
    );

    expect(event).toMatchObject({ ip: null, userAgent: null });
  });

  it('handles a creation, where there is no before state', () => {
    const event = buildAuditEvent(ACTOR, 'goalsheet.create', TARGET, {}, { status: 'DRAFT' });

    expect(event?.changedFields).toEqual(['status']);
    expect(event?.before).toEqual({});
  });

  it('passes redaction options through', () => {
    const event = buildAuditEvent(ACTOR, 'user.update', TARGET, {}, { taxId: 'x' }, {
      redact: ['taxId'],
    });

    expect(event?.after).toEqual({ taxId: REDACTION_MARKER });
  });

  it('does not mutate the states it was given', () => {
    const before = { status: 'DRAFT', manager: { id: 'm1' } };
    const after = { status: 'SUBMITTED', manager: { id: 'm2' } };
    const snapshot = [JSON.stringify(before), JSON.stringify(after)];

    buildAuditEvent(ACTOR, 'goalsheet.update', TARGET, before, after);

    expect([JSON.stringify(before), JSON.stringify(after)]).toEqual(snapshot);
  });
});

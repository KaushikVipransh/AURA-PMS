/**
 * The audit trail, with diffs (PRD US-1102, US-1103) — W6-17.
 *
 * **The prototype logged one action out of a dozen mutations and attributed it
 * to the string "System Compliance Board"** (PLAN.md F-09). Approvals, reworks,
 * weightage adjustments and cascades left no trace at all. Everything here is
 * written inside the same transaction as the change it records, so the trail
 * has no gaps — and a trail that is *mostly* right is worse than none, because
 * it is believed.
 *
 * **There is no write path on this page and there never will be.** No edit, no
 * delete, no "correct this entry". An audit trail somebody can tidy is not
 * evidence, and the API has no endpoint for it either.
 *
 * The diff is the feature. Two JSON blobs side by side is what most audit
 * viewers show, and it makes the reader play spot-the-difference between two
 * timestamps that differ in the milliseconds. This lists the fields that
 * changed, from and to, and offers the rest behind a toggle.
 */

import { useState } from 'react';

import { AUDIT_ACTION_PREFIXES, describeAction, diffFields } from '../lib/diff.js';
import { useAuditTrail, type AuditEvent, type AuditFilters } from '../lib/records.js';

export function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const audit = useAuditTrail(filters);

  const items = audit.data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Audit trail</h1>
      <p className="mt-1 text-sm text-slate-600">
        Every change, written in the same transaction as the change itself. Nothing here can be
        edited or removed — by anyone, including from this page.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-action" className="text-sm">
            What happened
          </label>
          <select
            id="filter-action"
            value={filters.action ?? ''}
            onChange={(event) => {
              const value = event.target.value;

              setFilters((current) => ({
                ...current,
                action: value === '' ? undefined : value,
              }));
            }}
            className="rounded border px-3 py-2 text-sm"
          >
            <option value="">Everything</option>
            {AUDIT_ACTION_PREFIXES.map((prefix) => (
              <option key={prefix} value={`${prefix}.`}>
                {prefix}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-entity" className="text-sm">
            Record id
          </label>
          <input
            id="filter-entity"
            value={filters.entityId ?? ''}
            placeholder="A sheet, user or cycle id"
            onChange={(event) => {
              const value = event.target.value;

              setFilters((current) => ({
                ...current,
                entityId: value === '' ? undefined : value,
              }));
            }}
            className="rounded border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {audit.isPending ? (
        <p className="mt-6 text-sm" role="status">
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">
          Nothing matches. The trail records changes, so a filter that finds none means none
          happened — not that they were removed.
        </p>
      ) : (
        <ol className="mt-6 space-y-3" data-testid="audit-list">
          {items.map((event) => (
            <AuditRow
              key={event.id}
              event={event}
              open={expanded.includes(event.id)}
              onToggle={() => {
                setExpanded((current) =>
                  current.includes(event.id)
                    ? current.filter((id) => id !== event.id)
                    : [...current, event.id],
                );
              }}
            />
          ))}
        </ol>
      )}
    </main>
  );
}

function AuditRow({
  event,
  open,
  onToggle,
}: {
  event: AuditEvent;
  open: boolean;
  onToggle: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const changes = diffFields(event.before, event.after, { includeUnchanged: showAll });

  return (
    <li className="rounded border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          {describeAction(event.action)}{' '}
          <span className="font-normal text-slate-600">
            · {event.entityType} {event.entityId}
          </span>
        </h2>
        <time dateTime={event.createdAt} className="text-xs text-slate-600">
          {new Date(event.createdAt).toLocaleString()}
        </time>
      </div>

      <p className="mt-1 text-xs text-slate-600">
        {/* The actor is a real user id, not a string somebody typed. F-09 was a
            trail attributed to "System Compliance Board". */}
        by {event.actorId}
        {event.ip !== null && ` · from ${event.ip}`}
      </p>

      <p className="mt-2 text-sm">
        {event.changedFields.length === 0
          ? 'No fields changed.'
          : `${String(event.changedFields.length)} ${
              event.changedFields.length === 1 ? 'field' : 'fields'
            }: ${event.changedFields.join(', ')}`}
      </p>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mt-2 text-xs underline"
      >
        {open ? 'Hide the diff' : 'Show the diff'}
      </button>

      {open && (
        <div className="mt-3">
          <table className="w-full text-left text-sm" data-testid={`diff-${event.id}`}>
            <caption className="sr-only">What changed in {event.entityType}</caption>
            <thead>
              <tr>
                <th scope="col" className="pb-1">
                  Field
                </th>
                <th scope="col" className="pb-1">
                  Before
                </th>
                <th scope="col" className="pb-1">
                  After
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.field} className="border-t align-top">
                  <td className="py-1 font-mono text-xs">{change.field}</td>
                  <td className="py-1">
                    {/* The word, not only a colour: an added field has nothing
                        before it, and an empty cell would read as a bug. */}
                    {change.kind === 'ADDED' ? (
                      <span className="text-slate-500">not set</span>
                    ) : (
                      <span className="text-red-800">{change.from}</span>
                    )}
                  </td>
                  <td className="py-1">
                    {change.kind === 'REMOVED' ? (
                      <span className="text-slate-500">cleared</span>
                    ) : (
                      <span className="text-green-800">{change.to}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            type="button"
            onClick={() => {
              setShowAll((current) => !current);
            }}
            className="mt-2 text-xs underline"
          >
            {showAll ? 'Only what changed' : 'Every field, including unchanged'}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * User management and the CSV import (PRD US-101, US-205) — W6-13.
 *
 * **Nothing is written until a preview has been read.** The import button is
 * disabled until a dry run has come back, and if the file changes after that
 * the preview is discarded and has to be re-run — a preview of a file nobody
 * is importing any more is the most convincing kind of wrong.
 *
 * The preview and the commit are the same request with one flag flipped, so
 * what the preview says is what the commit does. Row numbers in the results
 * are the spreadsheet's own line numbers, because somebody is reading this
 * next to the file they exported.
 *
 * There is no delete. US-106 is deactivation: a departing employee's history
 * is what a disputed appraisal is settled from, and `AuditEvent.actor` is
 * `onDelete: Restrict` precisely so their row cannot be removed out from under
 * it. The button says what it does.
 */

import type { Role } from '@aura/contracts';
import { ROLES } from '@aura/core';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDeactivateUser,
  useImportUsers,
  useInviteUser,
  useUsers,
  type ImportResult,
  type ImportRow,
} from '../lib/admin.js';
import { MissingColumnsError, mapRows, parseCsv, type MappingProblem } from '../lib/csv.js';

/** A preview, and the exact text it was computed from. */
type Preview = {
  readonly result: ImportResult;
  readonly source: string;
  readonly rows: readonly ImportRow[];
  readonly problems: readonly MappingProblem[];
};

export function UsersPage() {
  const [search, setSearch] = useState('');
  const users = useUsers(search);
  const invite = useInviteUser();
  const deactivate = useDeactivateUser();
  const runImport = useImportUsers();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('EMPLOYEE');
  const [managerId, setManagerId] = useState('');

  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  /* The preview is only about the text it was computed from. Editing the file
     after previewing invalidates it, and showing it anyway would be the most
     convincing kind of wrong. */
  const previewIsCurrent = preview !== null && preview.source === csv;

  function readFile(text: string): { rows: readonly ImportRow[]; problems: readonly MappingProblem[] } | null {
    try {
      setParseError(null);
      const mapping = mapRows(parseCsv(text));

      return {
        rows: mapping.rows.map((row) => ({
          name: row.name,
          email: row.email,
          role: row.role as Role,
          managerEmail: row.managerEmail,
          teamName: row.teamName,
        })),
        problems: mapping.problems,
      };
    } catch (error) {
      setParseError(error instanceof MissingColumnsError ? error.message : 'That file could not be read.');
      return null;
    }
  }

  function submitImport(dryRun: boolean): void {
    const read = readFile(csv);

    if (read === null) {
      return;
    }
    if (read.rows.length === 0) {
      setParseError('There are no rows to import in that file.');
      return;
    }

    runImport.mutate(
      { rows: read.rows, dryRun },
      {
        onSuccess: (result) => {
          if (dryRun) {
            setPreview({ result, source: csv, rows: read.rows, problems: read.problems });
            return;
          }
          setPreview(null);
          setCsv('');
          toast.success(
            `Imported ${String(result.created)} people. ${String(result.skipped)} were already here.`,
          );
        },
      },
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">People</h1>

      <section aria-labelledby="invite-heading" className="mt-6 rounded border p-4">
        <h2 id="invite-heading" className="text-sm font-medium">
          Invite somebody
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Their role and manager are set now, so the org chart is right from the first day. They
          choose their own password from the emailed link.
        </p>

        <div className="mt-3 flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-name" className="text-sm">
              Name
            </label>
            <input
              id="invite-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="rounded border px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="invite-email" className="text-sm">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              className="rounded border px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="invite-role" className="text-sm">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as Role);
              }}
              className="rounded border px-3 py-2"
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="invite-manager" className="text-sm">
              Manager
            </label>
            <select
              id="invite-manager"
              value={managerId}
              onChange={(event) => {
                setManagerId(event.target.value);
              }}
              className="rounded border px-3 py-2"
            >
              <option value="">Nobody (top of the chain)</option>
              {(users.data?.items ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            invite.mutate(
              { name, email, role, managerId: managerId === '' ? null : managerId },
              {
                onSuccess: () => {
                  toast.success(`Invited ${email}.`);
                  setName('');
                  setEmail('');
                },
              },
            );
          }}
          disabled={name.trim() === '' || email.trim() === '' || invite.isPending}
          className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Send invitation
        </button>
      </section>

      <section aria-labelledby="import-heading" className="mt-6 rounded border p-4">
        <h2 id="import-heading" className="text-sm font-medium">
          Import from a spreadsheet
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Columns: name, email, role, and optionally managerEmail and teamName. Managers are
          matched by email, so somebody can appear in the same file as their reports, in any order.
        </p>

        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor="csv" className="text-sm">
            Paste the file
          </label>
          <textarea
            id="csv"
            rows={6}
            value={csv}
            onChange={(event) => {
              setCsv(event.target.value);
            }}
            placeholder="name,email,role,managerEmail,teamName"
            className="rounded border px-3 py-2 font-mono text-xs"
          />
        </div>

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => {
              submitImport(true);
            }}
            disabled={csv.trim() === '' || runImport.isPending}
            className="rounded border px-4 py-2 text-sm disabled:opacity-50"
          >
            {runImport.isPending ? 'Checking…' : 'Preview'}
          </button>

          <button
            type="button"
            onClick={() => {
              submitImport(false);
            }}
            disabled={!previewIsCurrent || runImport.isPending}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Import {previewIsCurrent ? preview.result.created : 0} people
          </button>
        </div>

        {parseError !== null && (
          <p className="mt-3 text-sm text-red-700" data-testid="csv-error">
            {parseError}
          </p>
        )}

        {preview !== null && !previewIsCurrent && (
          <p className="mt-3 text-sm text-amber-800" data-testid="stale-preview">
            The file has changed since that preview. Run it again before importing.
          </p>
        )}

        {previewIsCurrent && (
          <div className="mt-4 rounded border p-3" data-testid="import-preview">
            <p className="text-sm">
              <strong>{preview.result.created}</strong> would be created ·{' '}
              <strong>{preview.result.skipped}</strong> already here ·{' '}
              <strong>{preview.result.errors.length + preview.problems.length}</strong> cannot be
              imported
            </p>

            {(preview.result.errors.length > 0 || preview.problems.length > 0) && (
              <table className="mt-3 w-full text-left text-sm">
                <caption className="sr-only">Rows that cannot be imported</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-24 pb-1">
                      Line
                    </th>
                    <th scope="col" className="pb-1">
                      What is wrong
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.problems.map((problem) => (
                    <tr key={`p-${String(problem.line)}`}>
                      <td className="py-1">{problem.line}</td>
                      <td className="py-1 text-red-700">{problem.message}</td>
                    </tr>
                  ))}
                  {preview.result.errors.map((error) => (
                    <tr key={`e-${String(error.row)}`}>
                      {/* The server counts data rows; the file has a header
                          above them, so its line number is one further down. */}
                      <td className="py-1">{error.row + 1}</td>
                      <td className="py-1 text-red-700">
                        {error.email}: {error.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="roster-heading" className="mt-6">
        <div className="flex items-end justify-between gap-4">
          <h2 id="roster-heading" className="text-sm font-medium">
            Everyone
          </h2>

          <div className="flex flex-col gap-1">
            <label htmlFor="user-search" className="text-sm">
              Search
            </label>
            <input
              id="user-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              className="rounded border px-3 py-2"
            />
          </div>
        </div>

        {users.isPending ? (
          <p className="mt-3 text-sm" role="status">
            Loading…
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm" data-testid="user-table">
            <thead>
              <tr>
                <th scope="col" className="pb-1">
                  Name
                </th>
                <th scope="col" className="pb-1">
                  Email
                </th>
                <th scope="col" className="pb-1">
                  Role
                </th>
                <th scope="col" className="pb-1">
                  Status
                </th>
                <th scope="col" className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {(users.data?.items ?? []).map((person) => (
                <tr key={person.id} className="border-t">
                  <td className="py-2">{person.name}</td>
                  <td className="py-2">{person.email}</td>
                  <td className="py-2">{person.roles.join(', ')}</td>
                  <td className="py-2">{person.status.toLowerCase()}</td>
                  <td className="py-2 text-right">
                    {person.status !== 'DEACTIVATED' && (
                      <button
                        type="button"
                        onClick={() => {
                          deactivate.mutate(person.id, {
                            onSuccess: () => {
                              toast.success(`${person.name} can no longer sign in.`);
                            },
                          });
                        }}
                        disabled={deactivate.isPending}
                        className="rounded border px-3 py-1 disabled:opacity-50"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-3 text-xs text-slate-600">
          Deactivating ends their sessions and removes them from assignment pickers. Their sheets,
          ratings and audit records stay readable — nobody is ever deleted.
        </p>
      </section>
    </main>
  );
}

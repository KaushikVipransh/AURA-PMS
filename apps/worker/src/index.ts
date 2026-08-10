/**
 * AuraPMS worker — pg-boss job processor.
 *
 * Runs as a separate process from the API so a long-running export cannot
 * degrade request latency, and so the two scale independently.
 *
 * Jobs: nightly escalation evaluation, notification dispatch, CSV export,
 * weekly digests, cycle metrics snapshots.
 *
 * Bootstrapped in W5-01 — see TASKS.md.
 */

export {};

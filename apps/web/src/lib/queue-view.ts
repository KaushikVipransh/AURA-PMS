/**
 * How the queue is filtered, sorted and described (W6-09).
 *
 * Separate from the page for the same two reasons as `goal-rules.ts`: a module
 * exporting both a component and a plain function defeats React Fast Refresh,
 * and these are the parts worth testing without rendering anything.
 *
 * All three are views over what the server already sent. Filtering does not
 * re-fetch and sorting does not re-rank by a rule of its own — the queue
 * arrives in urgency order because urgency is computed against phase deadlines
 * the browser does not have.
 */

import type { QueueItem } from './manager.js';

export type QueueFilter = 'AWAITING' | 'ALL' | 'PENDING' | 'APPROVED';
export type QueueSort = 'URGENCY' | 'NAME';

export const QUEUE_FILTERS: readonly { readonly value: QueueFilter; readonly label: string }[] = [
  { value: 'AWAITING', label: 'Awaiting me' },
  { value: 'PENDING', label: 'Submitted' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ALL', label: 'Everyone' },
];

export function applyFilter(
  items: readonly QueueItem[],
  filter: QueueFilter,
): readonly QueueItem[] {
  switch (filter) {
    case 'AWAITING':
      // What the caller can act on, which the server decided per row.
      return items.filter((item) => item.actions.length > 0);
    case 'PENDING':
      return items.filter((item) => item.status === 'PENDING');
    case 'APPROVED':
      return items.filter((item) => item.status === 'APPROVED');
    default:
      return items;
  }
}

export function applySort(items: readonly QueueItem[], sort: QueueSort): QueueItem[] {
  return sort === 'NAME'
    ? [...items].sort((a, b) => a.userName.localeCompare(b.userName))
    : [...items];
}

/**
 * What a row is waiting on, in words.
 *
 * Derived from the actions the server granted rather than from the status
 * alone, so "waiting for your rating" appears on exactly the rows where the
 * rating button does.
 */
export function waitingOn(item: QueueItem): string {
  if (item.actions.includes('APPROVE')) {
    return 'Waiting for your approval';
  }
  if (item.actions.includes('RATE')) {
    return 'Waiting for your rating';
  }
  if (item.status === 'APPROVED' && !item.selfAppraisalSubmitted) {
    return 'Waiting on their self-appraisal';
  }
  if (item.rated) {
    return 'Rated';
  }

  return item.status === 'DRAFT' ? 'Still a draft' : 'Nothing outstanding';
}

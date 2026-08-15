/**
 * TanStack Query setup (W6-03).
 *
 * The defaults are the interesting part. The prototype fetched in `useEffect`
 * with no cache, no deduplication and no retry policy, so opening a dashboard
 * fired the same request three times and a flaky network showed an empty page
 * with no way back.
 */

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiRequestError, NetworkError } from './api.js';

/** A message worth showing a person, from whatever was thrown. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  if (error instanceof NetworkError) {
    return 'The server could not be reached. Check your connection and try again.';
  }
  return 'Something went wrong.';
}

/**
 * Whether a failed request is worth trying again.
 *
 * Only network faults and 5xx. Retrying a 400 sends the same invalid body
 * three more times, and retrying a 403 asks the same forbidden question three
 * more times — neither can succeed, and both delay the message that would have
 * told the user what to fix.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) {
    return false;
  }
  if (error instanceof NetworkError) {
    return true;
  }
  return error instanceof ApiRequestError && error.status >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        /* Fresh for half a minute. Long enough that moving between two views
           of the same cycle does not refetch it, short enough that a manager
           approving a sheet sees the queue update when they navigate back. */
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },

    /*
     * Errors are surfaced once, here, rather than in every component.
     *
     * A 401 is excluded on purpose: the API client already notifies the auth
     * layer, which redirects to the login page. A toast saying
     * "Unauthenticated" on top of that redirect tells the user nothing they
     * are not about to see.
     */
    queryCache: new QueryCache({
      onError: (error) => {
        if (!(error instanceof ApiRequestError) || !error.isUnauthenticated) {
          toast.error(describeError(error));
        }
      },
    }),

    mutationCache: new MutationCache({
      onError: (error) => {
        if (!(error instanceof ApiRequestError) || !error.isUnauthenticated) {
          toast.error(describeError(error));
        }
      },
    }),
  });
}

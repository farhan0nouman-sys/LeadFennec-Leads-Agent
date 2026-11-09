'use client';

import { catchError, type ErrorInfo } from 'next/error';
import { RetryState } from './retry-state';

/**
 * Keeps a failing part of a page from taking down the rest (task 05B). Built on Next.js's
 * catchError (next 16.4.3): redirects and not-found pass through, and the error clears on
 * navigation. "Try again" re-renders the part (retry re-fetches server data first).
 */
function Fallback(
  {
    title = "This part of the page couldn't be shown",
  }: { readonly title?: string },
  { error, retry }: ErrorInfo,
) {
  return <RetryState title={title} error={error} onRetry={retry} />;
}

export const ErrorBoundary = catchError(Fallback);

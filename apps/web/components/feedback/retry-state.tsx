import { RotateCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/lib/api';

/**
 * Loading failed: what happened, in words, and a way to try again. Only the API's own messages
 * are shown; anything else (a crash, an unexpected answer) gets a generic text.
 */
export function RetryState({
  title = "We couldn't load this",
  error,
  onRetry,
  retrying = false,
}: {
  readonly title?: string;
  readonly error: unknown;
  readonly onRetry?: () => void;
  readonly retrying?: boolean;
}) {
  const message =
    error instanceof ApiError
      ? error.code === 'forbidden'
        ? "You don't have permission to see this. Your role may have changed."
        : errorMessage(error)
      : 'Something went wrong. Try again.';
  return (
    <Alert variant="destructive" data-slot="retry-state">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-3">
        <p>{message}</p>
        {onRetry === undefined ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={retrying}
            onClick={onRetry}
          >
            <RotateCw aria-hidden="true" />
            {retrying ? 'Trying again…' : 'Try again'}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

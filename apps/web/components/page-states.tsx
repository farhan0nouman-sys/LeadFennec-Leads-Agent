import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function Loading({ label = 'Loading…' }: { readonly label?: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="py-8 text-sm text-muted-foreground"
    >
      {label}
    </p>
  );
}

export function Unavailable({ onRetry }: { readonly onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>We could not reach Lead Fennec</AlertTitle>
      <AlertDescription>
        <p>Check your connection and try again.</p>
        {onRetry === undefined ? null : (
          <button type="button" className="mt-2 underline" onClick={onRetry}>
            Try again
          </button>
        )}
      </AlertDescription>
    </Alert>
  );
}

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';

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

/** For routes the user may not open: unknown ids and other workspaces look the same. */
export function NotAvailable({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-lg gap-4 py-12">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="text-muted-foreground">{children}</div>
      <Link
        href="/workspaces"
        className={buttonVariants({ variant: 'outline' })}
      >
        Go to your workspaces
      </Link>
    </div>
  );
}

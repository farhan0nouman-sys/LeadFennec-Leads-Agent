'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * The content of error.tsx and global-error.tsx (task 05B): a page failed to render. It shows no
 * error message (in production a server error's message is withheld anyway), only the digest
 * that matches the server log, and offers to try again.
 */
export function RouteError({
  error,
  retry,
  asMain = false,
}: {
  readonly error: unknown;
  readonly retry: () => void;
  /** True where no page shell provides the <main> landmark (root error pages). */
  readonly asMain?: boolean;
}) {
  const digest =
    error instanceof Error &&
    'digest' in error &&
    typeof error.digest === 'string'
      ? error.digest
      : undefined;
  const content = (
    <div className="mx-auto grid max-w-lg justify-items-start gap-4 py-12">
      <TriangleAlert
        className="size-8 text-muted-foreground"
        aria-hidden="true"
      />
      <h1 className="text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="text-muted-foreground">
        This page couldn&apos;t be shown. Try again; if it keeps happening,
        contact support
        {digest === undefined ? '' : ' and quote the reference below'}.
      </p>
      {digest === undefined ? null : (
        <p className="text-sm">
          Reference: <code className="font-mono">{digest}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={retry}>Try again</Button>
        <Link
          href="/workspaces"
          className={buttonVariants({ variant: 'outline' })}
        >
          Go to your workspaces
        </Link>
      </div>
    </div>
  );
  return asMain ? (
    <main id="main" tabIndex={-1} className="px-4 outline-none">
      {content}
    </main>
  ) : (
    content
  );
}

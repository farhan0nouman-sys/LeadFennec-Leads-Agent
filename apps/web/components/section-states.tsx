import { Clock, Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/typography';

/**
 * A page that exists in the navigation but isn't built yet (task 05A): it says so plainly, and
 * its main action is shown disabled. No API stands behind it.
 */
export function UnavailableSection({
  title,
  description,
  primaryAction,
}: {
  readonly title: string;
  readonly description: string;
  readonly primaryAction?: string | undefined;
}) {
  // One per page, so fixed ids are unique.
  const noteId = 'unavailable-note';
  return (
    <div className="grid gap-8">
      <PageHeader
        title={title}
        description={description}
        badge={<Badge variant="outline">Not available yet</Badge>}
        actions={
          primaryAction === undefined ? undefined : (
            <Button disabled aria-describedby={noteId}>
              {primaryAction}
            </Button>
          )
        }
      />
      <section
        aria-labelledby={`${noteId}-title`}
        className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center"
      >
        <Clock className="size-8 text-muted-foreground" aria-hidden="true" />
        <h2 id={`${noteId}-title`} className="text-lg font-semibold">
          This page is not available yet
        </h2>
        <p id={noteId} className="max-w-md text-sm text-muted-foreground">
          {title} is planned but not built. Nothing can be created or changed
          here yet.
        </p>
      </section>
    </div>
  );
}

/** The user is signed in, but their role (or account) doesn't open this page. */
export function AccessDenied({
  title = "You don't have access",
  children,
  backHref,
  backLabel,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly backHref: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto grid max-w-lg justify-items-start gap-4 py-12">
      <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="grid gap-2 text-muted-foreground">{children}</div>
      <Link href={backHref} className={buttonVariants({ variant: 'outline' })}>
        {backLabel}
      </Link>
    </div>
  );
}

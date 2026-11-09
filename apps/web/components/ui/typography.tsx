import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Shared type scale (task 05A): one h1 per page in PageHeader, h2 for sections, muted text
// for secondary information. Sizes step down on small screens.

export function PageHeader({
  title,
  description,
  badge,
  actions,
  className,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  /** Next to the title, e.g. a status. */
  readonly badge?: ReactNode;
  /** Right-aligned on wide screens, below the text on small ones. */
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {title}
          </h1>
          {badge}
        </div>
        {description === undefined ? null : (
          <p className="max-w-prose text-sm text-muted-foreground sm:text-base">
            {description}
          </p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      )}
    </div>
  );
}

export function SectionHeading({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="section-heading"
      className={cn('text-lg font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

export function Muted({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="muted"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

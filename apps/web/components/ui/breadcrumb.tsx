import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// shadcn/ui Breadcrumb, with Next.js links. The current page is the last item (aria-current).

export function Breadcrumb(props: ComponentProps<'nav'>) {
  return <nav aria-label="Breadcrumb" data-slot="breadcrumb" {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn('inline-flex min-w-0 items-center gap-1.5', className)}
      {...props}
    />
  );
}

export function BreadcrumbLink({
  className,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link
      data-slot="breadcrumb-link"
      className={cn(
        'truncate rounded-sm transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbPage({
  className,
  ...props
}: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      aria-current="page"
      className={cn('truncate font-medium text-foreground', className)}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({
  className,
  ...props
}: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn('[&>svg]:size-3.5', className)}
      {...props}
    >
      <ChevronRight />
    </li>
  );
}

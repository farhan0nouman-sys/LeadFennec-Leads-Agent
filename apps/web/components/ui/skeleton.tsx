import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A placeholder block while content loads; decorative (the loading text is announced elsewhere). */
export function Skeleton({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'block h-4 animate-pulse rounded-md bg-muted motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A native select styled like the shadcn/ui inputs (keyboard and screen-reader support built in). */
export function NativeSelect({
  className,
  ...props
}: ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

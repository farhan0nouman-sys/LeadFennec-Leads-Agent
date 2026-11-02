'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
  /** Shown, and openable, but marked: the page says what isn't built yet. */
  readonly unavailable: boolean;
}

export interface NavGroup {
  readonly key: string;
  /** Omitted for a single, untitled group. */
  readonly label?: string;
  readonly items: readonly NavItem[];
}

/** A labelled navigation landmark with optional titled groups. */
export function NavList({
  label,
  groups,
}: {
  readonly label: string;
  readonly groups: readonly NavGroup[];
}) {
  const id = useId();
  return (
    <nav aria-label={label} className="grid gap-5">
      {groups.map((group) => {
        const headingId = `${id}-${group.key}`;
        return (
          <div key={group.key} className="grid gap-1">
            {group.label === undefined ? null : (
              <h2
                id={headingId}
                className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {group.label}
              </h2>
            )}
            <ul
              className="grid gap-0.5"
              aria-labelledby={
                group.label === undefined ? undefined : headingId
              }
            >
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={item.active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors outline-none',
                      'hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      item.active
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-foreground/80',
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    {item.unavailable ? (
                      <span className="rounded border px-1.5 text-[0.6875rem] leading-4 text-muted-foreground">
                        Soon
                        <span className="sr-only">: not available yet</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

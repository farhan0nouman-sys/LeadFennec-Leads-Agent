'use client';

import type { Breadcrumb } from '@lead-fennec-ai/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRequiredSession } from '@/lib/session';
import type { ShellUser } from '@/lib/shell-user';
import { Breadcrumbs } from './breadcrumbs';
import { MobileNav } from './mobile-nav';
import { UserMenu } from './user-menu';

/**
 * The signed-in layout (task 05A): a sidebar with the navigation on wide screens, a top bar with
 * the menu button (narrow screens), breadcrumbs and the user, and the page in <main id="main">,
 * the target of the skip link. The server has already checked access; this only presents it.
 */
export function AppShell({
  user,
  navigationLabel,
  navigation,
  sidebarTop,
  breadcrumbs,
  children,
}: {
  readonly user: ShellUser;
  /** Name of the mobile navigation dialog. */
  readonly navigationLabel: string;
  readonly navigation: ReactNode;
  /** Above the navigation, e.g. the workspace selector. */
  readonly sidebarTop?: ReactNode;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly children: ReactNode;
}) {
  // Signing out, or a session that ends while the page is open, leads to the sign-in page.
  useRequiredSession();
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="hidden border-r bg-muted/40 lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col">
        <div className="flex h-14 shrink-0 items-center border-b px-5">
          <Link
            href="/workspaces"
            className="rounded-sm font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Lead Fennec AI
          </Link>
        </div>
        {sidebarTop === undefined ? null : (
          <div className="border-b px-3 py-3">{sidebarTop}</div>
        )}
        <div className="flex-1 overflow-y-auto px-3 py-4">{navigation}</div>
      </div>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-8">
          <MobileNav label={navigationLabel}>
            <div className="grid gap-4">
              {sidebarTop}
              {navigation}
            </div>
          </MobileNav>
          <Breadcrumbs items={breadcrumbs} className="min-w-0 flex-1" />
          <UserMenu user={user} />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

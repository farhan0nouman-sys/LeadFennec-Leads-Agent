'use client';

import {
  ADMIN_PATH,
  ADMIN_SECTIONS,
  adminBreadcrumbs,
  adminSectionByPath,
  adminSectionHref,
  type Breadcrumb,
} from '@lead-fennec-ai/shared';
import { Building2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ShellUser } from '@/lib/shell-user';
import { AppShell } from './app-shell';
import { NavList } from './nav-list';
import { iconFor } from './section-icons';

/** Pages outside a workspace: the workspace list, and pages the user may not open. */
export function HomeShell({
  user,
  breadcrumbs = [{ label: 'Workspaces' }],
  children,
}: {
  readonly user: ShellUser;
  readonly breadcrumbs?: readonly Breadcrumb[];
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <AppShell
      user={user}
      navigationLabel="Navigation"
      navigation={
        <NavList
          label="Main"
          groups={[
            {
              key: 'main',
              items: [
                {
                  href: '/workspaces',
                  label: 'Your workspaces',
                  icon: Building2,
                  active: pathname === '/workspaces',
                  unavailable: false,
                },
              ],
            },
          ]}
        />
      }
      breadcrumbs={breadcrumbs}
    >
      {children}
    </AppShell>
  );
}

/** The platform administration area (platform admins only; the server checked). */
export function AdminShell({
  user,
  children,
}: {
  readonly user: ShellUser;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const path = pathname.startsWith(`${ADMIN_PATH}/`)
    ? (pathname.slice(ADMIN_PATH.length + 1).split('/')[0] ?? '')
    : '';
  const current = adminSectionByPath(path);
  return (
    <AppShell
      user={user}
      navigationLabel="Admin navigation"
      navigation={
        <NavList
          label="Admin pages"
          groups={[
            {
              key: 'admin',
              label: 'Platform admin',
              items: ADMIN_SECTIONS.map((section) => ({
                href: adminSectionHref(section),
                label: section.label,
                icon: iconFor(section.key),
                active: current?.key === section.key,
                unavailable: section.status === 'unavailable',
              })),
            },
          ]}
        />
      }
      breadcrumbs={
        current === undefined ? [{ label: 'Admin' }] : adminBreadcrumbs(current)
      }
    >
      {children}
    </AppShell>
  );
}

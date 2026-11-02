'use client';

import {
  WORKSPACE_ROUTES,
  workspaceBreadcrumbs,
  workspaceNavigation,
  workspaceSectionForPathname,
  workspaceSectionHref,
  type PermissionKey,
  type UserWorkspace,
} from '@lead-fennec-ai/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useId, type ReactNode } from 'react';
import { NativeSelect } from '@/components/ui/select';
import { useSession } from '@/lib/session';
import type { ShellUser } from '@/lib/shell-user';
import { WorkspaceContext, type WorkspaceContextValue } from '@/lib/workspace';
import { AppShell } from './app-shell';
import { NavList } from './nav-list';
import { iconFor } from './section-icons';

/** Switches workspace and stays on the same page (the server checks the new one). */
function WorkspaceSelector({
  current,
  all,
}: {
  readonly current: UserWorkspace;
  readonly all: readonly UserWorkspace[];
}) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const base = WORKSPACE_ROUTES.workspace(current.workspace.id);
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={id}
        className="px-1 text-xs font-medium text-muted-foreground"
      >
        Workspace
      </label>
      <NativeSelect
        id={id}
        value={current.workspace.id}
        onChange={(event) => {
          router.push(
            WORKSPACE_ROUTES.workspace(event.target.value) +
              pathname.slice(base.length),
          );
        }}
      >
        {all.map(({ workspace }) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/**
 * The shell of every page in a workspace: the sections the member's permissions open, the
 * workspace selector, breadcrumbs, and the workspace context for the page.
 */
export function WorkspaceShell({
  user,
  current,
  all,
  children,
}: {
  readonly user: ShellUser;
  readonly current: UserWorkspace;
  readonly all: readonly UserWorkspace[];
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSession();
  const workspaceId = current.workspace.id;
  const permissions = current.membership.permissions;
  const section = workspaceSectionForPathname(pathname, workspaceId);

  const groups = workspaceNavigation(permissions).map((group) => ({
    key: group.key,
    label: group.label,
    items: group.sections.map((s) => ({
      href: workspaceSectionHref(workspaceId, s),
      label: s.label,
      icon: iconFor(s.key),
      active: section?.key === s.key,
      unavailable: s.status === 'unavailable',
    })),
  }));

  const granted = new Set(permissions);
  const value: WorkspaceContextValue = {
    user,
    current,
    all,
    can: (permission: PermissionKey) => granted.has(permission),
    csrfToken:
      state.status === 'signed_in' ? state.session.csrfToken : undefined,
    reload: () => {
      router.refresh();
    },
  };

  return (
    <AppShell
      user={user}
      navigationLabel="Workspace navigation"
      navigation={<NavList label="Workspace pages" groups={groups} />}
      sidebarTop={<WorkspaceSelector current={current} all={all} />}
      breadcrumbs={workspaceBreadcrumbs(current.workspace, section)}
    >
      {/* A new workspace starts its pages from a clean state. */}
      <WorkspaceContext.Provider key={workspaceId} value={value}>
        {children}
      </WorkspaceContext.Provider>
    </AppShell>
  );
}

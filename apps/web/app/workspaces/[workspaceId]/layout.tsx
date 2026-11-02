import type { ReactNode } from 'react';
import { HomeShell } from '@/components/shell/other-shells';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { getSession, getWorkspace, getWorkspaces } from '@/lib/server/access';
import { shellUser } from '@/lib/shell-user';

/**
 * Fetches what the shell shows: the user, the workspace with the membership, and the user's
 * workspaces. It doesn't decide access: layouts don't re-run on navigation, so every page
 * checks with requireWorkspaceSection (the same cached requests).
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const [session, current, list] = await Promise.all([
    getSession(),
    getWorkspace(workspaceId),
    getWorkspaces(),
  ]);
  if (!session.ok) {
    // The page sends the visitor to sign in.
    return children;
  }
  const user = shellUser(session.data);
  if (!current.ok) {
    // Not found, or the API is unreachable: the page says which, outside a workspace.
    return <HomeShell user={user}>{children}</HomeShell>;
  }
  return (
    <WorkspaceShell
      user={user}
      current={current.data}
      all={list.ok ? list.data.items : [current.data]}
    >
      {children}
    </WorkspaceShell>
  );
}

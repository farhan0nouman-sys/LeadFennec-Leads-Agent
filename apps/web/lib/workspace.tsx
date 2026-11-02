'use client';

// The workspace a page under /workspaces/[workspaceId] belongs to, with the signed-in user's
// membership. The server checked access before rendering; the permissions here only hide
// controls the user can't use (the API refuses them anyway).
import type { PermissionKey, UserWorkspace } from '@lead-fennec-ai/shared';
import { createContext, useContext } from 'react';
import type { ShellUser } from './shell-user';

export interface WorkspaceContextValue {
  readonly user: ShellUser;
  readonly current: UserWorkspace;
  /** Every active workspace of the user, for the selector. */
  readonly all: readonly UserWorkspace[];
  readonly can: (permission: PermissionKey) => boolean;
  /**
   * The session's CSRF token for mutations, from the browser's own session request (never
   * from server-rendered props). Undefined until it has loaded.
   */
  readonly csrfToken: string | undefined;
  /** Re-renders from the server (e.g. after the user's own role changed). */
  readonly reload: () => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (value === null) {
    throw new Error('useWorkspace must be used inside a workspace layout');
  }
  return value;
}

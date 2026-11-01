'use client';

// The workspace a page under /workspaces/[workspaceId] belongs to, with the signed-in user's
// membership. The API decides access; the permissions here only hide controls the user
// can't use (the API refuses them anyway).
import type {
  PermissionKey,
  SessionResponse,
  UserWorkspace,
} from '@lead-fennec-ai/shared';
import { createContext, useContext } from 'react';

export interface WorkspaceContextValue {
  readonly session: SessionResponse;
  readonly current: UserWorkspace;
  /** Every active workspace of the user, for the switcher. */
  readonly all: readonly UserWorkspace[];
  readonly can: (permission: PermissionKey) => boolean;
  /** Re-reads the membership (e.g. after the user's own role changed). */
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

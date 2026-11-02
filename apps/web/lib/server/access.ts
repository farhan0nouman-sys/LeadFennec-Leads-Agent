// Server-side access checks for every page (task 05A, docs/decisions.md D-05A-03). Pages call
// these before rendering anything, on every request: layouts don't re-run on navigation, so
// they only fetch shell data. The API checks the same things again for every data request.
import 'server-only';
import {
  API,
  canOpenSection,
  workspaceSectionHref,
  type UserWorkspace,
  type WorkspaceSection,
} from '@lead-fennec-ai/shared';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { loginPath } from '@/lib/links';
import { shellUser, type ShellUser } from '@/lib/shell-user';
import { serverApiGet, type ServerApiResult } from './api';

/** One API call per request, however many components ask. */
export const getSession = cache(() => serverApiGet(API.auth.session, {}));

export const getWorkspaces = cache(() => serverApiGet(API.workspaces.list, {}));

/** Not a workspace id at all: 404, the same answer as for someone else's workspace. */
export const getWorkspace = cache(
  (workspaceId: string): Promise<ServerApiResult<UserWorkspace>> =>
    serverApiGet(API.workspaces.get, { params: { workspaceId } }),
);

/** Signed out or expired: to the sign-in page, which returns to `returnTo`. */
function signInAgain(
  result: { readonly code: string | null },
  returnTo: string,
): never {
  redirect(
    loginPath(
      returnTo,
      result.code === 'session_expired' ? 'expired' : undefined,
    ),
  );
}

export type UserAccess =
  | { readonly kind: 'allowed'; readonly user: ShellUser }
  | { readonly kind: 'unavailable' };

/** For pages that need a signed-in user. */
export async function requireUser(returnTo: string): Promise<UserAccess> {
  const session = await getSession();
  if (session.ok) {
    return { kind: 'allowed', user: shellUser(session.data) };
  }
  if (session.status === 401) {
    signInAgain(session, returnTo);
  }
  return { kind: 'unavailable' };
}

export type SectionAccess =
  | {
      readonly kind: 'allowed';
      readonly user: ShellUser;
      readonly workspace: UserWorkspace;
    }
  | { readonly kind: 'forbidden'; readonly workspace: UserWorkspace }
  | { readonly kind: 'unavailable' };

/**
 * The check behind every workspace page: a session (else sign-in), an active membership in an
 * active workspace (else 404, the same for unknown and foreign workspaces), and the section's
 * permission (else forbidden).
 */
export async function requireWorkspaceSection(
  workspaceId: string,
  section: WorkspaceSection,
): Promise<SectionAccess> {
  const returnTo = workspaceSectionHref(workspaceId, section);
  const [session, workspace] = await Promise.all([
    getSession(),
    getWorkspace(workspaceId),
  ]);
  if (!session.ok) {
    if (session.status === 401) {
      signInAgain(session, returnTo);
    }
    return { kind: 'unavailable' };
  }
  if (!workspace.ok) {
    if (workspace.status === 401) {
      signInAgain(workspace, returnTo);
    }
    if (workspace.status === 404) {
      notFound();
    }
    return { kind: 'unavailable' };
  }
  return canOpenSection(section, workspace.data.membership.permissions)
    ? {
        kind: 'allowed',
        user: shellUser(session.data),
        workspace: workspace.data,
      }
    : { kind: 'forbidden', workspace: workspace.data };
}

export type AdminAccess =
  | { readonly kind: 'allowed'; readonly user: ShellUser }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unavailable' };

/**
 * For the admin area: platform admins only. The /platform API routes check it again on every
 * request, with a stated reason.
 */
export async function requirePlatformAdmin(
  returnTo: string,
): Promise<AdminAccess> {
  const access = await requireUser(returnTo);
  if (access.kind !== 'allowed') {
    return access;
  }
  return access.user.platformAdmin ? access : { kind: 'forbidden' };
}

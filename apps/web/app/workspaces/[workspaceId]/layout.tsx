'use client';

import {
  WORKSPACE_ROUTES,
  userWorkspaceSchema,
  workspaceListResponseSchema,
  type PermissionKey,
  type UserWorkspace,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { Loading, NotAvailable, Unavailable } from '@/components/page-states';
import { NativeSelect } from '@/components/ui/select';
import { ApiError, apiRequest } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useRequiredSession, useSession } from '@/lib/session';
import { WorkspaceContext, type WorkspaceContextValue } from '@/lib/workspace';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'signed_out' }
  | {
      readonly kind: 'ready';
      readonly current: UserWorkspace;
      readonly all: readonly UserWorkspace[];
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The workspace with the user's membership, and all their workspaces (for the switcher). */
async function fetchWorkspace(
  workspaceId: string,
  handleAuthError: (error: unknown) => boolean,
): Promise<Load> {
  // Not an id at all: the same answer the API gives for someone else's workspace.
  if (!UUID.test(workspaceId)) {
    return { kind: 'not_found' };
  }
  try {
    const [current, list] = await Promise.all([
      apiRequest(WORKSPACE_ROUTES.workspace(workspaceId), userWorkspaceSchema),
      apiRequest(WORKSPACE_ROUTES.workspaces, workspaceListResponseSchema),
    ]);
    return { kind: 'ready', current, all: list.items };
  } catch (error) {
    if (handleAuthError(error)) {
      return { kind: 'signed_out' };
    }
    return error instanceof ApiError && error.status === 404
      ? { kind: 'not_found' }
      : { kind: 'unavailable' };
  }
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = useRequiredSession();
  const { handleAuthError } = useSession();
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const router = useRouter();
  const pathname = usePathname();
  const switcherId = useId();
  // The result belongs to one workspace id: switching shows "loading" until the new one
  // arrives, while a reload of the same workspace keeps the page in place.
  const [result, setResult] = useState<{ id: string; load: Load } | null>(null);
  const [version, setVersion] = useState(0);
  const signedIn = session !== null;

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    let active = true;
    void fetchWorkspace(workspaceId, handleAuthError).then((load) => {
      if (active) {
        setResult({ id: workspaceId, load });
      }
    });
    return () => {
      active = false;
    };
  }, [signedIn, workspaceId, version, handleAuthError]);

  const load: Load =
    result?.id === workspaceId ? result.load : { kind: 'loading' };
  const reload = () => {
    setVersion((n) => n + 1);
  };
  let value: WorkspaceContextValue | null = null;
  if (session !== null && load.kind === 'ready') {
    const granted = new Set(load.current.membership.permissions);
    value = {
      session,
      current: load.current,
      all: load.all,
      can: (permission: PermissionKey) => granted.has(permission),
      reload,
    };
  }

  const base = WORKSPACE_ROUTES.workspace(workspaceId);
  const nav = [
    { href: base, label: 'Overview' },
    { href: `${base}/team`, label: 'Team' },
  ];

  return (
    <>
      <AppHeader>
        {value === null ? null : (
          <>
            <div className="flex items-center gap-2">
              <label
                htmlFor={switcherId}
                className="text-sm text-muted-foreground"
              >
                Workspace
              </label>
              <NativeSelect
                id={switcherId}
                className="w-56"
                value={value.current.workspace.id}
                onChange={(e) => {
                  // Same page in the other workspace.
                  router.push(
                    WORKSPACE_ROUTES.workspace(e.target.value) +
                      pathname.slice(base.length),
                  );
                }}
              >
                {value.all.map(({ workspace }) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <nav aria-label="Workspace pages" className="flex gap-1">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm hover:bg-accent',
                    pathname === item.href && 'bg-accent font-medium',
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </>
        )}
      </AppHeader>
      <main className="mx-auto max-w-5xl px-6 py-8">
        {session === null ||
        load.kind === 'loading' ||
        load.kind === 'signed_out' ? (
          <Loading />
        ) : load.kind === 'not_found' ? (
          <NotAvailable title="Workspace not found">
            <p>
              This workspace doesn&apos;t exist, or you are not an active member
              of it. Ask one of its admins for an invitation.
            </p>
          </NotAvailable>
        ) : load.kind === 'unavailable' || value === null ? (
          <Unavailable onRetry={reload} />
        ) : (
          <WorkspaceContext.Provider key={workspaceId} value={value}>
            {children}
          </WorkspaceContext.Provider>
        )}
      </main>
    </>
  );
}

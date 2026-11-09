import type { ReactNode } from 'react';
import { Unavailable } from '@/components/page-states';
import { AccessDenied } from '@/components/section-states';
import { requirePlatformAdmin } from '@/lib/server/access';

/** Server-side check for admin pages: signed in, and a platform admin. */
export async function AdminPage({
  path,
  children,
}: {
  /** The page's own path, to return to after signing in. */
  readonly path: string;
  readonly children: ReactNode;
}) {
  const access = await requirePlatformAdmin(path);
  switch (access.kind) {
    case 'unavailable':
      return <Unavailable />;
    case 'forbidden':
      return (
        <AccessDenied
          title="Platform admins only"
          backHref="/workspaces"
          backLabel="Go to your workspaces"
        >
          <p>This area is for Lead Fennec platform administrators.</p>
        </AccessDenied>
      );
    case 'allowed':
      return children;
  }
}

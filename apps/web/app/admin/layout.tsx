import type { ReactNode } from 'react';
import { AdminShell, HomeShell } from '@/components/shell/other-shells';
import { getSession } from '@/lib/server/access';
import { shellUser } from '@/lib/shell-user';

/** The admin shell for platform admins; the pages check access themselves on every request. */
export default async function AdminLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const session = await getSession();
  if (!session.ok) {
    // The page sends the visitor to sign in.
    return children;
  }
  const user = shellUser(session.data);
  return user.platformAdmin ? (
    <AdminShell user={user}>{children}</AdminShell>
  ) : (
    <HomeShell user={user} breadcrumbs={[{ label: 'Admin' }]}>
      {children}
    </HomeShell>
  );
}

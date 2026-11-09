import { WORKSPACE_ROUTES } from '@lead-fennec-ai/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Unavailable } from '@/components/page-states';
import { HomeShell } from '@/components/shell/other-shells';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/typography';
import { getWorkspaces, requireUser } from '@/lib/server/access';
import { CreateWorkspaceForm } from './create-workspace-form';

export default async function WorkspacesPage() {
  const access = await requireUser('/workspaces');
  if (access.kind !== 'allowed') {
    return (
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-lg p-6 py-16 outline-none"
      >
        <Unavailable />
      </main>
    );
  }
  const list = await getWorkspaces();
  return (
    <HomeShell user={access.user}>
      <div className="grid gap-8">
        <PageHeader
          title="Your workspaces"
          description="Each workspace has its own leads, campaigns and team."
        />
        {!list.ok ? (
          <Unavailable />
        ) : list.data.items.length === 0 ? (
          <p className="text-muted-foreground">
            You are not a member of any workspace yet. Create one below, or open
            the invitation link a colleague sent you.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" aria-label="Workspaces">
            {list.data.items.map(({ workspace, membership }) => (
              <li key={workspace.id}>
                <Link
                  href={WORKSPACE_ROUTES.workspace(workspace.id)}
                  className="flex items-center gap-3 rounded-xl border p-4 transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="grid min-w-0 flex-1 gap-2">
                    <span className="truncate font-medium">
                      {workspace.name}
                    </span>
                    <Badge variant="secondary">{membership.role.name}</Badge>
                  </span>
                  <ChevronRight
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <CreateWorkspaceForm />
      </div>
    </HomeShell>
  );
}

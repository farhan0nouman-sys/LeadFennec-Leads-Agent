import {
  WORKSPACE_ROUTES,
  type UserWorkspace,
  type WorkspaceSection,
} from '@lead-fennec-ai/shared';
import type { ReactNode } from 'react';
import { Unavailable } from '@/components/page-states';
import { AccessDenied } from '@/components/section-states';
import { requireWorkspaceSection } from '@/lib/server/access';

/**
 * Runs the server-side check for a workspace page, then renders it: signed out → sign-in,
 * not a member → 404, no permission → access denied. Only an allowed member gets `render`.
 */
export async function WorkspacePage({
  workspaceId,
  section,
  render,
}: {
  readonly workspaceId: string;
  readonly section: WorkspaceSection;
  readonly render: (workspace: UserWorkspace) => ReactNode;
}) {
  const access = await requireWorkspaceSection(workspaceId, section);
  switch (access.kind) {
    case 'unavailable':
      return <Unavailable />;
    case 'forbidden':
      return (
        <AccessDenied
          backHref={WORKSPACE_ROUTES.workspace(workspaceId)}
          backLabel="Go to the workspace overview"
        >
          <p>
            Your role in {access.workspace.workspace.name} doesn&apos;t include{' '}
            {section.label}.
          </p>
          <p>Ask a workspace admin if you need it.</p>
        </AccessDenied>
      );
    case 'allowed':
      return render(access.workspace);
  }
}

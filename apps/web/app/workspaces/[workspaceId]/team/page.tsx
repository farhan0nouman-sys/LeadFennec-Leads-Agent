import { findWorkspaceSection } from '@lead-fennec-ai/shared';
import { WorkspacePage } from '../workspace-page';
import { TeamPanel } from './team-panel';

const team = findWorkspaceSection('team');

export default async function TeamPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (team === undefined) {
    throw new Error('The team section is missing from the registry');
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={team}
      render={() => <TeamPanel />}
    />
  );
}

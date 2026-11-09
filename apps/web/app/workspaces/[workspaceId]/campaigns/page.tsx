import { findWorkspaceSection } from '@lead-fennec-ai/shared';
import { WorkspacePage } from '../workspace-page';
import { CampaignList } from './campaign-list';

const campaigns = findWorkspaceSection('campaigns');

/** The Campaigns page (task 06B): the server checks access, then the list renders. */
export default async function CampaignsPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (campaigns === undefined) {
    throw new Error('The campaigns section is missing from the registry');
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={campaigns}
      render={() => <CampaignList />}
    />
  );
}

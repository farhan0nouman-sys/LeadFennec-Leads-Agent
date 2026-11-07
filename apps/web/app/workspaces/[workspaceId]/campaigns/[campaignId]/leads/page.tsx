import { API, findWorkspaceSection } from '@lead-fennec-ai/shared';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CampaignLeads } from '@/components/qualification/campaign-leads';
import { Skeleton } from '@/components/ui/skeleton';
import { serverApiGet } from '@/lib/server/api';
import { WorkspacePage } from '../../../workspace-page';

const campaigns = findWorkspaceSection('campaigns');

/**
 * A campaign's leads with their score and qualification (task 10C). The Campaigns section's
 * check first (campaigns.read); an unknown campaign, or one of another workspace, is a real 404.
 */
export default async function CampaignLeadsPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string; campaignId: string }>;
}) {
  const { workspaceId, campaignId } = await params;
  if (campaigns === undefined) {
    throw new Error('The campaigns section is missing from the registry');
  }
  const found = await serverApiGet(API.campaigns.get, {
    params: { workspaceId, campaignId },
  });
  if (!found.ok && found.status === 404) {
    notFound();
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={campaigns}
      render={() => (
        <Suspense fallback={<Skeleton className="h-64" />}>
          <CampaignLeads campaignId={campaignId} />
        </Suspense>
      )}
    />
  );
}

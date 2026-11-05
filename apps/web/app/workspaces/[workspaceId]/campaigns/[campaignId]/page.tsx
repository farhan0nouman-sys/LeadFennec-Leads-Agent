import { API, findWorkspaceSection } from '@lead-fennec-ai/shared';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CampaignWizard } from '@/components/campaigns/campaign-wizard';
import { Skeleton } from '@/components/ui/skeleton';
import { serverApiGet } from '@/lib/server/api';
import { WorkspacePage } from '../../workspace-page';

const campaigns = findWorkspaceSection('campaigns');

/**
 * One campaign's setup wizard (task 06B). An unknown campaign, or one of another workspace, is
 * a real 404, like an unknown workspace; everything else is the section's usual check.
 */
export default async function CampaignSetupPage({
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
          <CampaignWizard campaignId={campaignId} />
        </Suspense>
      )}
    />
  );
}

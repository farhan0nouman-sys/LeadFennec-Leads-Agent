import { API, findWorkspaceSection } from '@lead-fennec-ai/shared';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { LeadQualification } from '@/components/qualification/lead-qualification';
import { Skeleton } from '@/components/ui/skeleton';
import { serverApiGet } from '@/lib/server/api';
import { WorkspacePage } from '../../../../workspace-page';

const campaigns = findWorkspaceSection('campaigns');

/**
 * One lead of a campaign: fit, eligibility and qualification, apart (task 10C). The Campaigns
 * section's check first (campaigns.read); an unknown campaign or person, or one of another
 * workspace, is a real 404.
 */
export default async function LeadQualificationPage({
  params,
}: {
  readonly params: Promise<{
    workspaceId: string;
    campaignId: string;
    contactId: string;
  }>;
}) {
  const { workspaceId, campaignId, contactId } = await params;
  if (campaigns === undefined) {
    throw new Error('The campaigns section is missing from the registry');
  }
  const found = await serverApiGet(API.qualification.lead, {
    params: { workspaceId, campaignId, contactId },
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
          <LeadQualification campaignId={campaignId} contactId={contactId} />
        </Suspense>
      )}
    />
  );
}

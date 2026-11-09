import { API, findWorkspaceSection } from '@lead-fennec-ai/shared';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { LeadProfile } from '@/components/leads/lead-profile';
import { Skeleton } from '@/components/ui/skeleton';
import { serverApiGet } from '@/lib/server/api';
import { WorkspacePage } from '../../workspace-page';

const leads = findWorkspaceSection('leads');

/**
 * One lead's profile (task 11B). The Leads section's check first (contacts.read); an unknown
 * person, or one of another workspace, is a real 404.
 */
export default async function LeadProfilePage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string; contactId: string }>;
}) {
  const { workspaceId, contactId } = await params;
  if (leads === undefined) {
    throw new Error('The leads section is missing from the registry');
  }
  const found = await serverApiGet(API.leads.lead, {
    params: { workspaceId, contactId },
  });
  if (!found.ok && found.status === 404) {
    notFound();
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={leads}
      render={() => (
        <Suspense fallback={<Skeleton className="h-64" />}>
          <LeadProfile contactId={contactId} />
        </Suspense>
      )}
    />
  );
}

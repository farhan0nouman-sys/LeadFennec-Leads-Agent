import { findWorkspaceSection } from '@lead-fennec-ai/shared';
import { Suspense } from 'react';
import { LeadList } from '@/components/leads/lead-list';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspacePage } from '../workspace-page';

const leads = findWorkspaceSection('leads');

/**
 * The workspace's leads (tasks 11A and 11B): the Leads section's check first (contacts.read),
 * then the search. A company's profile (task 09C) and a lead's profile sit below this folder.
 */
export default async function LeadsPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (leads === undefined) {
    throw new Error('The leads section is missing from the registry');
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={leads}
      render={() => (
        <Suspense fallback={<Skeleton className="h-64" />}>
          <LeadList />
        </Suspense>
      )}
    />
  );
}

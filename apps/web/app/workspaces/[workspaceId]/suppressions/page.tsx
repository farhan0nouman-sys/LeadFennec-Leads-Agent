import { findWorkspaceSection } from '@lead-fennec-ai/shared';
import { Suspense } from 'react';
import { SuppressionList } from '@/components/suppressions/suppression-list';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspacePage } from '../workspace-page';

const suppressions = findWorkspaceSection('suppressions');

/**
 * The do-not-contact list (task 11C): the section's check first (suppressions.manage), then the
 * list, its forms and deletion requests.
 */
export default async function SuppressionsPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (suppressions === undefined) {
    throw new Error('The suppressions section is missing from the registry');
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={suppressions}
      render={() => (
        <Suspense fallback={<Skeleton className="h-64" />}>
          <SuppressionList />
        </Suspense>
      )}
    />
  );
}

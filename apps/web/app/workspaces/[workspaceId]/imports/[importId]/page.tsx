import { API, findWorkspaceSection } from '@lead-fennec-ai/shared';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { RunView } from '@/components/imports/run-view';
import { Skeleton } from '@/components/ui/skeleton';
import { serverApiGet } from '@/lib/server/api';
import { WorkspacePage } from '../../workspace-page';

const imports = findWorkspaceSection('imports');

/**
 * One import or search (task 07C). An unknown run, or one of another workspace, is a real 404;
 * everything else is the section's usual check.
 */
export default async function ImportRunPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string; importId: string }>;
}) {
  const { workspaceId, importId } = await params;
  if (imports === undefined) {
    throw new Error('The imports section is missing from the registry');
  }
  const found = await serverApiGet(API.discovery.get, {
    params: { workspaceId, importId },
  });
  if (!found.ok && found.status === 404) {
    notFound();
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={imports}
      render={() => (
        <Suspense fallback={<Skeleton className="h-64" />}>
          <RunView importId={importId} />
        </Suspense>
      )}
    />
  );
}

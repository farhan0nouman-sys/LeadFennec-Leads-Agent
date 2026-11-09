import { API, findWorkspaceSection } from '@lead-fennec-ai/shared';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CompanyResearch } from '@/components/research/company-research';
import { Skeleton } from '@/components/ui/skeleton';
import { serverApiGet } from '@/lib/server/api';
import { WorkspacePage } from '../../../workspace-page';

const leads = findWorkspaceSection('leads');

/**
 * A company's profile with its website research (task 09C). The Leads section's check first
 * (contacts.read); an unknown company, or one of another workspace, is a real 404.
 */
export default async function CompanyProfilePage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string; organizationId: string }>;
}) {
  const { workspaceId, organizationId } = await params;
  if (leads === undefined) {
    throw new Error('The leads section is missing from the registry');
  }
  const found = await serverApiGet(API.research.organization, {
    params: { workspaceId, organizationId },
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
          <CompanyResearch organizationId={organizationId} />
        </Suspense>
      )}
    />
  );
}

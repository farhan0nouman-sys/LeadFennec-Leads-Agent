import { findWorkspaceSection } from '@lead-fennec-ai/shared';
import { UnavailableSection } from '@/components/section-states';
import { WorkspacePage } from '../workspace-page';

const leads = findWorkspaceSection('leads');

/**
 * The Leads list isn't built yet (packages/shared/src/navigation.ts): the same shell as every
 * unavailable section. This folder exists because a company's profile sits below it (task 09C),
 * and a static folder takes the path from the [section] route.
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
        <UnavailableSection
          title={leads.label}
          description={leads.description}
          primaryAction={leads.primaryAction}
        />
      )}
    />
  );
}

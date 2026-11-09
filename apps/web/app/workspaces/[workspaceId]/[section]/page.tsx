import { workspaceSectionByPath } from '@lead-fennec-ai/shared';
import { notFound } from 'next/navigation';
import { UnavailableSection } from '@/components/section-states';
import { WorkspacePage } from '../workspace-page';

/**
 * Every section that isn't built yet (packages/shared/src/navigation.ts): the same server-side
 * check as a real page, then a shell that says the page isn't available. Built sections have
 * their own folders (team), which take precedence over this route.
 */
export default async function UnavailableSectionPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string; section: string }>;
}) {
  const { workspaceId, section: path } = await params;
  const section = workspaceSectionByPath(path);
  if (section?.status !== 'unavailable') {
    notFound();
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={section}
      render={() => (
        <UnavailableSection
          title={section.label}
          description={section.description}
          primaryAction={section.primaryAction}
        />
      )}
    />
  );
}

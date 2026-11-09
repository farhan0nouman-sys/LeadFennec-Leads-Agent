import {
  PERMISSION_CATALOG,
  canOpenSection,
  findWorkspaceSection,
  workspaceNavigation,
  workspaceSectionHref,
  type UserWorkspace,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import {
  CampaignMetrics,
  LeadMetrics,
} from '@/components/dashboard/metric-panels';
import { IntegrationHealth } from '@/components/dashboard/integration-health';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { ErrorBoundary } from '@/components/feedback/error-boundary';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/typography';
import { iconFor } from '@/components/shell/section-icons';
import { WorkspacePage } from './workspace-page';

const overview = findWorkspaceSection('overview');

/**
 * The dashboard panels a member sees: each one reads the API of the section that owns its data
 * with that section's permission (task 05C, D-05C-01), so a panel appears exactly when the
 * member could open the section itself.
 */
function dashboardPanels(membership: UserWorkspace['membership']) {
  const opens = (key: string) => {
    const section = findWorkspaceSection(key);
    return (
      section !== undefined && canOpenSection(section, membership.permissions)
    );
  };
  return {
    leads: opens('leads'),
    campaigns: opens('campaigns'),
    activity: opens('audit'),
    integrations: opens('integrations'),
  };
}

export default async function WorkspaceOverviewPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (overview === undefined) {
    throw new Error('The overview section is missing from the registry');
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={overview}
      render={({ workspace, membership }) => {
        const panels = dashboardPanels(membership);
        const granted = PERMISSION_CATALOG.filter((p) =>
          membership.permissions.includes(p.key),
        );
        const sections = workspaceNavigation(membership.permissions)
          .flatMap((group) => group.sections)
          .filter(
            (s) =>
              s.key !== 'overview' && canOpenSection(s, membership.permissions),
          );
        return (
          <div className="grid gap-8">
            <PageHeader
              title={workspace.name}
              description={
                <>
                  You are a{' '}
                  <Badge variant="secondary">{membership.role.name}</Badge> in
                  this workspace.
                </>
              }
            />
            {Object.values(panels).some(Boolean) ? (
              <div className="grid gap-6">
                {panels.leads ? (
                  <ErrorBoundary title="The lead counts couldn't be shown">
                    <LeadMetrics workspaceId={workspace.id} />
                  </ErrorBoundary>
                ) : null}
                {panels.campaigns ? (
                  <ErrorBoundary title="The campaign counts couldn't be shown">
                    <CampaignMetrics workspaceId={workspace.id} />
                  </ErrorBoundary>
                ) : null}
                {panels.activity || panels.integrations ? (
                  <div className="grid items-start gap-6 lg:grid-cols-2">
                    {panels.activity ? (
                      <ErrorBoundary title="The recent activity couldn't be shown">
                        <RecentActivity workspaceId={workspace.id} />
                      </ErrorBoundary>
                    ) : null}
                    {panels.integrations ? (
                      <ErrorBoundary title="The integration health couldn't be shown">
                        <IntegrationHealth workspaceId={workspace.id} />
                      </ErrorBoundary>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your role doesn&apos;t include leads, campaigns, the audit log
                or integrations, so there are no counts to show here.
              </p>
            )}
            <section aria-labelledby="sections-heading" className="grid gap-3">
              <h2 id="sections-heading" className="text-lg font-semibold">
                Your pages
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sections.map((s) => {
                  const Icon = iconFor(s.key);
                  return (
                    <li key={s.key}>
                      <Link
                        href={workspaceSectionHref(workspace.id, s)}
                        className="grid h-full gap-1.5 rounded-xl border p-4 transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Icon className="size-4" aria-hidden="true" />
                          {s.label}
                          {s.status === 'unavailable' ? (
                            <Badge variant="outline" className="ml-auto">
                              Not available yet
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {s.description}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
            <details className="group rounded-xl border p-4">
              <summary className="cursor-pointer font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                What your role lets you do
              </summary>
              <ul
                className="mt-3 grid list-disc gap-1 pl-5 text-sm sm:grid-cols-2"
                aria-label="Your permissions"
              >
                {granted.map((permission) => (
                  <li key={permission.key}>{permission.description}</li>
                ))}
              </ul>
            </details>
          </div>
        );
      }}
    />
  );
}

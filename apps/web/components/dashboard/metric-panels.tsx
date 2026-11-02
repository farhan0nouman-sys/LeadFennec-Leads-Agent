'use client';

import {
  API,
  CAMPAIGN_STATUSES,
  DASHBOARD_METRICS,
  type DashboardMetric,
} from '@lead-fennec-ai/shared';
import { RetryState } from '@/components/feedback/retry-state';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCount } from '@/lib/format';
import { useApiQuery } from '@/lib/query';
import { DashboardPanel, PanelFooter } from './dashboard-panel';

/** Counts refresh when the dashboard opens, after changes, and on request (D-05C-04). */
const COUNTS_SCHEDULE = 'Counts refresh when you open this page.';

/**
 * The metrics of one group as a description list: available ones with their count (or a
 * placeholder while loading), unavailable ones saying so instead of a number.
 */
function MetricList({
  metrics,
  values,
  failed,
}: {
  readonly metrics: readonly DashboardMetric[];
  /** The group's summary; undefined while it loads or when it failed. */
  readonly values: Readonly<Record<string, unknown>> | undefined;
  /** Loading failed: no placeholder that looks like it is still loading. */
  readonly failed: boolean;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {metrics.map((metric) => {
        const value = values?.[metric.key];
        return (
          <div
            key={metric.key}
            data-metric={metric.key}
            data-status={metric.status}
            className="grid content-start gap-1 rounded-lg border p-3 data-[status=unavailable]:border-dashed"
          >
            <dt className="text-sm font-medium text-muted-foreground">
              {metric.label}
            </dt>
            {metric.status === 'unavailable' ? (
              <dd>
                <Badge variant="outline" className="whitespace-normal">
                  Not available yet
                </Badge>
              </dd>
            ) : typeof value === 'number' ? (
              <dd className="text-2xl font-semibold tabular-nums">
                {formatCount(value)}
              </dd>
            ) : failed ? (
              <dd className="text-2xl font-semibold text-muted-foreground">
                <span aria-hidden="true">–</span>
                <span className="sr-only">Not loaded</span>
              </dd>
            ) : (
              <dd>
                <Skeleton className="h-8 w-16" />
                <span className="sr-only">Loading</span>
              </dd>
            )}
            <dd className="text-xs text-muted-foreground">
              {metric.description}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const leadMetrics = DASHBOARD_METRICS.filter((m) => m.group === 'leads');
const campaignMetrics = DASHBOARD_METRICS.filter(
  (m) => m.group === 'campaigns',
);

export function LeadMetrics({ workspaceId }: { readonly workspaceId: string }) {
  const query = useApiQuery(API.dashboard.leadSummary, {
    params: { workspaceId },
  });
  return (
    <DashboardPanel
      id="dashboard-leads"
      title="Leads"
      description="Contacts and companies in this workspace."
      busy={query.status === 'loading' || query.refreshing}
      footer={
        <PanelFooter
          title="Leads"
          generatedAt={query.data?.generatedAt}
          refreshing={query.status === 'loading' || query.refreshing}
          schedule={COUNTS_SCHEDULE}
          polling={query.polling}
          onRefresh={query.status === 'error' ? undefined : query.retry}
        />
      }
    >
      {query.status === 'error' ? (
        <RetryState
          title="We couldn't load the lead counts"
          error={query.error}
          onRetry={query.retry}
        />
      ) : null}
      <MetricList
        metrics={leadMetrics}
        values={query.data}
        failed={query.status === 'error'}
      />
    </DashboardPanel>
  );
}

const CAMPAIGN_STATUS_LABELS: Readonly<
  Record<(typeof CAMPAIGN_STATUSES)[number], string>
> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function CampaignMetrics({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const query = useApiQuery(API.dashboard.campaignSummary, {
    params: { workspaceId },
  });
  const byStatus = query.data?.campaignsByStatus;
  return (
    <DashboardPanel
      id="dashboard-campaigns"
      title="Campaigns"
      description="Campaigns and the leads moving through them."
      busy={query.status === 'loading' || query.refreshing}
      footer={
        <PanelFooter
          title="Campaigns"
          generatedAt={query.data?.generatedAt}
          refreshing={query.status === 'loading' || query.refreshing}
          schedule={COUNTS_SCHEDULE}
          polling={query.polling}
          onRefresh={query.status === 'error' ? undefined : query.retry}
        />
      }
    >
      {query.status === 'error' ? (
        <RetryState
          title="We couldn't load the campaign counts"
          error={query.error}
          onRetry={query.retry}
        />
      ) : null}
      <MetricList
        metrics={campaignMetrics}
        values={query.data}
        failed={query.status === 'error'}
      />
      {byStatus === undefined ? null : (
        <div className="grid gap-1.5">
          <h3 id="campaign-status-heading" className="text-sm font-medium">
            Campaigns by status
          </h3>
          <dl
            aria-labelledby="campaign-status-heading"
            className="flex flex-wrap gap-x-5 gap-y-1 text-sm"
          >
            {CAMPAIGN_STATUSES.map((status) => (
              <div key={status} className="flex gap-1.5">
                <dt className="text-muted-foreground">
                  {CAMPAIGN_STATUS_LABELS[status]}
                </dt>
                <dd className="font-medium tabular-nums">
                  {formatCount(byStatus[status])}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </DashboardPanel>
  );
}

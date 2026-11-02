'use client';

import { API, activityLabel, type ActivityItem } from '@lead-fennec-ai/shared';
import { History } from 'lucide-react';
import { EmptyState } from '@/components/feedback/empty-state';
import { RetryState } from '@/components/feedback/retry-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCount, formatDateTime, formatRelativeTime } from '@/lib/format';
import { ACTIVITY_POLL } from '@/lib/polling';
import { useApiQuery } from '@/lib/query';
import { DashboardPanel, PanelFooter } from './dashboard-panel';

const TITLE = 'Recent activity';

/** Who acted, in words. Names are user-chosen text: rendered as text, never as markup. */
function actorName(actor: ActivityItem['actor']): string {
  switch (actor.kind) {
    case 'member':
      return actor.name ?? 'A member';
    case 'former_member':
      return 'A former member';
    case 'platform_admin':
      return 'Lead Fennec support';
    case 'system':
      return 'Lead Fennec (automatic)';
  }
}

/**
 * The latest changes in the workspace, from its audit records (audit.read). Refreshes every
 * minute while the page is visible, for at most 30 minutes (lib/polling.ts).
 */
export function RecentActivity({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const query = useApiQuery(
    API.dashboard.activity,
    { params: { workspaceId } },
    { poll: ACTIVITY_POLL },
  );
  const data = query.data;
  return (
    <DashboardPanel
      id="dashboard-activity"
      title={TITLE}
      description="Changes to this workspace, newest first."
      busy={query.status === 'loading' || query.refreshing}
      footer={
        <PanelFooter
          title={TITLE}
          generatedAt={data?.generatedAt}
          refreshing={query.status === 'loading' || query.refreshing}
          schedule="Updates every minute while this page is open."
          polling={query.polling}
          onRefresh={query.status === 'error' ? undefined : query.retry}
        />
      }
    >
      {query.status === 'error' ? (
        <RetryState
          title="We couldn't load the recent activity"
          error={query.error}
          onRetry={query.retry}
        />
      ) : null}
      {data === undefined ? (
        query.status === 'loading' ? (
          <div className="grid gap-3">
            <span className="sr-only">Loading recent activity</span>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-10" />
            ))}
          </div>
        ) : null
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['last24Hours', 'Last 24 hours'],
                ['last7Days', 'Last 7 days'],
                ['last30Days', 'Last 30 days'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="grid gap-0.5 rounded-lg border p-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatCount(data.counts[key])}
                </dd>
              </div>
            ))}
          </dl>
          {data.items.length === 0 ? (
            <EmptyState
              icon={History}
              title="No activity yet"
              description="Invitations, role changes and other changes to this workspace will appear here."
            />
          ) : (
            <ol aria-label="Latest changes" className="grid">
              {data.items.map((item) => (
                <li
                  key={item.id}
                  data-action={item.action}
                  className="grid gap-0.5 border-b py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <p className="text-sm">
                    <span className="font-medium">{actorName(item.actor)}</span>{' '}
                    {activityLabel(item.action)}
                  </p>
                  {item.reason === null ? null : (
                    <p className="text-xs break-words text-muted-foreground">
                      Reason: {item.reason}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    <time
                      dateTime={item.occurredAt}
                      title={formatDateTime(item.occurredAt)}
                    >
                      {formatRelativeTime(item.occurredAt, data.generatedAt)}
                    </time>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </DashboardPanel>
  );
}

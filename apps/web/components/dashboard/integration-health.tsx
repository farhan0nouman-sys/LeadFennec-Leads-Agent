'use client';

import {
  API,
  HEALTH_PROVIDERS,
  type IntegrationHealthItem,
} from '@lead-fennec-ai/shared';
import { Status } from '@/components/data/status-label';
import { RetryState } from '@/components/feedback/retry-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCount, formatRelativeTime } from '@/lib/format';
import { HEALTH_POLL } from '@/lib/polling';
import { useApiQuery } from '@/lib/query';
import { DashboardPanel, PanelFooter } from './dashboard-panel';

const TITLE = 'Integration health';

const plural = (count: number, one: string, many: string) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

/** What is behind the state, in a few words. */
function details(item: IntegrationHealthItem, now: string): string {
  const parts: string[] = [];
  const mailboxes = item.mailboxes;
  if (mailboxes !== null) {
    const connected = mailboxes.ACTIVE + mailboxes.PAUSED;
    if (connected > 0) {
      parts.push(plural(connected, 'connected mailbox', 'connected mailboxes'));
    }
    if (mailboxes.PENDING > 0) {
      parts.push(`${formatCount(mailboxes.PENDING)} waiting for authorization`);
    }
    if (mailboxes.ERROR > 0) {
      parts.push(
        plural(mailboxes.ERROR, 'needs reconnecting', 'need reconnecting'),
      );
    }
  }
  if (item.failingSyncs > 0) {
    parts.push(plural(item.failingSyncs, 'sync failing', 'syncs failing'));
  } else if (item.lastSyncedAt !== null) {
    parts.push(`last sync ${formatRelativeTime(item.lastSyncedAt, now)}`);
  }
  if (item.failedEventsLast24Hours > 0) {
    parts.push(
      `${plural(item.failedEventsLast24Hours, 'notification', 'notifications')} failed in the last 24 hours`,
    );
  }
  if (parts.length === 0) {
    return item.state === 'not_connected'
      ? 'Not connected to this workspace.'
      : 'Connected.';
  }
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * Mailboxes, syncs and failed provider notifications of each integration (settings.manage).
 * Refreshes every 2 minutes while the page is visible, for at most 30 minutes (lib/polling.ts).
 */
export function IntegrationHealth({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const query = useApiQuery(
    API.dashboard.integrationHealth,
    { params: { workspaceId } },
    { poll: HEALTH_POLL },
  );
  const data = query.data;
  return (
    <DashboardPanel
      id="dashboard-integrations"
      title={TITLE}
      description="Connected mailboxes and data providers. AI, email verification and billing are run by Lead Fennec and aren't listed here."
      busy={query.status === 'loading' || query.refreshing}
      footer={
        <PanelFooter
          title={TITLE}
          generatedAt={data?.generatedAt}
          refreshing={query.status === 'loading' || query.refreshing}
          schedule="Updates every 2 minutes while this page is open."
          polling={query.polling}
          onRefresh={query.status === 'error' ? undefined : query.retry}
        />
      }
    >
      {query.status === 'error' ? (
        <RetryState
          title="We couldn't check the integrations"
          error={query.error}
          onRetry={query.retry}
        />
      ) : null}
      {data === undefined ? (
        query.status === 'loading' ? (
          <div className="grid gap-3">
            <span className="sr-only">Loading integration health</span>
            {HEALTH_PROVIDERS.map((entry) => (
              <Skeleton key={entry.provider} className="h-12" />
            ))}
          </div>
        ) : null
      ) : (
        <ul className="grid gap-2">
          {data.items.map((item) => {
            const label =
              HEALTH_PROVIDERS.find((p) => p.provider === item.provider)
                ?.label ?? item.provider;
            return (
              <li
                key={item.provider}
                data-provider={item.provider}
                data-state={item.state}
                className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-lg border p-3"
              >
                <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
                  <p className="font-medium">{label}</p>
                  <p className="text-sm text-muted-foreground">
                    {details(item, data.generatedAt)}
                  </p>
                </div>
                <Status kind="integration" value={item.state} />
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}

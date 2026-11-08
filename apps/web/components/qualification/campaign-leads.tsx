'use client';

// A campaign's leads (task 10C, docs/decisions.md D-10C-*): the people on its lead list, each
// with their current score and qualification, linking to the lead's page. Names, titles and
// companies come from imports and providers: untrusted text, shown as text only.
import { API, type LeadListItem } from '@lead-fennec-ai/shared';
import { ArrowLeft, Users } from 'lucide-react';
import Link from 'next/link';
import { campaignHref } from '@/components/campaigns/campaign-wizard';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { CursorPagination } from '@/components/data/pagination';
import { Status } from '@/components/data/status-label';
import { EmptyState } from '@/components/feedback/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/typography';
import { leadHref } from '@/lib/qualification';
import { useApiQuery } from '@/lib/query';
import { useCursorTrail } from '@/lib/use-list-params';
import { useWorkspace } from '@/lib/workspace';

const PAGE_SIZE = 25;

export function CampaignLeads({ campaignId }: { readonly campaignId: string }) {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const pages = useCursorTrail(`${workspaceId}:${campaignId}`);
  const campaign = useApiQuery(API.campaigns.get, {
    params: { workspaceId, campaignId },
  });
  const leads = useApiQuery(API.qualification.leads, {
    params: { workspaceId, campaignId },
    query: {
      limit: PAGE_SIZE,
      ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
    },
  });
  const nextCursor = leads.data?.nextCursor ?? null;
  const columns: DataColumn<LeadListItem>[] = [
    {
      key: 'name',
      header: 'Person',
      rowHeader: true,
      cell: (item) => (
        <Link
          href={leadHref(workspaceId, campaignId, item.id)}
          className="font-medium underline underline-offset-4"
        >
          {item.name ?? 'Unnamed person'}
        </Link>
      ),
    },
    { key: 'title', header: 'Title', cell: (item) => item.title ?? '—' },
    { key: 'company', header: 'Company', cell: (item) => item.company ?? '—' },
    {
      key: 'quality',
      header: 'Contact data',
      cell: (item) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Status kind="contactQuality" value={item.quality.level} />
          {item.quality.emailState === null ? null : (
            <Status kind="emailState" value={item.quality.emailState} />
          )}
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      cell: (item) =>
        item.score === null ? (
          <span className="text-muted-foreground">Not scored</span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="tabular-nums">{item.score.value}</span>
            <Status kind="scoreBand" value={item.score.band} />
          </span>
        ),
    },
    {
      key: 'state',
      header: 'Qualification',
      cell: (item) =>
        item.state === null ? (
          <span className="text-muted-foreground">Not qualified yet</span>
        ) : (
          <Status kind="qualification" value={item.state} />
        ),
    },
  ];
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          campaign.data === undefined
            ? 'Campaign leads'
            : `Leads of ${campaign.data.name}`
        }
        description="Each lead's fit and qualification. Open a lead to see why, with the evidence, and whether it may be emailed."
        actions={
          <Link
            href={campaignHref(workspaceId, campaignId)}
            className={buttonVariants({ variant: 'outline' })}
          >
            <ArrowLeft aria-hidden="true" />
            Campaign setup
          </Link>
        }
      />
      <DataTable
        label="Leads"
        columns={columns}
        rows={leads.data?.items}
        rowKey={(item) => item.id}
        status={leads.status}
        error={leads.error}
        onRetry={leads.retry}
        refreshing={leads.refreshing}
        empty={
          <EmptyState
            icon={Users}
            title={
              leads.data?.leadListId === null
                ? 'This campaign has no lead list yet'
                : 'The lead list is empty'
            }
            description={
              leads.data?.leadListId === null
                ? "Choose a lead list in the setup's Target audience step; its people become the campaign's leads."
                : 'Add people to the lead list, for example with an import.'
            }
          />
        }
        footer={
          <CursorPagination
            label="Leads"
            page={pages.page}
            hasPrevious={pages.hasPrevious}
            hasNext={nextCursor !== null}
            onPrevious={pages.previous}
            onNext={() => {
              if (nextCursor !== null) {
                pages.next(nextCursor);
              }
            }}
            disabled={leads.status === 'loading'}
          />
        }
      />
    </div>
  );
}

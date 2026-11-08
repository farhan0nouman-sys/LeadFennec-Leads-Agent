'use client';

// The workspace's leads (tasks 11A and 11B, docs/decisions.md D-11A-*): searched through the
// lead search API with its allowlisted filters and sorts, one page at a time. The search, its
// filters and its sort live in the address bar (validated). Names, titles and companies come
// from imports and providers: untrusted text, shown as text only.
import {
  API,
  LEAD_VERIFICATION_FILTERS,
  type LeadSearchItem,
} from '@lead-fennec-ai/shared';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import {
  FilterSelect,
  ListFilters,
  SearchField,
} from '@/components/data/list-filters';
import { CursorPagination } from '@/components/data/pagination';
import { Status } from '@/components/data/status-label';
import { EmptyState } from '@/components/feedback/empty-state';
import { PageHeader } from '@/components/ui/typography';
import { formatDateTime } from '@/lib/format';
import { leadProfileHref } from '@/lib/leads';
import { useApiQuery } from '@/lib/query';
import { useCursorTrail, useListParams } from '@/lib/use-list-params';
import { useWorkspace } from '@/lib/workspace';

const PAGE_SIZE = 25;
const SORTS = ['created', 'activity', 'name', 'company'] as const;

const viewSchema = z.object({
  q: z.string().trim().max(100).catch(''),
  verification: z.enum(LEAD_VERIFICATION_FILTERS).or(z.literal('')).catch(''),
  sort: z.enum(SORTS).catch('created'),
});

const SORT_LABELS: Readonly<Record<(typeof SORTS)[number], string>> = {
  created: 'Newest first',
  activity: 'Recent activity first',
  name: 'Name, A to Z',
  company: 'Company, A to Z',
};

const VERIFICATION_LABELS: Readonly<
  Record<(typeof LEAD_VERIFICATION_FILTERS)[number], string>
> = {
  verified: 'Verified',
  risky: 'Risky',
  unknown: 'Unknown',
  invalid: 'Invalid',
  unchecked: 'Never checked',
  no_address: 'No address',
};

export function LeadList() {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const view = useListParams(viewSchema);
  const pages = useCursorTrail(`${workspaceId}:${view.viewKey}`);
  const { q, verification, sort } = view.values;
  const leads = useApiQuery(API.leads.search, {
    params: { workspaceId },
    query: {
      limit: PAGE_SIZE,
      sort,
      order: sort === 'name' || sort === 'company' ? 'asc' : 'desc',
      ...(q.length >= 2 ? { q } : {}),
      ...(verification === '' ? {} : { verification }),
      ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
    },
  });
  const nextCursor = leads.data?.nextCursor ?? null;
  const columns: DataColumn<LeadSearchItem>[] = [
    {
      key: 'name',
      header: 'Person',
      rowHeader: true,
      cell: (item) => (
        <Link
          href={leadProfileHref(workspaceId, item.id)}
          className="font-medium underline underline-offset-4"
        >
          {item.name ?? item.email ?? 'Unnamed person'}
        </Link>
      ),
    },
    { key: 'title', header: 'Title', cell: (item) => item.title ?? '—' },
    {
      key: 'company',
      header: 'Company',
      cell: (item) => item.company?.name ?? '—',
    },
    {
      key: 'country',
      header: 'Country',
      cell: (item) => item.countryCode ?? '—',
    },
    {
      key: 'check',
      header: 'Address check',
      cell: (item) =>
        item.verification === null ? (
          <span className="text-muted-foreground">
            {item.email === null ? 'No address' : 'Never checked'}
          </span>
        ) : (
          <Status kind="emailCheck" value={item.verification.status} />
        ),
    },
    {
      key: 'score',
      header: 'Best score',
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
      key: 'activity',
      header: 'Last activity',
      cell: (item) => formatDateTime(item.lastActivityAt),
    },
  ];
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Leads"
        description="The workspace's people: where each came from, how good the data is, and the campaigns they're in."
      />
      <ListFilters
        label="Find leads"
        filtered={view.filtered}
        onClear={view.clear}
      >
        <SearchField
          label="Search"
          placeholder="Name, address, title or company"
          value={q}
          onSearch={(text) => {
            view.update({ q: text });
          }}
        />
        <FilterSelect
          label="Address check"
          value={verification}
          allLabel="Any address check"
          options={LEAD_VERIFICATION_FILTERS.map((value) => ({
            value,
            label: VERIFICATION_LABELS[value],
          }))}
          onChange={(value) => {
            view.update({
              verification: value as z.output<
                typeof viewSchema
              >['verification'],
            });
          }}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          allLabel={SORT_LABELS.created}
          options={SORTS.filter((value) => value !== 'created').map(
            (value) => ({ value, label: SORT_LABELS[value] }),
          )}
          onChange={(value) => {
            view.update({
              sort: (value === '' ? 'created' : value) as z.output<
                typeof viewSchema
              >['sort'],
            });
          }}
        />
      </ListFilters>
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
          view.filtered ? (
            <p className="text-sm text-muted-foreground">
              No leads match these filters.
            </p>
          ) : (
            <EmptyState
              icon={Users}
              title="No leads yet"
              description="Leads appear when an import or a people search saves them."
            />
          )
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
          />
        }
      />
    </div>
  );
}

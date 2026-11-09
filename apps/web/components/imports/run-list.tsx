'use client';

// The workspace's imports and searches, newest first (task 07C).
import { API, type ImportRun } from '@lead-fennec-ai/shared';
import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { CursorPagination } from '@/components/data/pagination';
import { Status } from '@/components/data/status-label';
import { EmptyState } from '@/components/feedback/empty-state';
import { formatCount } from '@/lib/format';
import { runTitle } from '@/lib/imports';
import { useApiQuery } from '@/lib/query';
import { useCursorTrail } from '@/lib/use-list-params';
import { useWorkspace } from '@/lib/workspace';
import { importHref } from './import-forms';

const PAGE_SIZE = 25;
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function RunList() {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const pages = useCursorTrail(workspaceId);
  const runs = useApiQuery(API.imports.list, {
    params: { workspaceId },
    query: {
      limit: PAGE_SIZE,
      ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
    },
  });
  const columns: DataColumn<ImportRun>[] = [
    {
      key: 'run',
      header: 'Import',
      rowHeader: true,
      cell: (run) => (
        <Link
          href={importHref(workspaceId, run.id)}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {runTitle(run)}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (run) => <Status kind="importRun" value={run.status} />,
    },
    {
      key: 'saved',
      header: 'Saved',
      cell: (run) => formatCount(run.counts.saved),
    },
    {
      key: 'excluded',
      header: 'Excluded',
      cell: (run) => formatCount(run.counts.excluded),
    },
    {
      key: 'failed',
      header: 'Failed',
      cell: (run) => formatCount(run.counts.failed),
    },
    {
      key: 'created',
      header: 'Started',
      cell: (run) => dateFormat.format(new Date(run.createdAt)),
    },
  ];
  const nextCursor = runs.data?.nextCursor ?? null;
  return (
    <DataTable
      label="Imports"
      columns={columns}
      rows={runs.data?.items}
      rowKey={(run) => run.id}
      status={runs.status}
      error={runs.error}
      onRetry={runs.retry}
      refreshing={runs.refreshing}
      empty={
        <EmptyState
          icon={FileSpreadsheet}
          title="No imports yet"
          description="Find companies for an ideal customer profile, or import them from a CSV file."
        />
      }
      footer={
        <CursorPagination
          label="Imports"
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
  );
}

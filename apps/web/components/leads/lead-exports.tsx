'use client';

// Lead exports on the Leads page (task 11C, docs/decisions.md D-11C-02): a member with
// contacts.export makes a CSV file of the leads the current search finds, and downloads it from
// their own list of files until it expires. The file is made by the API (at most 2,000 leads,
// every cell safe to open in a spreadsheet); the download is a plain link through the web
// origin's /api proxy, with the session cookie, never a token in the address.
import {
  API,
  EXPORT_LIMITS,
  type LeadExport,
  type LeadSearchQuery,
} from '@lead-fennec-ai/shared';
import { Download, FileDown } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { Status } from '@/components/data/status-label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api';
import { exportDownloadHref } from '@/lib/exports';
import { formatCount, formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useWorkspace } from '@/lib/workspace';

export function LeadExports({
  filters,
}: {
  /** The list's current search, without its page. */
  readonly filters: LeadSearchQuery;
}) {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const files = useApiQuery(API.exports.list, {
    params: { workspaceId },
    query: { limit: 10 },
  });
  const create = useApiMutation(API.exports.create);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns: DataColumn<LeadExport>[] = [
    {
      key: 'file',
      header: 'File',
      rowHeader: true,
      cell: (file) => file.fileName,
    },
    {
      key: 'rows',
      header: 'Leads',
      cell: (file) =>
        file.truncated
          ? `${formatCount(file.rowCount)} (cut at the limit)`
          : formatCount(file.rowCount),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (file) => <Status kind="export" value={file.status} />,
    },
    {
      key: 'expires',
      header: 'Available until',
      cell: (file) => formatDateTime(file.expiresAt),
    },
    {
      key: 'download',
      header: 'Download',
      cell: (file) =>
        file.status === 'READY' ? (
          <a
            href={exportDownloadHref(workspaceId, file.id)}
            download={file.fileName}
            className="inline-flex items-center gap-1 underline underline-offset-4"
          >
            <Download aria-hidden="true" className="size-4" />
            Download {file.fileName}
          </a>
        ) : (
          <span className="text-muted-foreground">Deleted</span>
        ),
    },
  ];

  return (
    <Card aria-labelledby="exports-title">
      <CardHeader>
        <CardTitle id="exports-title">Export to a file</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {`A CSV file of the leads this search finds, at most ${formatCount(EXPORT_LIMITS.maxRows)}. Only you can download it, for ${String(EXPORT_LIMITS.ttlHours)} hours; then it is deleted. Spreadsheets open every cell as text.`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={create.pending}
            onClick={() => {
              setMessage(null);
              setError(null);
              void create
                .mutate({ params: { workspaceId }, body: { filters } })
                .then((result) => {
                  if (result.ok) {
                    setMessage(
                      `${result.data.fileName} is ready: ${result.data.rowCount === 1 ? '1 lead' : `${formatCount(result.data.rowCount)} leads`}${result.data.truncated ? ', cut at the limit' : ''}.`,
                    );
                  } else if (!result.signedOut) {
                    setError(errorMessage(result.error));
                  }
                });
            }}
          >
            <FileDown aria-hidden="true" />
            {create.pending ? 'Making the file…' : 'Export these leads'}
          </Button>
          {message === null ? null : (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DataTable
          label="Your files"
          columns={columns}
          rows={files.data?.items}
          rowKey={(file) => file.id}
          status={files.status}
          error={files.error}
          onRetry={files.retry}
          refreshing={files.refreshing}
          empty={
            <p className="text-sm text-muted-foreground">
              You haven’t exported any leads yet.
            </p>
          }
        />
      </CardContent>
    </Card>
  );
}

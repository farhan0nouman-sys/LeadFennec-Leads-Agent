'use client';

// One import or search (task 07C, docs/decisions.md D-07C-06): its status and counts (saved,
// excluded, failed, from the API), why it failed, cancelling a queued or running search, and
// what happened to each record, filtered by outcome, with a downloadable error report whose
// cells can't run as formulas. A running search refreshes itself (lib/polling.ts). A people
// search (task 08C) shows its progress and its people instead, and a finished company run offers
// to find people at its companies. A people file (task 11C) shows how many of its rows are done,
// and its people, linked to their profiles.
import {
  API,
  IMPORT_RESULT_OUTCOMES,
  type ImportResult,
  type ImportRun,
} from '@lead-fennec-ai/shared';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { FilterSelect, ListFilters } from '@/components/data/list-filters';
import { CursorPagination } from '@/components/data/pagination';
import { Status } from '@/components/data/status-label';
import { ConfirmButton } from '@/components/feedback/confirm';
import { RetryState } from '@/components/feedback/retry-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/typography';
import { callApi, errorMessage } from '@/lib/api';
import { formatCount } from '@/lib/format';
import {
  EnrichmentProgress,
  EnrichmentResults,
  FindPeopleCard,
} from '@/components/imports/enrichment-view';
import {
  canFindPeople,
  errorReportCsv,
  isRunning,
  outcomeText,
  runErrorText,
  runTitle,
} from '@/lib/imports';
import { IMPORT_RUN_POLL } from '@/lib/polling';
import { leadProfileHref } from '@/lib/leads';
import { companyProfileHref } from '@/lib/research';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useCursorTrail, useListParams } from '@/lib/use-list-params';
import { useWorkspace } from '@/lib/workspace';

const viewSchema = z.object({
  outcome: z.enum(IMPORT_RESULT_OUTCOMES).or(z.literal('')).catch(''),
});

const PAGE_SIZE = 50;
const REPORT_LIMIT = 100;

function Counts({ run }: { readonly run: ImportRun }) {
  const items: [string, number][] = [
    [
      run.source === 'CSV' || run.source === 'CONTACT_CSV'
        ? 'Rows read'
        : 'Companies found',
      run.counts.found,
    ],
    ['Saved', run.counts.saved],
    ['of them new', run.counts.created],
    ['Excluded', run.counts.excluded],
    ['Failed', run.counts.failed],
  ];
  if (run.counts.repeated > 0) {
    items.push(['Listed twice', run.counts.repeated]);
  }
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="grid gap-0.5 rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd
            className="text-lg font-semibold tabular-nums"
            data-testid={`count-${label}`}
          >
            {formatCount(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A people file's rows done, as a progress bar and in words. */
function RowsProgress({
  progress,
}: {
  readonly progress: NonNullable<ImportRun['contactImport']>;
}) {
  return (
    <div className="grid gap-1">
      <progress
        className="h-2 w-full"
        aria-label="Rows done"
        max={Math.max(progress.rows, 1)}
        value={progress.processed}
      />
      <p className="text-xs text-muted-foreground" data-testid="rows-done">
        {`${formatCount(progress.processed)} of ${formatCount(progress.rows)} rows done`}
      </p>
    </div>
  );
}

function statusSentence(run: ImportRun): string {
  if (run.contactImport !== null) {
    const { processed, rows } = run.contactImport;
    switch (run.status) {
      case 'PENDING':
        return 'Queued: the import starts shortly.';
      case 'PROCESSING':
        return run.errorCode === null
          ? `Importing: ${String(processed)} of ${String(rows)} rows done.`
          : `Waiting to try again. ${runErrorText(run.errorCode, true)}`;
      case 'COMPLETED':
        return 'Finished.';
      case 'CANCELLED':
        return 'Cancelled. People saved before that were kept.';
      case 'FAILED':
        return 'Stopped. People saved before that were kept.';
    }
  }
  if (run.enrichment !== null) {
    const { done, total } = run.enrichment.companies;
    switch (run.status) {
      case 'PENDING':
        return 'Queued: the people search starts shortly.';
      case 'PROCESSING':
        return run.errorCode === null
          ? `Running: ${String(done)} of ${String(total)} companies done.`
          : `Waiting to try again. ${runErrorText(run.errorCode)}`;
      case 'COMPLETED':
        return 'Finished.';
      case 'CANCELLED':
        return 'Cancelled. People saved before that were kept.';
      case 'FAILED':
        return 'Stopped. People saved before that were kept.';
    }
  }
  switch (run.status) {
    case 'PENDING':
      return 'Queued: the search starts shortly.';
    case 'PROCESSING':
      return run.errorCode === null
        ? `Running: ${run.pagesFetched === 1 ? '1 page' : `${String(run.pagesFetched)} pages`} fetched so far.`
        : `Waiting to try again. ${runErrorText(run.errorCode)}`;
    case 'COMPLETED':
      return 'Finished.';
    case 'CANCELLED':
      return 'Cancelled. Companies saved before that were kept.';
    case 'FAILED':
      return 'Stopped. Companies saved before that were kept.';
  }
}

/** Every excluded and failed record of the run (pages of 100), in order. */
async function problemRecords(
  workspaceId: string,
  importId: string,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const outcome of ['EXCLUDED', 'FAILED'] as const) {
    let cursor: string | undefined;
    do {
      const page = await callApi(API.imports.results, {
        params: { workspaceId, importId },
        query: {
          limit: REPORT_LIMIT,
          outcome,
          ...(cursor === undefined ? {} : { cursor }),
        },
      });
      results.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }
  return results.sort((a, b) => a.position - b.position);
}

/** Saves the error report as a file (built with toCsv: formulas stay text). */
function saveReport(
  results: readonly ImportResult[],
  fileName: string,
  people: boolean,
) {
  const blob = new Blob([errorReportCsv(results, people)], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function RunView({ importId }: { readonly importId: string }) {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const params = { workspaceId, importId };
  const [pollWhile, setPollWhile] = useState(true);
  const run = useApiQuery(
    API.discovery.get,
    { params },
    pollWhile ? { poll: IMPORT_RUN_POLL } : {},
  );
  const data = run.data;
  const running = data === undefined || isRunning(data);
  if (pollWhile !== running) {
    setPollWhile(running);
  }
  const view = useListParams(viewSchema);
  const pages = useCursorTrail(`${importId}:${view.viewKey}`);
  const companies = data?.enrichment === null;
  const results = useApiQuery(
    API.imports.results,
    {
      params,
      query: {
        limit: PAGE_SIZE,
        ...(view.values.outcome === '' ? {} : { outcome: view.values.outcome }),
        ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
      },
    },
    { enabled: companies, ...(pollWhile ? { poll: IMPORT_RUN_POLL } : {}) },
  );
  // The results stop refreshing with the run: load them once more when it finishes, or the
  // records saved after the last refresh would never show.
  const wasRunning = useRef(running);
  const refreshResults = results.retry;
  useEffect(() => {
    if (wasRunning.current && !running) {
      refreshResults();
    }
    wasRunning.current = running;
  }, [running, refreshResults]);
  const cancel = useApiMutation(API.imports.cancel);
  const [reportError, setReportError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  if (data === undefined) {
    return run.status === 'error' ? (
      <RetryState
        title="We couldn't load this import"
        error={run.error}
        onRetry={run.retry}
      />
    ) : (
      <div className="grid gap-3">
        <span className="sr-only">Loading the import</span>
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const people = data.source === 'CONTACT_CSV';
  const personColumns: DataColumn<ImportResult>[] = [
    {
      key: 'position',
      header: 'Row',
      cell: (result) => String(result.position),
    },
    {
      key: 'name',
      header: 'Person',
      rowHeader: true,
      cell: (result) => {
        const name =
          result.name === null || result.name === '' ? '—' : result.name;
        // A saved person opens their lead profile (task 11B).
        return result.contactId === null || !can('contacts.read') ? (
          name
        ) : (
          <Link
            href={leadProfileHref(workspaceId, result.contactId)}
            className="underline underline-offset-4"
          >
            {name}
          </Link>
        );
      },
    },
    { key: 'email', header: 'Email', cell: (result) => result.email ?? '—' },
    {
      key: 'company',
      header: 'Company',
      cell: (result) => result.company ?? '—',
    },
  ];
  const columns: DataColumn<ImportResult>[] = [
    {
      key: 'position',
      header: data.source === 'CSV' ? 'Row' : '#',
      cell: (result) => String(result.position),
    },
    {
      key: 'name',
      header: 'Company',
      rowHeader: true,
      cell: (result) => {
        const name =
          result.name === null || result.name === '' ? '—' : result.name;
        // A saved company opens its profile with its website research (task 09C).
        return result.organizationId === null || !can('contacts.read') ? (
          name
        ) : (
          <Link
            href={companyProfileHref(workspaceId, result.organizationId)}
            className="underline underline-offset-4"
          >
            {name}
          </Link>
        );
      },
    },
    {
      key: 'domain',
      header: 'Domain',
      cell: (result) => result.domain ?? '—',
    },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (result) => <Status kind="importResult" value={result.outcome} />,
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (result) =>
        result.issues.length === 0 ? (
          ''
        ) : (
          <ul className="grid gap-0.5">
            {result.issues.map((issue) => (
              <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        ),
    },
  ];

  const nextCursor = results.data?.nextCursor ?? null;
  const hasProblems = data.counts.excluded + data.counts.failed > 0;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={runTitle(data)}
        description={
          data.enrichment !== null
            ? 'People at the companies of an earlier run, for the profile’s roles. Nobody is emailed.'
            : data.search === null
              ? people
                ? 'What happened to each person in the file. Nobody is emailed.'
                : 'What happened to each row of the file.'
              : `${data.search.attribution} Companies only; people are found later.`
        }
        actions={
          isRunning(data) ? (
            <ConfirmButton
              variant="outline"
              confirm={{
                title: people ? 'Cancel this import?' : 'Cancel this search?',
                description: people
                  ? 'The import stops before its next batch. People already saved stay in the workspace; the rest of the file is not kept.'
                  : data.enrichment === null
                    ? 'The search stops before its next page. Companies already saved stay in the workspace.'
                    : 'The search stops before its next company. People already saved stay in the workspace.',
                confirmLabel: people ? 'Cancel import' : 'Cancel search',
                cancelLabel: people ? 'Keep importing' : 'Keep searching',
                pendingLabel: 'Cancelling…',
                destructive: true,
                onConfirm: async () => {
                  const result = await cancel.mutate({ params, body: {} });
                  if (result.ok) {
                    return null;
                  }
                  return result.signedOut ? null : errorMessage(result.error);
                },
              }}
            >
              {people ? 'Cancel import' : 'Cancel search'}
            </ConfirmButton>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Status <Status kind="importRun" value={data.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p role="status">{statusSentence(data)}</p>
          {data.status === 'FAILED' && data.errorCode !== null ? (
            <Alert variant="destructive">
              <AlertTitle>Why it stopped</AlertTitle>
              <AlertDescription className="text-destructive">
                {runErrorText(data.errorCode, people)}
              </AlertDescription>
            </Alert>
          ) : null}
          {data.contactImport === null ? null : (
            <RowsProgress progress={data.contactImport} />
          )}
          {data.enrichment === null ? (
            <Counts run={data} />
          ) : (
            <EnrichmentProgress run={data} />
          )}
          {run.polling?.stopped == null ? null : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Automatic updates stopped.</span>
              <Button variant="outline" size="sm" onClick={run.polling.resume}>
                Resume updates
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {canFindPeople(data) && can('imports.create') && can('contacts.write') ? (
        <FindPeopleCard run={data} />
      ) : null}

      {data.enrichment !== null ? (
        <EnrichmentResults run={data} />
      ) : (
        <section aria-labelledby="results-heading" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="results-heading" className="text-lg font-semibold">
              Results
            </h2>
            {hasProblems ? (
              <Button
                variant="outline"
                size="sm"
                disabled={preparing}
                onClick={() => {
                  setPreparing(true);
                  setReportError(null);
                  problemRecords(workspaceId, importId)
                    .then((records) => {
                      saveReport(
                        records,
                        `import-${importId}-errors.csv`,
                        people,
                      );
                    })
                    .catch((error: unknown) => {
                      setReportError(errorMessage(error));
                    })
                    .finally(() => {
                      setPreparing(false);
                    });
                }}
              >
                <Download aria-hidden="true" />
                {preparing ? 'Preparing…' : 'Download error report'}
              </Button>
            ) : null}
          </div>
          {reportError === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {reportError}
            </p>
          )}
          <ListFilters
            label="Filter results"
            filtered={view.filtered}
            onClear={view.clear}
          >
            <FilterSelect
              label="Outcome"
              value={view.values.outcome}
              allLabel="All outcomes"
              options={IMPORT_RESULT_OUTCOMES.map((value) => ({
                value,
                label: outcomeText(value),
              }))}
              onChange={(value) => {
                view.update({
                  outcome: value as z.output<typeof viewSchema>['outcome'],
                });
              }}
            />
          </ListFilters>
          <DataTable
            label="Results"
            columns={people ? [...personColumns, ...columns.slice(3)] : columns}
            rows={results.data?.items}
            rowKey={(result) => result.id}
            status={results.status}
            error={results.error}
            onRetry={results.retry}
            refreshing={results.refreshing}
            empty={
              <p className="text-sm text-muted-foreground">
                {isRunning(data)
                  ? 'Nothing saved yet.'
                  : view.filtered
                    ? 'No records with this outcome.'
                    : 'No records.'}
              </p>
            }
            footer={
              <CursorPagination
                label="Results"
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
        </section>
      )}
    </div>
  );
}

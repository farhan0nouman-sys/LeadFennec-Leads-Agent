'use client';

// Finding people for discovered companies (task 08C, docs/decisions.md D-08C-*): the request form
// on a finished company run, and an enrichment run's progress (companies done of the total, the
// ICP's targets) and what each person became, with the reasons a person can't be emailed. The
// API decides everything shown here; nothing is sent from these screens. Provider text is
// rendered as text only.
import {
  API,
  ENRICHMENT_LIMITS,
  ENRICHMENT_OUTCOMES,
  enrichmentRequestSchema,
  type EnrichmentResult,
  type ImportRun,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { FilterSelect, ListFilters } from '@/components/data/list-filters';
import { CursorPagination } from '@/components/data/pagination';
import { Status } from '@/components/data/status-label';
import { FormError, SelectField, SubmitButton } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCount } from '@/lib/format';
import { isRunning, outcomeText } from '@/lib/imports';
import { IMPORT_RUN_POLL } from '@/lib/polling';
import { leadHref } from '@/lib/qualification';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useFormSubmit } from '@/lib/use-form-submit';
import { useCursorTrail, useListParams } from '@/lib/use-list-params';
import { useWorkspace } from '@/lib/workspace';

const importHref = (workspaceId: string, importId: string) =>
  `/workspaces/${workspaceId}/imports/${importId}`;

const PAGE_SIZE = 50;

/** "Find people" on a finished company run (imports.create and contacts.write). */
export function FindPeopleCard({ run }: { readonly run: ImportRun }) {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const router = useRouter();
  const request = useApiMutation(API.enrichment.request);
  const campaigns = useApiQuery(
    API.campaigns.list,
    { params: { workspaceId }, query: { limit: 100 } },
    { enabled: can('campaigns.read') },
  );
  const [campaignId, setCampaignId] = useState('');
  const [perCompany, setPerCompany] = useState(
    String(ENRICHMENT_LIMITS.defaultContactsPerCompany),
  );
  const form = useFormSubmit({
    schema: enrichmentRequestSchema,
    submit: (body) =>
      request.mutate({ params: { workspaceId, importId: run.id }, body }),
    onSuccess: (accepted) => {
      router.push(importHref(workspaceId, accepted.runId));
    },
  });
  const open = (campaigns.data?.items ?? []).filter(
    (campaign) =>
      campaign.status !== 'COMPLETED' && campaign.status !== 'CANCELLED',
  );
  const covered = Math.min(run.counts.saved, ENRICHMENT_LIMITS.maxCompanies);
  const other = Object.entries(form.errors).filter(
    ([key]) => key !== 'campaignId' && key !== 'maxContactsPerCompany',
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Find people at these companies</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          aria-label="Find people"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit({
              ...(campaignId === '' ? {} : { campaignId }),
              maxContactsPerCompany: Number(perCompany),
            });
          }}
        >
          <p className="text-sm text-muted-foreground">
            Looks for people with the profile’s titles and seniorities at the
            first {formatCount(covered)}{' '}
            {covered === 1 ? 'company' : 'companies'} of this run (at most{' '}
            {String(ENRICHMENT_LIMITS.maxCompanies)} a run). People already in
            the workspace are matched, not duplicated, and anyone looked up in
            the last {String(ENRICHMENT_LIMITS.reuseDays)} days is reused
            without being looked up again. Nobody is emailed.
          </p>
          <FormError message={form.formError} />
          {other.length === 0 ? null : (
            <Alert variant="destructive" role="alert">
              <AlertDescription className="text-destructive">
                <p>People can’t be found for this run as asked:</p>
                <ul className="mt-1 list-disc pl-5">
                  {other.map(([key, message]) => (
                    <li key={key}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <SelectField
            label="Campaign (optional)"
            name="campaignId"
            value={campaignId}
            hint="Its exclusions apply, and the people who may be emailed one day join its lead list."
            error={form.errors['campaignId']}
            onChange={(event) => {
              setCampaignId(event.target.value);
            }}
          >
            <option value="">No campaign</option>
            {open.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="People a company"
            name="maxContactsPerCompany"
            value={perCompany}
            error={form.errors['maxContactsPerCompany']}
            onChange={(event) => {
              setPerCompany(event.target.value);
            }}
          >
            {Array.from(
              { length: ENRICHMENT_LIMITS.maxContactsPerCompany },
              (_, i) => String(i + 1),
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </SelectField>
          <div>
            <SubmitButton pending={form.pending} pendingLabel="Starting…">
              Find people
            </SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Progress of an enrichment run: companies handled of the total, skipped, beyond the limit. */
export function EnrichmentProgress({ run }: { readonly run: ImportRun }) {
  const info = run.enrichment;
  if (info === null) {
    return null;
  }
  const { companies, targeting } = info;
  const items: [string, number][] = [
    ['Companies done', companies.done],
    ['of', companies.total],
    ['Companies skipped', companies.skipped],
    ['People found', run.counts.found],
    ['People saved', run.counts.saved],
    ['of them new', run.counts.created],
    ['People excluded', run.counts.excluded],
    ['People failed', run.counts.failed],
  ];
  const targets = [
    targeting.titles.length === 0
      ? null
      : `Titles: ${targeting.titles.join(', ')}`,
    targeting.seniorities.length === 0
      ? null
      : `Seniorities: ${targeting.seniorities.join(', ')}`,
    targeting.countries.length === 0
      ? 'Countries: any'
      : `Countries: ${targeting.countries.join(', ')}`,
  ].filter((line): line is string => line !== null);
  return (
    <div className="grid gap-3">
      <div
        role="progressbar"
        aria-label="Companies done"
        aria-valuemin={0}
        aria-valuemax={companies.total}
        aria-valuenow={companies.done}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary"
          style={{
            width: `${String(
              companies.total === 0
                ? 0
                : Math.round((companies.done / companies.total) * 100),
            )}%`,
          }}
        />
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
      <ul className="grid gap-0.5 text-sm text-muted-foreground">
        {targets.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          At most {String(info.maxContactsPerCompany)}{' '}
          {info.maxContactsPerCompany === 1 ? 'person' : 'people'} a company.
          {companies.beyondLimit > 0
            ? ` ${formatCount(companies.beyondLimit)} more companies of the run were not covered (limit ${String(ENRICHMENT_LIMITS.maxCompanies)}).`
            : ''}
        </li>
        <li>
          {info.provider === 'FAKE'
            ? 'Development provider: synthetic people, not real people.'
            : info.attribution}
        </li>
      </ul>
    </div>
  );
}

const viewSchema = z.object({
  outcome: z.enum(ENRICHMENT_OUTCOMES).or(z.literal('')).catch(''),
});

/** What each person of an enrichment run became, with the reasons. */
export function EnrichmentResults({ run }: { readonly run: ImportRun }) {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const view = useListParams(viewSchema);
  const pages = useCursorTrail(`${run.id}:${view.viewKey}`);
  const results = useApiQuery(
    API.enrichment.contacts,
    {
      params: { workspaceId, importId: run.id },
      query: {
        limit: PAGE_SIZE,
        ...(view.values.outcome === '' ? {} : { outcome: view.values.outcome }),
        ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
      },
    },
    isRunning(run) ? { poll: IMPORT_RUN_POLL } : {},
  );
  const campaignId = run.enrichment?.campaignId ?? null;
  const columns: DataColumn<EnrichmentResult>[] = [
    { key: 'position', header: '#', cell: (result) => String(result.position) },
    {
      key: 'person',
      header: 'Person',
      rowHeader: true,
      cell: (result) => {
        if (result.person === null) {
          return <span className="text-muted-foreground">Company skipped</span>;
        }
        const name = result.person.name ?? '—';
        const contactId = result.person.contactId;
        return contactId === null ||
          campaignId === null ||
          !can('campaigns.read') ? (
          name
        ) : (
          <Link
            href={leadHref(workspaceId, campaignId, contactId)}
            className="underline underline-offset-4"
          >
            {name}
          </Link>
        );
      },
    },
    {
      key: 'title',
      header: 'Title',
      cell: (result) => result.person?.title ?? '',
    },
    {
      key: 'company',
      header: 'Company',
      cell: (result) => result.company.name ?? result.company.domain ?? '—',
    },
    {
      key: 'match',
      header: 'Role match',
      cell: (result) =>
        result.person?.confidence == null
          ? ''
          : `${String(result.person.confidence)}/100`,
    },
    {
      key: 'check',
      header: 'Address check',
      cell: (result) =>
        result.person === null ? (
          ''
        ) : result.person.check === null ? (
          <span className="text-muted-foreground">
            {result.person.reused
              ? 'Reused (not looked up again)'
              : result.person.email === null
                ? 'No address'
                : 'Not checked now'}
          </span>
        ) : (
          <Status kind="emailCheck" value={result.person.check} />
        ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (result) => <Status kind="importResult" value={result.outcome} />,
    },
    {
      key: 'reason',
      header: 'Reasons',
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
  return (
    <section aria-labelledby="people-heading" className="grid gap-4">
      <h2 id="people-heading" className="text-lg font-semibold">
        People
      </h2>
      <ListFilters
        label="Filter people"
        filtered={view.filtered}
        onClear={view.clear}
      >
        <FilterSelect
          label="Outcome"
          value={view.values.outcome}
          allLabel="All outcomes"
          options={ENRICHMENT_OUTCOMES.map((value) => ({
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
        label="People"
        columns={columns}
        rows={results.data?.items}
        rowKey={(result) => result.id}
        status={results.status}
        error={results.error}
        onRetry={results.retry}
        refreshing={results.refreshing}
        empty={
          <p className="text-sm text-muted-foreground">
            {isRunning(run)
              ? 'Nobody found yet.'
              : view.filtered
                ? 'Nobody with this outcome.'
                : 'Nobody was found.'}
          </p>
        }
        footer={
          <CursorPagination
            label="People"
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
  );
}

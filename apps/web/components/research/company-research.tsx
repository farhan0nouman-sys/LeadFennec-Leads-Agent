'use client';

// A company's website research on its profile (task 09C, docs/decisions.md D-09C-05): the
// current version's facts, each with the dated extract it was quoted from; what is unknown;
// inferences kept apart from facts; what needs a person; corrections; and every earlier
// version, unchanged. Everything a page or a model wrote is untrusted: it is shown as text only,
// and a URL is a link only when it is http(s). A queued or running run refreshes itself.
import {
  API,
  researchCorrectionRequestSchema,
  type OrganizationResearch,
  type ResearchEvidence,
  type ResearchFact,
  type ResearchVersion,
  type WebsiteResearchField,
} from '@lead-fennec-ai/shared';
import { useState } from 'react';
import { z } from 'zod';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { Status, StatusLabel } from '@/components/data/status-label';
import { EmptyState } from '@/components/feedback/empty-state';
import { RetryState } from '@/components/feedback/retry-state';
import {
  FormError,
  FormField,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/typography';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { RESEARCH_RUN_POLL } from '@/lib/polling';
import { useApiMutation, useApiQuery } from '@/lib/query';
import {
  errorText,
  FIELD_LABELS,
  ORIGIN_TEXT,
  PAGE_OUTCOME_TEXT,
  quoteParts,
  REVIEW_REASON_TEXT,
  safeLinkUrl,
  shortHash,
} from '@/lib/research';
import { useFormSubmit } from '@/lib/use-form-submit';
import { useListParams } from '@/lib/use-list-params';
import { useWorkspace } from '@/lib/workspace';

/** A text field's value from FormData (never a file). */
const textOf = (value: FormDataEntryValue | null) =>
  typeof value === 'string' ? value : '';

const viewSchema = z.object({
  version: z.uuid().or(z.literal('')).catch(''),
});

function ExternalLink({ url }: { readonly url: string | null }) {
  const href = safeLinkUrl(url);
  if (href === null) {
    return <span className="break-all">{url ?? '—'}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="break-all underline underline-offset-4"
    >
      {url}
    </a>
  );
}

function EvidenceLinks({
  fact,
  evidence,
}: {
  readonly fact: ResearchFact;
  readonly evidence: readonly ResearchEvidence[];
}) {
  return (
    <ul className="grid gap-1">
      {fact.evidence.map((item) => {
        const row = evidence.find(
          (candidate) => candidate.id === item.evidenceId,
        );
        return (
          <li key={item.evidenceId} className="text-sm">
            <a
              href={`#evidence-${item.evidenceId}`}
              className="underline underline-offset-4"
            >
              {item.label ?? 'Note'}
            </a>
            {item.quote === null ? null : (
              <q className="ml-1 text-muted-foreground">{item.quote}</q>
            )}
            {row === undefined ? null : (
              <span className="ml-1 text-xs text-muted-foreground">
                ({row.kind === 'MANUAL_NOTE' ? 'written' : 'read'}{' '}
                {formatDateTime(row.capturedAt)})
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Excerpt({
  item,
  quotes,
}: {
  readonly item: ResearchEvidence;
  readonly quotes: readonly string[];
}) {
  const parts =
    quotes
      .map((quote) => quoteParts(item.excerpt, quote))
      .find((found) => found !== null) ?? null;
  return (
    <p className="text-sm whitespace-pre-wrap">
      {parts === null ? (
        item.excerpt
      ) : (
        <>
          {parts.before}
          <mark>{parts.match}</mark>
          {parts.after}
        </>
      )}
    </p>
  );
}

function CorrectionForm({
  workspaceId,
  organizationId,
  version,
  field,
  corrected,
  onDone,
}: {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly version: ResearchVersion;
  readonly field: WebsiteResearchField;
  readonly corrected: boolean;
  readonly onDone: () => void;
}) {
  const correct = useApiMutation(API.research.correct);
  const [action, setAction] = useState<'set' | 'reject' | 'restore'>('set');
  const form = useFormSubmit({
    schema: researchCorrectionRequestSchema,
    submit: (body) =>
      correct.mutate({ params: { workspaceId, organizationId }, body }),
    onSuccess: onDone,
  });
  const label = FIELD_LABELS[field];
  return (
    <form
      className="grid gap-3 rounded-lg border p-4"
      aria-label={`Correct ${label}`}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = textOf(data.get('value')).trim();
        void form.handleSubmit({
          baseResearchId: version.id,
          field,
          action,
          ...(action === 'set' ? { value } : {}),
          note: textOf(data.get('note')),
        });
      }}
    >
      <FormError message={form.formError} />
      <SelectField
        label={`How to correct ${label}`}
        name="action"
        value={action}
        onChange={(event) => {
          setAction(event.target.value as 'set' | 'reject' | 'restore');
        }}
        error={form.errors['action']}
      >
        <option value="set">Give the right value</option>
        <option value="reject">Mark the pages&apos; value as wrong</option>
        {corrected ? (
          <option value="restore">Remove my correction</option>
        ) : null}
      </SelectField>
      {action === 'set' ? (
        <FormField
          label="Right value"
          name="value"
          maxLength={300}
          required
          error={form.errors['value']}
        />
      ) : null}
      <TextareaField
        label="Why (kept with the correction)"
        name="note"
        maxLength={500}
        required
        error={form.errors['note']}
      />
      <div className="flex gap-2">
        <SubmitButton pending={form.pending} pendingLabel="Saving…">
          Save correction
        </SubmitButton>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function VersionView({
  workspaceId,
  organizationId,
  version,
  isCurrent,
  canCorrect,
}: {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly version: ResearchVersion;
  readonly isCurrent: boolean;
  readonly canCorrect: boolean;
}) {
  const [correcting, setCorrecting] = useState<WebsiteResearchField | null>(
    null,
  );
  const correctedFields = new Set(
    version.corrections.map((item) => item.field),
  );
  const quotesOf = (evidenceId: string) =>
    version.facts.flatMap((fact) =>
      fact.evidence
        .filter((item) => item.evidenceId === evidenceId && item.quote !== null)
        .map((item) => item.quote ?? ''),
    );
  const columns: DataColumn<ResearchFact>[] = [
    {
      key: 'field',
      header: 'Field',
      rowHeader: true,
      cell: (fact) => FIELD_LABELS[fact.field],
    },
    {
      key: 'value',
      header: 'Value',
      cell: (fact) => <span className="whitespace-pre-wrap">{fact.value}</span>,
    },
    {
      key: 'source',
      header: 'Source',
      cell: (fact) =>
        fact.source === 'person' ? (
          <StatusLabel tone="info">Corrected by a person</StatusLabel>
        ) : (
          <StatusLabel tone="success">Quoted from the pages</StatusLabel>
        ),
    },
    {
      key: 'confidence',
      header: 'Confidence',
      cell: (fact) => fact.confidence ?? '—',
    },
    {
      key: 'evidence',
      header: 'Evidence',
      cell: (fact) => <EvidenceLinks fact={fact} evidence={version.evidence} />,
    },
  ];
  if (isCurrent && canCorrect) {
    columns.push({
      key: 'correct',
      header: 'Correct',
      hideHeader: true,
      cell: (fact) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCorrecting(fact.field);
          }}
        >
          Correct {FIELD_LABELS[fact.field]}
        </Button>
      ),
    });
  }

  return (
    <div className="grid gap-6">
      {version.warnings.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>A page tried to give instructions to the AI</AlertTitle>
          <AlertDescription>
            Text on{' '}
            {version.warnings.map((warning) => warning.label).join(', ')} tried
            to instruct the AI. It was not followed and nothing quoted from it
            counts as a fact. Check the facts below before using them.
          </AlertDescription>
        </Alert>
      ) : null}

      {version.reviewItems.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Needs a person</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              These claims were not kept as facts.
            </p>
            <ul className="grid gap-2 text-sm">
              {version.reviewItems.map((item, index) => (
                <li key={`${item.reason}-${String(index)}`}>
                  <span className="font-medium">
                    {item.field === null
                      ? 'The answer'
                      : FIELD_LABELS[item.field]}
                  </span>
                  {': '}
                  {REVIEW_REASON_TEXT[item.reason]}
                  {item.value === null ? null : (
                    <q className="ml-1 text-muted-foreground">{item.value}</q>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {correcting === null ? null : (
        <CorrectionForm
          workspaceId={workspaceId}
          organizationId={organizationId}
          version={version}
          field={correcting}
          corrected={correctedFields.has(correcting)}
          onDone={() => {
            setCorrecting(null);
          }}
        />
      )}

      <section className="grid gap-3" aria-labelledby="facts-heading">
        <h2 id="facts-heading" className="text-lg font-semibold">
          Facts
        </h2>
        <DataTable
          label="Facts"
          columns={columns}
          rows={version.facts}
          rowKey={(fact) => `${fact.field}:${fact.value}`}
          status="success"
          empty={
            <EmptyState
              title="No facts"
              description="Nothing on the pages stated any of the fields with a quote that checked out."
            />
          }
        />
      </section>

      <section className="grid gap-2" aria-labelledby="unknown-heading">
        <h2 id="unknown-heading" className="text-lg font-semibold">
          Unknown
        </h2>
        {version.unknownFields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every field has a fact.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {version.unknownFields.map((field) => (
              <li key={field} className="flex items-center gap-2">
                <StatusLabel>
                  {version.rejectedFields.includes(field)
                    ? `${FIELD_LABELS[field]} (marked wrong by a person)`
                    : FIELD_LABELS[field]}
                </StatusLabel>
                {isCurrent && canCorrect ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCorrecting(field);
                    }}
                  >
                    Correct {FIELD_LABELS[field]}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {version.hypotheses.length > 0 ? (
        <section className="grid gap-2" aria-labelledby="inferences-heading">
          <h2 id="inferences-heading" className="text-lg font-semibold">
            Inferences, not facts
          </h2>
          <ul className="grid gap-2 text-sm">
            {version.hypotheses.map((hypothesis) => (
              <li key={hypothesis.statement}>
                {hypothesis.statement}{' '}
                <span className="text-muted-foreground">
                  ({hypothesis.confidence} confidence
                  {hypothesis.labels.length > 0
                    ? `; from ${hypothesis.labels.join(', ')}`
                    : ''}
                  )
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className="text-lg font-semibold">
          Evidence
        </h2>
        {version.evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">No page was read.</p>
        ) : (
          <ul className="grid gap-3">
            {version.evidence.map((item) => (
              <li
                key={item.id}
                id={`evidence-${item.id}`}
                className="grid gap-2 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-semibold">
                    {item.kind === 'MANUAL_NOTE'
                      ? 'Note by a person'
                      : item.label}
                  </span>
                  {item.url === null ? null : <ExternalLink url={item.url} />}
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.kind === 'MANUAL_NOTE' ? 'Written' : 'Read'}{' '}
                  {formatDateTime(item.capturedAt)}
                  {item.contentSha256 === null
                    ? null
                    : ` · page version ${shortHash(item.contentSha256) ?? ''}`}
                </p>
                <details>
                  <summary className="cursor-pointer text-sm">
                    {item.kind === 'MANUAL_NOTE'
                      ? 'Show the note'
                      : 'Show the extract'}
                  </summary>
                  <div className="mt-2">
                    <Excerpt item={item} quotes={quotesOf(item.id)} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2" aria-labelledby="pages-heading">
        <h2 id="pages-heading" className="text-lg font-semibold">
          Pages
        </h2>
        <ul className="grid gap-1 text-sm">
          {version.pages.map((page) => (
            <li key={page.url}>
              <ExternalLink url={page.url} /> —{' '}
              {PAGE_OUTCOME_TEXT[page.outcome]}
              {page.errorCode === null
                ? null
                : `: ${errorText(page.errorCode) ?? ''}`}
              {page.retrievedAt === null
                ? null
                : ` (${formatDateTime(page.retrievedAt)})`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function versionTitle(version: {
  readonly version: number | null;
  readonly completedAt: string | null;
}) {
  return version.version === null
    ? 'Not completed'
    : `Version ${String(version.version)}${version.completedAt === null ? '' : ` · ${formatDateTime(version.completedAt)}`}`;
}

export function CompanyResearch({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const params = { workspaceId, organizationId };
  const [polling, setPolling] = useState(true);
  const research = useApiQuery(
    API.research.organization,
    { params },
    polling ? { poll: RESEARCH_RUN_POLL } : {},
  );
  const data: OrganizationResearch | undefined = research.data;
  // Polls while the first answer is awaited or a run is queued or running.
  const active = data?.active !== null;
  if (polling !== active) {
    setPolling(active);
  }
  const view = useListParams(viewSchema);
  const viewing = view.values.version;
  const older = useApiQuery(
    API.research.version,
    {
      params: {
        ...params,
        researchId: viewing === '' ? organizationId : viewing,
      },
    },
    { enabled: viewing !== '' && viewing !== data?.current?.id },
  );
  const request = useApiMutation(API.research.request);
  const [message, setMessage] = useState<string | null>(null);
  const canRun = can('research.run');

  if (data === undefined) {
    return research.status === 'error' ? (
      <RetryState
        title="We couldn't load this company"
        error={research.error}
        onRetry={research.retry}
      />
    ) : (
      <div className="grid gap-3">
        <span className="sr-only">Loading the company</span>
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  async function run(refresh: boolean) {
    setMessage(null);
    const result = await request.mutate({ params, body: { refresh } });
    if (!result.ok) {
      if (!result.signedOut) {
        setMessage(errorMessage(result.error));
      }
      return;
    }
    setMessage(
      result.data.state === 'fresh'
        ? 'This research is less than 30 days old, so it was kept. Use "Read the pages again" to check them now.'
        : result.data.state === 'running'
          ? 'Research is already queued or running.'
          : 'Research is queued.',
    );
  }

  const { organization } = data;
  const shown =
    viewing === '' || viewing === data.current?.id
      ? data.current
      : (older.data ?? null);
  const isCurrent = shown !== null && shown.id === data.current?.id;
  const historyColumns: DataColumn<OrganizationResearch['history'][number]>[] =
    [
      {
        key: 'version',
        header: 'Version',
        rowHeader: true,
        cell: (item) => versionTitle(item),
      },
      {
        key: 'how',
        header: 'How',
        cell: (item) =>
          item.origin === null
            ? item.refresh
              ? 'Refresh requested'
              : 'Requested'
            : ORIGIN_TEXT[item.origin],
      },
      {
        key: 'status',
        header: 'Status',
        cell: (item) =>
          item.resultStatus === null ? (
            <Status kind="research" value={item.status} />
          ) : (
            <Status kind="researchResult" value={item.resultStatus} />
          ),
      },
      {
        key: 'why',
        header: 'Note',
        cell: (item) => errorText(item.errorCode) ?? '—',
      },
      {
        key: 'view',
        header: 'View',
        hideHeader: true,
        cell: (item) =>
          item.status !== 'COMPLETED' ? null : shown?.id === item.id ? (
            <span className="text-sm text-muted-foreground">Shown</span>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                view.update({
                  version: item.id === data.current?.id ? '' : item.id,
                });
              }}
            >
              View {versionTitle(item)}
            </Button>
          ),
      },
    ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={organization.name}
        description={
          <span className="grid gap-1">
            {organization.websiteUrl === null ? null : (
              <ExternalLink url={organization.websiteUrl} />
            )}
            {organization.domain === null ? null : (
              <span>{organization.domain}</span>
            )}
          </span>
        }
        actions={
          canRun ? (
            <div className="flex flex-wrap gap-2">
              {data.current === null || !data.fresh ? (
                <Button
                  type="button"
                  disabled={request.pending || data.active !== null}
                  onClick={() => void run(false)}
                >
                  Research the website
                </Button>
              ) : null}
              {data.current === null ? null : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={request.pending || data.active !== null}
                  onClick={() => void run(true)}
                >
                  Read the pages again
                </Button>
              )}
            </div>
          ) : null
        }
      />

      {message === null ? null : (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}

      {data.active === null ? null : (
        <Alert>
          <AlertTitle>
            {data.active.status === 'RUNNING'
              ? 'Research is running'
              : 'Research is queued'}
          </AlertTitle>
          <AlertDescription>
            {data.active.errorCode === null
              ? 'This page updates when it finishes.'
              : `Waiting to try again: ${errorText(data.active.errorCode) ?? ''}.`}
          </AlertDescription>
        </Alert>
      )}

      {shown === null ? (
        viewing !== '' && older.status === 'error' ? (
          <RetryState
            title="We couldn't load this version"
            error={older.error}
            onRetry={older.retry}
          />
        ) : (
          <EmptyState
            title="No research yet"
            description="Research reads the company's public website: its home page and up to three pages it links to, such as About or Careers. Facts are kept only when a quote from a page backs them."
          />
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {isCurrent ? 'Current research' : 'An earlier version'} ·{' '}
              {versionTitle(shown)}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {shown.resultStatus === null ? null : (
                <Status kind="researchResult" value={shown.resultStatus} />
              )}
              {shown.origin === null ? null : (
                <span>{ORIGIN_TEXT[shown.origin]}</span>
              )}
              {shown.confidence === null ? null : (
                <span className="text-muted-foreground">
                  Overall confidence: {shown.confidence}
                </span>
              )}
              {shown.model === null ? null : (
                <span className="text-muted-foreground">
                  {shown.model.provider === 'FAKE'
                    ? 'Test model'
                    : shown.model.model}{' '}
                  · {shown.model.prompt}
                </span>
              )}
            </div>
            {!isCurrent ? (
              <p className="text-sm">
                Earlier versions are kept as they were.{' '}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => {
                    view.update({ version: '' });
                  }}
                >
                  Back to the current research
                </Button>
              </p>
            ) : null}
            <VersionView
              workspaceId={workspaceId}
              organizationId={organizationId}
              version={shown}
              isCurrent={isCurrent}
              canCorrect={canRun}
            />
          </CardContent>
        </Card>
      )}

      <section className="grid gap-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        <DataTable
          label="Research history"
          columns={historyColumns}
          rows={data.history}
          rowKey={(item) => item.id}
          status="success"
          empty={
            <p className="text-sm text-muted-foreground">
              No research was requested yet.
            </p>
          }
        />
      </section>
    </div>
  );
}

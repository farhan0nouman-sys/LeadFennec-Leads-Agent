'use client';

// One lead of a campaign (task 10C, docs/decisions.md D-10C-*): the contact's data quality (task
// 08C) and three separate parts:
// - Fit: the score, each factor's rating, who rated it, why, and the evidence it rests on;
// - Eligibility: whether the campaign may email the person now, decided apart from the score;
// - Qualification: the current state with its reasons, every earlier decision, and a person's
//   decision (audited; a blocked person can't be qualified).
// Text from pages, providers, the model and notes is untrusted: shown as text only; a URL is a
// link only when it is http(s). A queued run refreshes the page until it is done.
import {
  API,
  LEAD_SCORE_BAND_RANGES,
  LEAD_SCORE_FACTOR_INFO,
  QUALIFICATION_STATE_LABELS,
  qualificationDecisionRequestSchema,
  type LeadEvidenceView,
  type LeadFitView,
  type LeadQualificationView,
  type QualificationDecisionView,
  type QualificationState,
} from '@lead-fennec-ai/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { Status } from '@/components/data/status-label';
import { EmptyState } from '@/components/feedback/empty-state';
import { RetryState } from '@/components/feedback/retry-state';
import {
  CheckboxField,
  FormError,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/typography';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { QUALIFICATION_RUN_POLL } from '@/lib/polling';
import {
  acceptableReasons,
  AGENT_STATUS_TEXT,
  agentReviewText,
  ASSESSED_BY_TEXT,
  decisionStates,
  leadsHref,
  pointsText,
  ratingText,
} from '@/lib/qualification';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { safeLinkUrl } from '@/lib/research';
import { ContactQualitySection } from './contact-quality';
import { useFormSubmit } from '@/lib/use-form-submit';
import { useWorkspace } from '@/lib/workspace';

const BAND_REASON_TEXT = {
  required_factor_missing:
    'A factor that High Priority requires has no evidence.',
  insufficient_data:
    'The factors without evidence weigh more than the campaign allows.',
} as const;

function EvidenceList({
  items,
}: {
  readonly items: readonly LeadEvidenceView[];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 grid gap-2" aria-label="Evidence">
      {items.map((item, index) => {
        const href = safeLinkUrl(item.url);
        return (
          <li key={`${item.kind}-${String(index)}`} className="text-sm">
            <span className="font-medium">{item.label}:</span>{' '}
            <span>{item.detail}</span>
            {item.excerpt === null ? null : (
              <blockquote className="mt-1 border-l-2 pl-2 text-muted-foreground">
                {item.excerpt}
              </blockquote>
            )}
            <span className="block text-xs text-muted-foreground">
              {href === null ? (
                (item.url ?? '')
              ) : (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="break-all underline underline-offset-4"
                >
                  {item.url}
                </a>
              )}
              {item.capturedAt === null
                ? ''
                : `${item.url === null ? '' : ' · '}${formatDateTime(item.capturedAt)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FitSection({ fit }: { readonly fit: LeadFitView | null }) {
  return (
    <Card aria-labelledby="fit-title">
      <CardHeader>
        <CardTitle id="fit-title">Fit</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {fit === null ? (
          <EmptyState
            title="Not scored yet"
            description="Qualify the lead to score it: rules rate the stored data, the qualification agent rates supported need and timing from the company's research."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-3xl font-semibold tabular-nums">
                {fit.value}
              </span>
              <span className="text-muted-foreground">of 100</span>
              <Status kind="scoreBand" value={fit.band} />
            </div>
            {fit.band === fit.scoreBand ? null : (
              <p className="text-sm">
                The score alone is {LEAD_SCORE_BAND_RANGES[fit.scoreBand].label}
                ; the campaign&apos;s missing-data policy makes it{' '}
                {LEAD_SCORE_BAND_RANGES[fit.band].label}.
              </p>
            )}
            {fit.bandReasons.length === 0 ? null : (
              <ul className="list-disc pl-5 text-sm">
                {fit.bandReasons.map((reason) => (
                  <li key={reason}>{BAND_REASON_TEXT[reason]}</li>
                ))}
              </ul>
            )}
            <p className="text-sm text-muted-foreground">
              Calculated by Lead Fennec ({fit.methodVersion}, rules{' '}
              {fit.rulesVersion}) on {formatDateTime(fit.scoredAt)}.
              {fit.agent === null
                ? ''
                : ` ${AGENT_STATUS_TEXT[fit.agent.status]} (${fit.agent.prompt}, ${fit.agent.provider} ${fit.agent.model})`}
            </p>
            {fit.agent === null || fit.agent.reviewItems.length === 0 ? null : (
              <ul
                className="list-disc pl-5 text-sm"
                aria-label="Agent review items"
              >
                {fit.agent.reviewItems.map((item, index) => (
                  <li key={`${item.reason}-${String(index)}`}>
                    {item.factor === null
                      ? 'The answer'
                      : LEAD_SCORE_FACTOR_INFO[item.factor].label}
                    : {agentReviewText(item.reason)}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-3">
              {fit.factors.map((factor) => (
                <section
                  key={factor.factor}
                  aria-labelledby={`factor-${factor.factor}`}
                  className="rounded-lg border p-3"
                >
                  <h3
                    id={`factor-${factor.factor}`}
                    className="flex flex-wrap items-baseline gap-x-3 font-medium"
                  >
                    <span>{factor.label}</span>
                    <span className="text-sm font-normal tabular-nums">
                      {pointsText(factor.points, factor.weight)} points
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {ratingText(factor)} ·{' '}
                      {ASSESSED_BY_TEXT[factor.assessedBy]}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm">{factor.explanation}</p>
                  <EvidenceList items={factor.evidence} />
                </section>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EligibilitySection({
  view,
}: {
  readonly view: LeadQualificationView;
}) {
  const { eligibility } = view;
  return (
    <Card aria-labelledby="eligibility-title">
      <CardHeader>
        <CardTitle id="eligibility-title">Eligibility</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Status kind="eligibility" value={eligibility.status} />
          <span className="text-sm text-muted-foreground">
            Decided now, from the facts, without the score.
          </span>
        </div>
        <p className="text-sm">
          {view.sendPermitted
            ? view.readyToContact
              ? 'The campaign may email this person, and they are qualified.'
              : 'The campaign may email this person, but they are not qualified.'
            : "The campaign may not email this person now. A score can't change that."}
        </p>
        <ul className="grid gap-2">
          {eligibility.checks.map((check) => (
            <li key={check.key} className="grid gap-1 rounded-lg border p-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{check.label}</span>
                <Status kind="eligibilityCheck" value={check.status} />
                {check.scope === 'campaign' ? (
                  <span className="text-xs text-muted-foreground">
                    For every lead of the campaign
                  </span>
                ) : null}
              </span>
              {check.reasons.length === 0 ? null : (
                <ul className="list-disc pl-5 text-sm">
                  {check.reasons.map((reason) => (
                    <li key={reason.code}>
                      {reason.message}
                      {reason.overridable ? null : (
                        <span className="text-muted-foreground">
                          {' '}
                          Nobody can override this.
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DecisionForm({
  view,
  workspaceId,
  canApprove,
}: {
  readonly view: LeadQualificationView;
  readonly workspaceId: string;
  readonly canApprove: boolean;
}) {
  const decide = useApiMutation(API.qualification.decide);
  const states = decisionStates(view);
  const acceptable = canApprove ? acceptableReasons(view) : [];
  const [state, setState] = useState<QualificationState>(
    states.includes('QUALIFIED') ? 'QUALIFIED' : 'REVIEW',
  );
  const [note, setNote] = useState('');
  const [accept, setAccept] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const form = useFormSubmit({
    schema: qualificationDecisionRequestSchema,
    submit: (body) =>
      decide.mutate({
        params: {
          workspaceId,
          campaignId: view.campaign.id,
          contactId: view.contact.id,
        },
        body,
      }),
    onSuccess: (result) => {
      setNote('');
      setAccept(false);
      setSaved(
        `Saved: ${QUALIFICATION_STATE_LABELS[result.qualification?.state ?? state]}.`,
      );
    },
    fieldErrors: {
      qualification_blocked: {
        field: 'state',
        message: "This person may not be emailed, so they can't be qualified.",
      },
    },
  });
  return (
    <form
      noValidate
      aria-labelledby="decision-title"
      className="grid gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(null);
        void form.handleSubmit({
          version: view.qualification?.version ?? 0,
          state,
          note,
          ...(accept && state === 'QUALIFIED' ? { acceptReview: true } : {}),
        });
      }}
    >
      <h3 id="decision-title" className="font-medium">
        Decide yourself
      </h3>
      <p className="text-sm text-muted-foreground">
        Your decision is kept with your name and note, and recorded in the audit
        log. It never lifts a block: a person who may not be emailed can&apos;t
        be qualified.
      </p>
      <FormError message={form.formError} />
      <SelectField
        label="Qualification"
        name="state"
        value={state}
        error={form.errors['state']}
        onChange={(event) => {
          setState(event.target.value as QualificationState);
        }}
      >
        {states.map((item) => (
          <option key={item} value={item}>
            {QUALIFICATION_STATE_LABELS[item]}
          </option>
        ))}
      </SelectField>
      <TextareaField
        label="Why (kept with the decision)"
        name="note"
        rows={2}
        maxLength={1000}
        value={note}
        error={form.errors['note']}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      {acceptable.length === 0 || state !== 'QUALIFIED' ? null : (
        <CheckboxField
          label={`Accept the checks that need a person: ${acceptable.map((reason) => reason.message).join(' ')}`}
          hint="Only these checks, as they are now. A new one needs a person again; a block can never be accepted."
          name="acceptReview"
          checked={accept}
          onChange={(event) => {
            setAccept(event.target.checked);
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={form.pending} pendingLabel="Saving…">
          Save decision
        </SubmitButton>
        <p role="status" className="text-sm">
          {saved ?? ''}
        </p>
      </div>
    </form>
  );
}

function decisionWho(item: QualificationDecisionView): string {
  return item.origin === 'AUTOMATIC'
    ? 'Rules'
    : (item.decidedBy ?? 'A former member');
}

function QualificationSection({
  view,
  workspaceId,
  canDecide,
  canApprove,
}: {
  readonly view: LeadQualificationView;
  readonly workspaceId: string;
  readonly canDecide: boolean;
  readonly canApprove: boolean;
}) {
  const current = view.qualification;
  // A decision made before the person became blocked stays in the history, but sends nothing.
  const blockedNow = view.eligibility.checks.some(
    (check) => check.scope === 'lead' && check.status === 'blocked',
  );
  const columns: DataColumn<QualificationDecisionView>[] = [
    {
      key: 'version',
      header: 'Decision',
      rowHeader: true,
      cell: (item) => `Decision ${String(item.version)}`,
    },
    {
      key: 'state',
      header: 'State',
      cell: (item) => <Status kind="qualification" value={item.state} />,
    },
    { key: 'who', header: 'By', cell: decisionWho },
    {
      key: 'when',
      header: 'When',
      cell: (item) => formatDateTime(item.decidedAt),
    },
    {
      key: 'why',
      header: 'Why',
      cell: (item) =>
        item.note ?? item.reasons.map((reason) => reason.message).join(' '),
    },
  ];
  return (
    <Card aria-labelledby="qualification-title">
      <CardHeader>
        <CardTitle id="qualification-title">Qualification</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {current?.state === 'QUALIFIED' && blockedNow ? (
          <Alert variant="destructive">
            <AlertTitle>Qualified, but blocked since</AlertTitle>
            <AlertDescription className="text-destructive">
              This person may not be emailed now (see eligibility). The decision
              can&apos;t change that.
            </AlertDescription>
          </Alert>
        ) : null}
        {current === null ? (
          <p className="text-sm">Not qualified yet.</p>
        ) : (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Status kind="qualification" value={current.state} />
              <span className="text-sm text-muted-foreground">
                {decisionWho(current)}, {formatDateTime(current.decidedAt)}
              </span>
            </div>
            <ul className="list-disc pl-5 text-sm" aria-label="Reasons">
              {current.reasons.map((reason, index) => (
                <li key={`${reason.code}-${String(index)}`}>
                  {reason.message}
                </li>
              ))}
            </ul>
            {current.note === null ? null : (
              <p className="text-sm">
                <span className="font-medium">Note:</span> {current.note}
              </p>
            )}
            {current.acceptedReviewReasons.length === 0 ? null : (
              <p className="text-sm">
                Accepted checks: {current.acceptedReviewReasons.join(', ')}.
              </p>
            )}
          </div>
        )}
        {canDecide ? (
          <DecisionForm
            key={current?.id ?? 'none'}
            view={view}
            workspaceId={workspaceId}
            canApprove={canApprove}
          />
        ) : null}
        {view.history.length === 0 ? null : (
          <DataTable
            label="Decisions"
            columns={columns}
            rows={view.history}
            rowKey={(item) => item.id}
            status="success"
            empty={null}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function LeadQualification({
  campaignId,
  contactId,
}: {
  readonly campaignId: string;
  readonly contactId: string;
}) {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const params = { workspaceId, campaignId, contactId };
  const [polling, setPolling] = useState(false);
  const lead = useApiQuery(
    API.qualification.lead,
    { params },
    polling ? { poll: QUALIFICATION_RUN_POLL } : {},
  );
  const data = lead.data;
  // Refreshes while a run or an address recheck is queued or running.
  const pending =
    data?.pending === true || data?.quality.recheck.pending === true;
  if (polling !== pending) {
    setPolling(pending);
  }
  const qualify = useApiMutation(API.qualification.qualify);
  const [message, setMessage] = useState<string | null>(null);

  if (data === undefined) {
    return lead.status === 'error' ? (
      <RetryState
        title="We couldn't load this lead"
        error={lead.error}
        onRetry={lead.retry}
      />
    ) : (
      <div className="grid gap-3">
        <span className="sr-only">Loading the lead</span>
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  async function run() {
    setMessage(null);
    const result = await qualify.mutate({ params, body: {} });
    if (!result.ok) {
      if (!result.signedOut) {
        setMessage(errorMessage(result.error));
      }
      return;
    }
    setMessage(
      result.data.state === 'running'
        ? 'A qualification is already queued.'
        : 'Qualification is queued.',
    );
  }

  const name = data.contact.name ?? data.contact.email ?? 'Unnamed person';
  return (
    <div className="grid gap-6">
      <PageHeader
        title={name}
        {...(data.qualification === null
          ? {}
          : {
              badge: (
                <Status kind="qualification" value={data.qualification.state} />
              ),
            })}
        description={[
          data.contact.title,
          data.contact.company?.name,
          `Lead of ${data.campaign.name}`,
        ]
          .filter((part): part is string => part !== null && part !== undefined)
          .join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('research.run') ? (
              <Button
                type="button"
                disabled={qualify.pending || data.pending}
                onClick={() => void run()}
              >
                {data.fit === null ? 'Qualify this lead' : 'Qualify again'}
              </Button>
            ) : null}
            <Link
              href={leadsHref(workspaceId, campaignId)}
              className={buttonVariants({ variant: 'outline' })}
            >
              <ArrowLeft aria-hidden="true" />
              All leads
            </Link>
          </div>
        }
      />
      {message === null ? null : (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {data.pending ? (
        <Alert>
          <AlertTitle>Qualification is queued</AlertTitle>
          <AlertDescription>
            The agent reads the company&apos;s research, then the lead is scored
            and decided. This page refreshes when it is done.
          </AlertDescription>
        </Alert>
      ) : null}
      <ContactQualitySection
        quality={data.quality}
        workspaceId={workspaceId}
        contactId={contactId}
        canRecheck={can('verifications.run')}
      />
      <FitSection fit={data.fit} />
      <EligibilitySection view={data} />
      <QualificationSection
        view={data}
        workspaceId={workspaceId}
        canDecide={can('campaigns.write')}
        canApprove={can('drafts.approve')}
      />
    </div>
  );
}

'use client';

// One lead's profile (task 11B, docs/decisions.md D-11B-*): why the lead exists (its sources,
// with links to the import or page they came from, and the evidence about the person and their
// company), the company's research, the contact data's quality and checks, score history, notes,
// tags, campaigns with their decisions, and the activity of those decisions. Members with the
// permissions correct the data, tag, note, assign to a campaign, and approve or reject the lead
// in a campaign. Everything from imports, providers, pages and notes is untrusted text: shown as
// text only, and linked only when it is an http(s) URL.
import { API, type LeadDetail } from '@lead-fennec-ai/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Status } from '@/components/data/status-label';
import { RetryState } from '@/components/feedback/retry-state';
import {
  AssignFormView,
  CorrectionFormView,
  DecisionFormView,
  NoteFormView,
  TagsFormView,
} from '@/components/leads/lead-forms';
import { ContactQualitySection } from '@/components/qualification/contact-quality';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/typography';
import { formatDateTime } from '@/lib/format';
import { leadListHref, SOURCE_LABELS } from '@/lib/leads';
import { leadHref } from '@/lib/qualification';
import { useApiQuery } from '@/lib/query';
import { companyProfileHref, safeLinkUrl } from '@/lib/research';
import { useWorkspace } from '@/lib/workspace';

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <Card aria-labelledby={`${id}-title`}>
      <CardHeader>
        <CardTitle id={`${id}-title`}>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

const Muted = ({ children }: { readonly children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

function Origins({
  workspaceId,
  lead,
}: {
  readonly workspaceId: string;
  readonly lead: LeadDetail;
}) {
  const evidence = useApiQuery(API.leads.evidence, {
    params: { workspaceId, contactId: lead.id },
    query: { limit: 10 },
  });
  return (
    <Section id="origins" title="Why this lead exists">
      {lead.sources.length === 0 ? (
        <Muted>No record says where this lead came from.</Muted>
      ) : (
        <ul className="grid gap-2 text-sm">
          {lead.sources.map((source) => {
            const page = safeLinkUrl(source.url);
            return (
              <li key={source.id} className="grid gap-0.5">
                <span>
                  {SOURCE_LABELS[source.provider]}, retrieved{' '}
                  {formatDateTime(source.retrievedAt)}
                  {source.confidence === null
                    ? ''
                    : ` (role match ${String(source.confidence)} of 100)`}
                </span>
                <span className="flex flex-wrap gap-3">
                  {source.importId === null ? null : (
                    <Link
                      href={`/workspaces/${workspaceId}/imports/${source.importId}`}
                      className="underline underline-offset-4"
                    >
                      Open the import
                    </Link>
                  )}
                  {page === null ? null : (
                    <a
                      href={page}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                      className="break-all underline underline-offset-4"
                    >
                      {page}
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="text-sm font-semibold">Evidence</h3>
      {evidence.data === undefined ? (
        evidence.status === 'error' ? (
          <Muted>The evidence couldn’t be loaded.</Muted>
        ) : (
          <Skeleton className="h-10" />
        )
      ) : evidence.data.items.length === 0 ? (
        <Muted>No evidence about this person or their company yet.</Muted>
      ) : (
        <ul className="grid gap-3 text-sm">
          {evidence.data.items.map((item) => {
            const url = safeLinkUrl(item.sourceUrl);
            return (
              <li key={item.id} className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  About the {item.about}, {formatDateTime(item.capturedAt)}
                </span>
                <blockquote className="border-l-2 pl-3">
                  {item.excerpt}
                </blockquote>
                {url === null ? null : (
                  <a
                    href={url}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="break-all text-xs underline underline-offset-4"
                  >
                    {url}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function LeadProfile({ contactId }: { readonly contactId: string }) {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const lead = useApiQuery(API.leads.lead, {
    params: { workspaceId, contactId },
  });
  const data = lead.data;
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
  const name = data.name ?? data.email ?? 'Unnamed person';
  const canWrite = can('contacts.write');
  return (
    <div className="grid gap-6">
      <PageHeader
        title={name}
        description={[data.title, data.company?.name, data.countryCode]
          .filter((part): part is string => part !== null && part !== undefined)
          .join(' · ')}
        actions={
          <Link
            href={leadListHref(workspaceId)}
            className={buttonVariants({ variant: 'outline' })}
          >
            <ArrowLeft aria-hidden="true" />
            All leads
          </Link>
        }
      />
      {data.tags.length === 0 ? null : (
        <ul aria-label="Tags" className="flex flex-wrap gap-2">
          {data.tags.map((tag) => (
            <li key={tag} className="rounded-full border px-2 py-0.5 text-xs">
              {tag}
            </li>
          ))}
        </ul>
      )}

      <Origins workspaceId={workspaceId} lead={data} />

      <Section id="research" title="Company research">
        {data.company === null ? (
          <Muted>The lead has no company.</Muted>
        ) : (
          <div className="grid gap-1 text-sm">
            <span>
              {data.research === null
                ? 'The company hasn’t been researched yet.'
                : `Version ${String(data.research.version)}${data.research.completedAt === null ? '' : `, ${formatDateTime(data.research.completedAt)}`}.`}
            </span>
            <Link
              href={companyProfileHref(workspaceId, data.company.id)}
              className="underline underline-offset-4"
            >
              Open {data.company.name}
            </Link>
          </div>
        )}
      </Section>

      <ContactQualitySection
        quality={data.quality}
        workspaceId={workspaceId}
        contactId={data.id}
        canRecheck={can('verifications.run')}
      />

      <Section id="checks" title="Address checks">
        {data.verifications.length === 0 ? (
          <Muted>No address of this person was checked.</Muted>
        ) : (
          <ul className="grid gap-1 text-sm">
            {data.verifications.map((check) => (
              <li
                key={`${check.address}:${check.checkedAt}`}
                className="flex flex-wrap items-center gap-2"
              >
                <Status kind="emailCheck" value={check.status} />
                <span className="break-all">{check.address}</span>
                <span className="text-muted-foreground">
                  {formatDateTime(check.checkedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="scores" title="Score history">
        {data.scoreHistory.length === 0 ? (
          <Muted>Not scored in any campaign.</Muted>
        ) : (
          <ul className="grid gap-1 text-sm">
            {data.scoreHistory.map((score) => (
              <li
                key={`${score.campaignId}:${String(score.version)}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="tabular-nums">{score.value}</span>
                <Status kind="scoreBand" value={score.band} />
                <span>
                  {score.campaignName}, version {String(score.version)},{' '}
                  {formatDateTime(score.scoredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="campaigns" title="Campaigns">
        {data.campaigns.length === 0 ? (
          <Muted>The lead isn’t in any campaign.</Muted>
        ) : (
          <ul className="grid gap-4">
            {data.campaigns.map((campaign) => (
              <li
                key={campaign.id}
                className="grid gap-2 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={leadHref(workspaceId, campaign.id, data.id)}
                    className="font-medium underline underline-offset-4"
                  >
                    {campaign.name}
                  </Link>
                  <Status kind="campaign" value={campaign.status} />
                  {campaign.qualification === null ? (
                    <span className="text-sm text-muted-foreground">
                      Not qualified yet
                    </span>
                  ) : (
                    <Status
                      kind="qualification"
                      value={campaign.qualification.state}
                    />
                  )}
                </div>
                <span className="text-sm text-muted-foreground">
                  {campaign.onLeadList ? 'On its lead list' : 'Enrolled'}
                  {campaign.score === null
                    ? ', not scored'
                    : `, score ${String(campaign.score.value)}`}
                </span>
                {can('campaigns.write') ? (
                  <DecisionFormView
                    workspaceId={workspaceId}
                    lead={data}
                    campaign={campaign}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {can('campaigns.write') ? (
          <AssignFormView workspaceId={workspaceId} lead={data} />
        ) : null}
      </Section>

      <Section id="activity" title="Activity">
        {data.activity.length === 0 ? (
          <Muted>No decisions yet.</Muted>
        ) : (
          <ol className="grid gap-2 text-sm">
            {data.activity.map((item) => (
              <li
                key={`${item.campaignId}:${String(item.version)}`}
                className="grid gap-0.5"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Status kind="qualification" value={item.state} />
                  {item.campaignName}, {formatDateTime(item.decidedAt)}, by{' '}
                  {item.origin === 'PERSON'
                    ? (item.decidedBy ?? 'a former member')
                    : 'the rules'}
                </span>
                {item.reasons.map((reason) => (
                  <span key={reason} className="text-muted-foreground">
                    {reason}
                  </span>
                ))}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section id="notes" title="Notes">
        {data.notes.length === 0 ? (
          <Muted>No notes yet.</Muted>
        ) : (
          <ul className="grid gap-3 text-sm">
            {data.notes.map((note) => (
              <li key={note.id} className="grid gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {note.author ?? 'A former member'},{' '}
                  {formatDateTime(note.createdAt)}
                </span>
                <span className="whitespace-pre-wrap">{note.body}</span>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <NoteFormView workspaceId={workspaceId} lead={data} />
        ) : null}
      </Section>

      {canWrite ? (
        <>
          <Section id="tags" title="Edit tags">
            <TagsFormView workspaceId={workspaceId} lead={data} />
          </Section>
          <Section id="correct" title="Correct the data">
            <Muted>
              Correcting a name, title, address or country withdraws the drafts
              written for the old data and sends every campaign’s decision back
              to Review.
            </Muted>
            <CorrectionFormView workspaceId={workspaceId} lead={data} />
          </Section>
        </>
      ) : null}
    </div>
  );
}

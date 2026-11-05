'use client';

// The campaign setup wizard (task 06B, docs/decisions.md D-06B-*). The stage is in the address
// bar (?stage=…), so Back, the browser's back button and reloading all keep the place. Every
// save sends the version the page holds; another tab's save makes it a conflict, shown with a
// way to load the latest version. Only drafts can be changed, by members with campaigns.write.
import { API, type Campaign } from '@lead-fennec-ai/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Status } from '@/components/data/status-label';
import { EmptyState } from '@/components/feedback/empty-state';
import { RetryState } from '@/components/feedback/retry-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/typography';
import { errorMessage } from '@/lib/api';
import { stageFromParam, type StageKey } from '@/lib/campaign-wizard';
import { formatTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useWorkspace } from '@/lib/workspace';
import {
  MailboxStage,
  ReviewStage,
  ScheduleStage,
  SequenceStage,
} from './delivery-stages';
import {
  AudienceStage,
  BusinessProfileStage,
  FiltersStage,
  OfferStage,
} from './profile-stages';
import type { StageContext } from './stage-frame';

const STAGE_COMPONENTS = {
  'business-profile': BusinessProfileStage,
  audience: AudienceStage,
  offer: OfferStage,
  filters: FiltersStage,
  mailbox: MailboxStage,
  sequence: SequenceStage,
  schedule: ScheduleStage,
  review: ReviewStage,
} as const satisfies Record<
  StageKey,
  (props: { readonly context: StageContext }) => React.ReactNode
>;

/** The newer of what the page loaded and what it saved (a reload may lag behind a save). */
function latest(
  loaded: Campaign | undefined,
  saved: Campaign | null,
): Campaign | undefined {
  if (saved === null) {
    return loaded;
  }
  return loaded === undefined || saved.version >= loaded.version
    ? saved
    : loaded;
}

export function campaignsHref(workspaceId: string): string {
  return `/workspaces/${workspaceId}/campaigns`;
}

export function campaignHref(
  workspaceId: string,
  campaignId: string,
  stage?: StageKey,
): string {
  const base = `${campaignsHref(workspaceId)}/${campaignId}`;
  return stage === undefined ? base : `${base}?stage=${stage}`;
}

export function CampaignWizard({
  campaignId,
}: {
  readonly campaignId: string;
}) {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const stage = stageFromParam(search.get('stage'));
  const query = useApiQuery(API.campaigns.get, {
    params: { workspaceId, campaignId },
  });
  const options = useApiQuery(API.campaigns.options, {
    params: { workspaceId },
  });
  const duplicate = useApiMutation(API.campaigns.duplicate);
  const [saved, setSaved] = useState<Campaign | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const campaign = latest(query.data, saved);

  const back = (
    <Link
      href={campaignsHref(workspaceId)}
      className={buttonVariants({ variant: 'outline' })}
    >
      <ArrowLeft aria-hidden="true" />
      All campaigns
    </Link>
  );

  if (campaign === undefined) {
    if (query.status === 'error') {
      return query.error.code === 'not_found' ? (
        <EmptyState
          title="This campaign doesn't exist"
          description="It may have been removed, or it belongs to another workspace."
          action={back}
        />
      ) : (
        <RetryState
          title="We couldn't load this campaign"
          error={query.error}
          onRetry={query.retry}
        />
      );
    }
    return (
      <div className="grid gap-4" aria-busy="true">
        <span className="sr-only">Loading the campaign</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const isDraft = campaign.status === 'DRAFT';
  const canWrite = can('campaigns.write');
  const context: StageContext = {
    workspaceId,
    campaign,
    options,
    editable: isDraft && canWrite,
    stage,
    arrived,
    hrefOf: (target) => `${pathname}?stage=${target}`,
    go: (target) => {
      setArrived(true);
      router.push(`${pathname}?stage=${target}`);
    },
    onSaved: (next) => {
      setSaved(next);
      setConflict(false);
      setSavedAt(
        next.status === 'ACTIVE'
          ? `Campaign started at ${formatTime(next.updatedAt)}.`
          : `Draft saved at ${formatTime(next.updatedAt)}.`,
      );
    },
    onConflict: () => {
      setConflict(true);
    },
  };
  const StageComponent = STAGE_COMPONENTS[stage];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={campaign.name}
        badge={<Status kind="campaign" value={campaign.status} />}
        description="Set the campaign up step by step. You can save at any point, leave, and come back later."
        actions={back}
      />
      <p role="status" className="-mt-3 text-sm text-muted-foreground">
        {savedAt ?? ''}
      </p>
      {conflict ? (
        <Alert variant="destructive">
          <AlertTitle>This campaign was changed somewhere else</AlertTitle>
          <AlertDescription className="grid justify-items-start gap-3 text-destructive">
            <p>
              Someone (or you, in another tab) saved it after you opened it.
              Your changes on this step weren&apos;t saved. Load the latest
              version, then make them again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConflict(false);
                setSaved(null);
                query.retry();
              }}
            >
              Load the latest version
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {isDraft && canWrite ? null : (
        <Alert>
          <AlertTitle>You can look, but not change it</AlertTitle>
          <AlertDescription className="grid justify-items-start gap-3">
            <p>
              {isDraft
                ? 'Your role can view campaigns but not change them.'
                : 'Only draft campaigns can be changed. Make a copy to set up a new draft from this one.'}
            </p>
            {!isDraft && canWrite ? (
              <Button
                variant="outline"
                size="sm"
                disabled={duplicate.pending}
                onClick={() => {
                  setCopyError(null);
                  void duplicate
                    .mutate({
                      params: { workspaceId, campaignId: campaign.id },
                      body: {},
                    })
                    .then((result) => {
                      if (result.ok) {
                        router.push(campaignHref(workspaceId, result.data.id));
                      } else if (!result.signedOut) {
                        setCopyError(errorMessage(result.error));
                      }
                    });
                }}
              >
                {duplicate.pending ? 'Copying…' : 'Make a copy'}
              </Button>
            ) : null}
            {copyError === null ? null : (
              <p className="text-destructive">{copyError}</p>
            )}
          </AlertDescription>
        </Alert>
      )}
      {/* A new version (a save, or the latest after a conflict) starts the stage's form again. */}
      <StageComponent
        key={`${stage}-${String(campaign.version)}`}
        context={context}
      />
    </div>
  );
}

'use client';

// The review screen's start section (task 06C, docs/decisions.md D-06C-*): every activation
// check with its reasons, a link to the stage that fixes a setting, and Start campaign, which
// asks first and is enabled only when every check passes for the version on screen. Services
// that aren't built yet are listed as "Not available yet": they block, they aren't hidden.
import {
  API,
  type ActivationCheck,
  type CampaignSetupStage,
} from '@lead-fennec-ai/shared';
import { CircleCheck, CircleX } from 'lucide-react';
import Link from 'next/link';
import { StatusLabel, type StatusTone } from '@/components/data/status-label';
import { ConfirmButton } from '@/components/feedback/confirm';
import { RetryState } from '@/components/feedback/retry-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { WIZARD_STAGES } from '@/lib/campaign-wizard';
import { useApiMutation, useApiQuery } from '@/lib/query';
import type { StageContext } from './stage-frame';

const STATE: Readonly<
  Record<
    ActivationCheck['kind'] | 'passed',
    { label: string; tone: StatusTone }
  >
> = {
  passed: { label: 'Passes', tone: 'success' },
  setting: { label: 'To do', tone: 'warning' },
  workspace: { label: 'Needs a workspace change', tone: 'warning' },
  service: { label: 'Not available yet', tone: 'neutral' },
};

const stageLabel = (stage: CampaignSetupStage) =>
  WIZARD_STAGES.find((s) => s.key === stage)?.label ?? stage;

function CheckItem({
  check,
  editable,
  hrefOf,
  onFix,
}: {
  readonly check: ActivationCheck;
  readonly editable: boolean;
  readonly hrefOf: StageContext['hrefOf'];
  readonly onFix: (stage: CampaignSetupStage) => void;
}) {
  const state = STATE[check.passed ? 'passed' : check.kind];
  const Icon = check.passed ? CircleCheck : CircleX;
  const fixable =
    !check.passed &&
    editable &&
    check.stage !== null &&
    check.stage !== 'review';
  return (
    <li
      data-check={check.key}
      data-passed={check.passed}
      className="grid gap-1.5 p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon
          aria-hidden="true"
          className={
            check.passed
              ? 'size-4 shrink-0 text-success'
              : 'size-4 shrink-0 text-muted-foreground'
          }
        />
        <span className="font-medium">{check.label}</span>
        <StatusLabel tone={state.tone}>{state.label}</StatusLabel>
      </div>
      {check.reasons.length === 0 ? null : (
        <ul className="grid list-disc gap-0.5 pl-10 text-sm text-muted-foreground">
          {check.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {fixable && check.stage !== null ? (
        <Link
          href={hrefOf(check.stage)}
          className="pl-6 text-sm font-medium text-primary underline-offset-4 hover:underline"
          onClick={(event) => {
            event.preventDefault();
            if (check.stage !== null) {
              onFix(check.stage);
            }
          }}
        >
          Fix in {stageLabel(check.stage)}
          <span className="sr-only"> ({check.label})</span>
        </Link>
      ) : null}
    </li>
  );
}

export function ActivationPanel({
  context,
  dirty,
  onFix,
}: {
  readonly context: StageContext;
  /** The review form has unsaved changes: save them before starting. */
  readonly dirty: boolean;
  readonly onFix: (stage: CampaignSetupStage) => void;
}) {
  const { campaign, workspaceId } = context;
  const params = { workspaceId, campaignId: campaign.id };
  const readiness = useApiQuery(API.campaigns.readiness, { params });
  const activate = useApiMutation(API.campaigns.activate);
  const report = readiness.data;
  // A report made for an older version (a save is reloading it) doesn't count.
  const current = report?.version === campaign.version;
  const blocked = report?.checks.filter((check) => !check.passed) ?? [];
  const canStart = context.editable && current && report.ready && !dirty;
  const hint =
    campaign.status === 'ACTIVE'
      ? 'This campaign has started.'
      : !context.editable
        ? 'Only a draft can be started, by someone who may change campaigns.'
        : dirty
          ? 'Save your changes first.'
          : canStart
            ? 'You will be asked to confirm.'
            : 'You can start the campaign when every check passes.';

  return (
    <section
      aria-labelledby="activation-heading"
      data-slot="activation"
      className="grid gap-3"
    >
      <h3 id="activation-heading" className="text-base font-semibold">
        Before the campaign can start
      </h3>
      {readiness.status === 'error' ? (
        <RetryState
          title="We couldn't check the campaign"
          error={readiness.error}
          onRetry={readiness.retry}
        />
      ) : null}
      {report === undefined ? (
        readiness.status === 'loading' ? (
          <div className="grid gap-2" aria-busy="true">
            <span className="sr-only">Checking the campaign</span>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : null
      ) : (
        <>
          <p role="status" className="text-sm">
            {report.ready
              ? 'Every check passes.'
              : `${String(blocked.length)} of ${String(report.checks.length)} checks don't pass yet. Nothing is sent until they all do.`}
          </p>
          <ul aria-label="Checks" className="grid divide-y rounded-xl border">
            {report.checks.map((check) => (
              <CheckItem
                key={check.key}
                check={check}
                editable={context.editable}
                hrefOf={context.hrefOf}
                onFix={onFix}
              />
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <ConfirmButton
          type="button"
          disabled={!canStart}
          confirm={{
            title: `Start ${campaign.name}?`,
            description:
              'The campaign begins on its schedule: leads join it, and emails are prepared and sent from its mailbox, each after a person approves it if approval is required.',
            confirmLabel: 'Start campaign',
            pendingLabel: 'Starting…',
            onConfirm: async () => {
              const result = await activate.mutate({
                params,
                body: { version: campaign.version },
              });
              if (result.ok) {
                context.onSaved(result.data);
                return null;
              }
              if (result.signedOut) {
                return null;
              }
              if (result.error.code === 'version_conflict') {
                context.onConflict();
                return 'This campaign was changed since you opened it. Load the latest version first.';
              }
              if (result.error.code === 'campaign_not_ready') {
                readiness.retry();
                return "The campaign can't start yet. The list of checks has been updated.";
              }
              return errorMessage(result.error);
            },
          }}
        >
          Start campaign
        </ConfirmButton>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </div>
    </section>
  );
}

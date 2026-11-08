'use client';

// A contact's data quality on the lead page (task 08C, docs/decisions.md D-08C-05): where the
// data came from and when, how well the person fits the targeted roles, the newest check of the
// address (a provider's own claim is shown as a claim, never as a check), and the manual recheck
// with its limits. The API decides all of it; nothing here permits sending.
import { API, type ContactQuality } from '@lead-fennec-ai/shared';
import { useState } from 'react';
import { Status } from '@/components/data/status-label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation } from '@/lib/query';

const SOURCE_TEXT: Readonly<Record<string, string>> = {
  APOLLO: 'Apollo',
  CSV_IMPORT: 'CSV import',
  MANUAL: 'Entered by a person',
  WEBSITE: 'Company website',
  FAKE: 'Development data (synthetic)',
};

const RECHECK_ERROR_TEXT: Readonly<Record<string, string>> = {
  verification_unavailable:
    'No email verification service is set up, so the address could not be checked.',
  usage_limit_reached: 'The plan has no address checks left for this period.',
};

export function ContactQualitySection({
  quality,
  workspaceId,
  contactId,
  canRecheck,
}: {
  readonly quality: ContactQuality;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly canRecheck: boolean;
}) {
  const recheck = useApiMutation(API.enrichment.recheck);
  const [message, setMessage] = useState<string | null>(null);
  const { source, email } = quality;

  async function requestRecheck() {
    setMessage(null);
    const result = await recheck.mutate({
      params: { workspaceId, contactId },
      body: {},
    });
    if (!result.ok) {
      if (!result.signedOut) {
        setMessage(errorMessage(result.error));
      }
      return;
    }
    setMessage(
      result.data.status === 'already_queued'
        ? 'A check is already queued.'
        : 'The address will be checked again shortly.',
    );
  }

  return (
    <Card aria-labelledby="quality-title">
      <CardHeader className="flex flex-wrap items-center gap-2">
        <CardTitle id="quality-title">Contact data</CardTitle>
        <Status kind="contactQuality" value={quality.level} />
      </CardHeader>
      <CardContent className="grid gap-4">
        {quality.reasons.length === 0 ? null : (
          <ul className="grid list-disc gap-0.5 pl-5 text-sm">
            {quality.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Source</dt>
            <dd>
              {source === null
                ? 'Unknown'
                : `${SOURCE_TEXT[source.provider] ?? source.provider}, retrieved ${formatDateTime(source.retrievedAt)}${source.fresh ? '' : ' (old)'}`}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Role match</dt>
            <dd>
              {quality.confidence === null
                ? 'Not rated'
                : `${String(quality.confidence)} of 100`}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="break-all">{email?.address ?? 'None'}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Address check</dt>
            <dd className="grid gap-1">
              {email === null ? (
                'Nothing to check'
              ) : (
                <>
                  <Status kind="emailState" value={email.state} />
                  <span>
                    {email.check === null
                      ? 'Never checked.'
                      : `Checked ${formatDateTime(email.check.checkedAt)}${email.check.reason === null ? '' : ` (${email.check.reason.replaceAll('_', ' ')})`}.`}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
        {email?.providerClaim == null ? null : (
          <p className="text-xs text-muted-foreground">
            The data provider says the address is{' '}
            {email.providerClaim === 'provider_verified'
              ? 'verified'
              : 'not verified'}
            . That is the provider&apos;s claim, not a check.
          </p>
        )}
        {quality.recheck.lastErrorCode === null ? null : (
          <p className="text-sm text-destructive">
            The last check failed:{' '}
            {RECHECK_ERROR_TEXT[quality.recheck.lastErrorCode] ??
              'the address could not be checked.'}
          </p>
        )}
        {canRecheck && email !== null ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={
                recheck.pending ||
                quality.recheck.pending ||
                quality.recheck.availableAt !== null
              }
              onClick={() => void requestRecheck()}
            >
              Check the address again
            </Button>
            <span className="text-xs text-muted-foreground">
              {quality.recheck.pending
                ? 'A check is queued.'
                : quality.recheck.availableAt === null
                  ? 'Once a day per contact, 50 a day per workspace.'
                  : `It can be checked again after ${formatDateTime(quality.recheck.availableAt)}.`}
            </span>
          </div>
        ) : null}
        {message === null ? null : (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

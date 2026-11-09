'use client';

// Privacy on a lead's profile (task 11C, docs/decisions.md D-11C-03 and D-11C-04): put the lead's
// address on the do-not-contact list (their drafts are withdrawn and their decisions reopened),
// or erase the lead on their request, which keeps only the address on the list. Both need
// suppressions.manage; the erasure also needs contacts.write and names the version the member
// saw, so it can't act on data the member hasn't seen. The API decides; this only asks.
import {
  API,
  MEMBER_SUPPRESSION_REASONS,
  SUPPRESSION_REASON_LABELS,
  leadSuppressRequestSchema,
  type LeadDetail,
} from '@lead-fennec-ai/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmButton } from '@/components/feedback/confirm';
import {
  FormError,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form-field';
import { errorMessage } from '@/lib/api';
import { leadListHref } from '@/lib/leads';
import { useApiMutation } from '@/lib/query';
import { useFormSubmit } from '@/lib/use-form-submit';

type MemberReason = (typeof MEMBER_SUPPRESSION_REASONS)[number];

interface LeadPrivacyProps {
  readonly workspaceId: string;
  readonly lead: LeadDetail;
  /** contacts.write: needed (with suppressions.manage) to erase the lead. */
  readonly canErase: boolean;
}

export function LeadPrivacy({ workspaceId, lead, canErase }: LeadPrivacyProps) {
  const router = useRouter();
  const suppress = useApiMutation(API.leads.suppress);
  const erase = useApiMutation(API.leads.deletionRequest);
  const [reason, setReason] = useState<MemberReason>('OPT_OUT');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const submit = useFormSubmit({
    schema: leadSuppressRequestSchema,
    submit: (body) =>
      suppress.mutate({ params: { workspaceId, contactId: lead.id }, body }),
    onSuccess: () => {
      setNote('');
      setDone(
        'Added. Drafts written for this lead were withdrawn, and the campaigns must decide again.',
      );
    },
  });

  return (
    <div className="grid gap-6">
      {lead.doNotContact ? (
        <p className="text-sm">
          This lead’s address is on the do-not-contact list: it can’t be emailed
          or added to a campaign.
        </p>
      ) : lead.email === null ? (
        <p className="text-sm text-muted-foreground">
          This lead has no email address to put on the do-not-contact list.
        </p>
      ) : (
        <form
          noValidate
          aria-label="Do not contact"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setDone(null);
            void submit.handleSubmit({
              reason,
              ...(note.trim() === '' ? {} : { note }),
            });
          }}
        >
          <FormError message={submit.formError} />
          <SelectField
            label="Why"
            name="reason"
            value={reason}
            error={submit.errors['reason']}
            onChange={(event) => {
              setReason(event.target.value as MemberReason);
            }}
          >
            {MEMBER_SUPPRESSION_REASONS.map((value) => (
              <option key={value} value={value}>
                {SUPPRESSION_REASON_LABELS[value]}
              </option>
            ))}
          </SelectField>
          <TextareaField
            label="Note (optional)"
            name="note"
            value={note}
            hint="Kept with the entry. Don't write anything the person wouldn't want kept."
            error={submit.errors['note']}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pending={submit.pending} pendingLabel="Adding…">
              Add to the do-not-contact list
            </SubmitButton>
            {done === null ? null : (
              <p role="status" className="text-sm">
                {done}
              </p>
            )}
          </div>
        </form>
      )}
      {canErase ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            On the person’s request, erase everything the workspace has about
            them: their data, sources, checks, scores, decisions, drafts, notes
            and tags.
            {lead.email === null
              ? ' They have no address, so nothing stops them from being imported again.'
              : ' Only their address stays, on the do-not-contact list, so they are never imported or contacted again.'}
          </p>
          <div>
            <ConfirmButton
              variant="destructive"
              confirm={{
                title: 'Erase this lead?',
                description:
                  'This deletes the lead and everything about them for good. It cannot be undone.',
                confirmLabel: 'Erase the lead',
                cancelLabel: 'Keep the lead',
                pendingLabel: 'Erasing…',
                destructive: true,
                onConfirm: async () => {
                  const result = await erase.mutate({
                    params: { workspaceId, contactId: lead.id },
                    body: { version: lead.version },
                  });
                  if (result.ok) {
                    router.push(`${leadListHref(workspaceId)}?erased=1`);
                    return null;
                  }
                  return result.signedOut ? null : errorMessage(result.error);
                },
              }}
            >
              Erase this lead’s data
            </ConfirmButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

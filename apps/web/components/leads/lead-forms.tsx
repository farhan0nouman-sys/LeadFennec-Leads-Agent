'use client';

// The changes a member makes on a lead's profile (task 11B, docs/decisions.md D-11B-*):
// corrections, tags, notes, assignment to a campaign, and a campaign decision. Each form checks its
// input with the shared request schema first; the API checks everything again. Every change but a
// note names the lead's version, so a stale page fails safely ("The lead changed since you opened
// it…") instead of overwriting someone else's change.
import {
  API,
  LEAD_CORRECTION_FIELDS,
  leadAssignmentRequestSchema,
  leadCorrectionRequestSchema,
  leadNoteRequestSchema,
  leadTagsRequestSchema,
  qualificationDecisionRequestSchema,
  type LeadDetail,
} from '@lead-fennec-ai/shared';
import { useState } from 'react';
import {
  FormError,
  FormField,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form-field';
import {
  CORRECTION_LABELS,
  correctionChanges,
  correctionForm,
  tagsFromText,
  type CorrectionForm,
} from '@/lib/leads';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useFormSubmit } from '@/lib/use-form-submit';

interface LeadFormProps {
  readonly workspaceId: string;
  readonly lead: LeadDetail;
}

/** Corrects the lead's data, with a reason. A material change sends decisions back to Review. */
export function CorrectionFormView({ workspaceId, lead }: LeadFormProps) {
  const correct = useApiMutation(API.leads.correct);
  const start = correctionForm(lead);
  const [form, setForm] = useState<CorrectionForm>(start);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const submit = useFormSubmit({
    schema: leadCorrectionRequestSchema,
    submit: (body) =>
      correct.mutate({ params: { workspaceId, contactId: lead.id }, body }),
    onSuccess: () => {
      setReason('');
      setDone(
        'Saved. Drafts written for the old data were withdrawn, and the campaigns must decide again.',
      );
    },
  });
  return (
    <form
      noValidate
      aria-label="Correct the lead's data"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setDone(null);
        void submit.handleSubmit({
          version: lead.version,
          changes: correctionChanges(start, form),
          reason,
        });
      }}
    >
      <FormError
        message={submit.formError ?? submit.errors['changes'] ?? null}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {LEAD_CORRECTION_FIELDS.map((field) => (
          <FormField
            key={field}
            label={CORRECTION_LABELS[field]}
            name={field}
            value={form[field]}
            {...(field === 'countryCode'
              ? { hint: 'Leave empty to use the company’s country.' }
              : {})}
            error={submit.errors[`changes.${field}`]}
            onChange={(event) => {
              setForm({ ...form, [field]: event.target.value });
            }}
          />
        ))}
      </div>
      <TextareaField
        label="Why is it being corrected?"
        name="reason"
        value={reason}
        hint="Kept as a note on the lead."
        error={submit.errors['reason']}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      {done === null ? null : (
        <p role="status" className="text-sm">
          {done}
        </p>
      )}
      <div>
        <SubmitButton pending={submit.pending} pendingLabel="Saving…">
          Save the correction
        </SubmitButton>
      </div>
    </form>
  );
}

/** Replaces the lead's tags. */
export function TagsFormView({ workspaceId, lead }: LeadFormProps) {
  const setTags = useApiMutation(API.leads.tags);
  const [text, setText] = useState(lead.tags.join(', '));
  const submit = useFormSubmit({
    schema: leadTagsRequestSchema,
    submit: (body) =>
      setTags.mutate({ params: { workspaceId, contactId: lead.id }, body }),
  });
  return (
    <form
      noValidate
      aria-label="Tags"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.handleSubmit({
          version: lead.version,
          tags: tagsFromText(text),
        });
      }}
    >
      <FormError message={submit.formError} />
      <FormField
        label="Tags"
        name="tags"
        value={text}
        hint="Separate tags with commas, at most 20."
        error={
          submit.errors['tags'] ??
          Object.entries(submit.errors).find(([key]) =>
            key.startsWith('tags.'),
          )?.[1]
        }
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div>
        <SubmitButton pending={submit.pending} pendingLabel="Saving…">
          Save tags
        </SubmitButton>
      </div>
    </form>
  );
}

/** Adds a note. */
export function NoteFormView({ workspaceId, lead }: LeadFormProps) {
  const addNote = useApiMutation(API.leads.note);
  const [body, setBody] = useState('');
  const submit = useFormSubmit({
    schema: leadNoteRequestSchema,
    submit: (input) =>
      addNote.mutate({
        params: { workspaceId, contactId: lead.id },
        body: input,
      }),
    onSuccess: () => {
      setBody('');
    },
  });
  return (
    <form
      noValidate
      aria-label="Add a note"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.handleSubmit({ body });
      }}
    >
      <FormError message={submit.formError} />
      <TextareaField
        label="Note"
        name="body"
        value={body}
        error={submit.errors['body']}
        onChange={(event) => {
          setBody(event.target.value);
        }}
      />
      <div>
        <SubmitButton pending={submit.pending} pendingLabel="Adding…">
          Add note
        </SubmitButton>
      </div>
    </form>
  );
}

/** Adds the lead to a campaign's lead list. */
export function AssignFormView({ workspaceId, lead }: LeadFormProps) {
  const assign = useApiMutation(API.leads.assign);
  const campaigns = useApiQuery(API.campaigns.list, {
    params: { workspaceId },
    query: { limit: 100 },
  });
  const joined = new Set(lead.campaigns.map((campaign) => campaign.id));
  const open = (campaigns.data?.items ?? []).filter(
    (campaign) =>
      !joined.has(campaign.id) &&
      campaign.status !== 'COMPLETED' &&
      campaign.status !== 'CANCELLED',
  );
  const [campaignId, setCampaignId] = useState('');
  const [issues, setIssues] = useState<readonly string[]>([]);
  const submit = useFormSubmit({
    schema: leadAssignmentRequestSchema,
    submit: async (body) => {
      const result = await assign.mutate({
        params: { workspaceId, contactId: lead.id },
        body,
      });
      // The lead's own blocks, one per line (the campaign's show on its field).
      setIssues(
        result.ok || result.signedOut
          ? []
          : result.error.issues
              .filter((issue) => issue.path !== 'campaignId')
              .map((issue) => issue.message),
      );
      return result;
    },
    onSuccess: () => {
      setCampaignId('');
    },
  });
  if (open.length === 0 && campaigns.status === 'success') {
    return (
      <p className="text-sm text-muted-foreground">
        No other campaign can take this lead.
      </p>
    );
  }
  return (
    <form
      noValidate
      aria-label="Add to a campaign"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setIssues([]);
        void submit.handleSubmit({ version: lead.version, campaignId });
      }}
    >
      <FormError message={submit.formError} />
      {issues.length === 0 ? null : (
        <ul
          role="alert"
          className="grid list-disc gap-0.5 pl-5 text-sm text-destructive"
        >
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <SelectField
        label="Campaign"
        name="campaignId"
        value={campaignId}
        error={submit.errors['campaignId']}
        onChange={(event) => {
          setCampaignId(event.target.value);
        }}
      >
        <option value="">Choose a campaign</option>
        {open.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </SelectField>
      <div>
        <SubmitButton pending={submit.pending} pendingLabel="Adding…">
          Add to campaign
        </SubmitButton>
      </div>
    </form>
  );
}

/** A person's decision in one campaign: approve (Qualified) or reject, with a note (task 10C). */
export function DecisionFormView({
  workspaceId,
  lead,
  campaign,
}: LeadFormProps & { readonly campaign: LeadDetail['campaigns'][number] }) {
  const decide = useApiMutation(API.qualification.decide);
  const [state, setState] = useState<'QUALIFIED' | 'REJECTED'>('QUALIFIED');
  const [note, setNote] = useState('');
  const submit = useFormSubmit({
    schema: qualificationDecisionRequestSchema,
    submit: (body) =>
      decide.mutate({
        params: { workspaceId, campaignId: campaign.id, contactId: lead.id },
        body,
      }),
    onSuccess: () => {
      setNote('');
    },
  });
  return (
    <form
      noValidate
      aria-label={`Decide in ${campaign.name}`}
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.handleSubmit({
          version: campaign.qualification?.version ?? 0,
          state,
          note,
        });
      }}
    >
      <FormError message={submit.formError} />
      <SelectField
        label="Decision"
        name="state"
        value={state}
        onChange={(event) => {
          setState(
            event.target.value === 'REJECTED' ? 'REJECTED' : 'QUALIFIED',
          );
        }}
      >
        <option value="QUALIFIED">Approve (Qualified)</option>
        <option value="REJECTED">Reject</option>
      </SelectField>
      <TextareaField
        label="Why?"
        name="note"
        value={note}
        error={submit.errors['note']}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <div>
        <SubmitButton pending={submit.pending} pendingLabel="Saving…">
          Save decision
        </SubmitButton>
      </div>
    </form>
  );
}

'use client';

// The do-not-contact list (task 11C, docs/decisions.md D-11C-03 and D-11C-04): the workspace's
// addresses and domains that must never be contacted, newest first, searchable. Members with
// suppressions.manage add an address or a domain (the leads it covers are reopened), remove an
// entry a member added by hand, and erase a person by their address on their request (with
// contacts.write too), which keeps only the address here. The API decides everything; this page
// validates with the shared request schemas first.
import {
  API,
  MEMBER_SUPPRESSION_REASONS,
  SUPPRESSION_KINDS,
  SUPPRESSION_REASON_LABELS,
  addSuppressionRequestSchema,
  deletionRequestSchema,
  type DeletionResult,
  type Suppression,
  type SuppressionKind,
} from '@lead-fennec-ai/shared';
import { Ban } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import {
  FilterSelect,
  ListFilters,
  SearchField,
} from '@/components/data/list-filters';
import { CursorPagination } from '@/components/data/pagination';
import { Status } from '@/components/data/status-label';
import { ConfirmButton } from '@/components/feedback/confirm';
import { EmptyState } from '@/components/feedback/empty-state';
import {
  FormError,
  FormField,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/typography';
import { errorMessage } from '@/lib/api';
import { formatCount, formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useFormSubmit } from '@/lib/use-form-submit';
import { useCursorTrail, useListParams } from '@/lib/use-list-params';
import { useWorkspace } from '@/lib/workspace';

const PAGE_SIZE = 50;

const viewSchema = z.object({
  q: z.string().trim().max(100).catch(''),
  kind: z.enum(SUPPRESSION_KINDS).or(z.literal('')).catch(''),
});

const KIND_LABELS: Readonly<Record<SuppressionKind, string>> = {
  email: 'Address',
  domain: 'Domain',
};

type MemberReason = (typeof MEMBER_SUPPRESSION_REASONS)[number];

function AddForm({ workspaceId }: { readonly workspaceId: string }) {
  const add = useApiMutation(API.suppressions.add);
  const [kind, setKind] = useState<SuppressionKind>('email');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState<MemberReason>('MANUAL');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const submit = useFormSubmit({
    schema: addSuppressionRequestSchema,
    submit: (body) => add.mutate({ params: { workspaceId }, body }),
    onSuccess: (result) => {
      setValue('');
      setNote('');
      setDone(
        result.created
          ? result.reopenedLeads === 0
            ? 'Added. No lead in the workspace has it.'
            : `Added. ${formatCount(result.reopenedLeads)} lead${result.reopenedLeads === 1 ? '' : 's'} can no longer be emailed; their drafts were withdrawn.`
          : 'It was already on the list.',
      );
    },
  });
  return (
    <form
      noValidate
      aria-label="Add to the list"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setDone(null);
        void submit.handleSubmit({
          kind,
          value,
          reason,
          ...(note.trim() === '' ? {} : { note }),
        });
      }}
    >
      <FormError message={submit.formError} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="What"
          name="kind"
          value={kind}
          error={submit.errors['kind']}
          onChange={(event) => {
            setKind(event.target.value as SuppressionKind);
          }}
        >
          <option value="email">An email address</option>
          <option value="domain">A whole domain (and its subdomains)</option>
        </SelectField>
        <FormField
          label={kind === 'email' ? 'Email address' : 'Domain'}
          name="value"
          value={value}
          autoComplete="off"
          error={submit.errors['value']}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <SelectField
          label="Why"
          name="reason"
          value={reason}
          error={submit.errors['reason']}
          onChange={(event) => {
            setReason(event.target.value as MemberReason);
          }}
        >
          {MEMBER_SUPPRESSION_REASONS.map((option) => (
            <option key={option} value={option}>
              {SUPPRESSION_REASON_LABELS[option]}
            </option>
          ))}
        </SelectField>
      </div>
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
          Add to the list
        </SubmitButton>
        {done === null ? null : (
          <p role="status" className="text-sm">
            {done}
          </p>
        )}
      </div>
    </form>
  );
}

/** Erasing a person by their address: a confirmation, then the API's counts. */
function DeletionForm({ workspaceId }: { readonly workspaceId: string }) {
  const erase = useApiMutation(API.suppressions.deletionRequest);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DeletionResult | null>(null);
  const checked = deletionRequestSchema.safeParse({ email });
  return (
    <div className="grid gap-3">
      <FormField
        label="The person's email address"
        name="email"
        value={email}
        autoComplete="off"
        hint="Their lead and everything about them, and the import records that name the address, are deleted. The address stays on this list, without a note."
        error={error ?? undefined}
        onChange={(event) => {
          setEmail(event.target.value);
          setError(null);
          setDone(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <ConfirmButton
          variant="destructive"
          disabled={!checked.success}
          confirm={{
            title: 'Erase this person?',
            description:
              'Everything the workspace has about them is deleted for good. It cannot be undone.',
            confirmLabel: 'Erase the person',
            cancelLabel: 'Keep everything',
            pendingLabel: 'Erasing…',
            destructive: true,
            onConfirm: async () => {
              const result = await erase.mutate({
                params: { workspaceId },
                body: { email },
              });
              if (result.ok) {
                setEmail('');
                setDone(result.data);
                return null;
              }
              return result.signedOut ? null : errorMessage(result.error);
            },
          }}
        >
          Erase the person’s data
        </ConfirmButton>
        {done === null ? null : (
          <p role="status" className="text-sm">
            {`Erased: ${done.deleted.contacts === 1 ? 'their lead' : 'no lead'} and ${formatCount(done.deleted.sourceRecords)} other import record${done.deleted.sourceRecords === 1 ? '' : 's'}. Their address stays on the list.`}
          </p>
        )}
      </div>
    </div>
  );
}

export function SuppressionList() {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const view = useListParams(viewSchema);
  const pages = useCursorTrail(`${workspaceId}:${view.viewKey}`);
  const { q, kind } = view.values;
  const list = useApiQuery(API.suppressions.list, {
    params: { workspaceId },
    query: {
      limit: PAGE_SIZE,
      ...(q === '' ? {} : { q }),
      ...(kind === '' ? {} : { kind }),
      ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
    },
  });
  const remove = useApiMutation(API.suppressions.remove);
  const nextCursor = list.data?.nextCursor ?? null;

  const columns: DataColumn<Suppression>[] = [
    {
      key: 'value',
      header: 'Address or domain',
      rowHeader: true,
      cell: (entry) => entry.value,
    },
    { key: 'kind', header: 'Kind', cell: (entry) => KIND_LABELS[entry.kind] },
    {
      key: 'reason',
      header: 'Why',
      cell: (entry) => (
        <span className="grid gap-0.5">
          <Status kind="suppressionReason" value={entry.reason} />
          {entry.note === null ? null : (
            <span className="text-xs text-muted-foreground">{entry.note}</span>
          )}
        </span>
      ),
    },
    {
      key: 'added',
      header: 'Added',
      cell: (entry) => formatDateTime(entry.createdAt),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (entry) =>
        entry.removable ? (
          <ConfirmButton
            variant="outline"
            size="sm"
            confirm={{
              title: `Remove ${entry.value} from the list?`,
              description:
                'It can be contacted again. Leads it covered stay in Review until someone decides again.',
              confirmLabel: 'Remove',
              cancelLabel: 'Keep it',
              pendingLabel: 'Removing…',
              destructive: true,
              onConfirm: async () => {
                const result = await remove.mutate({
                  params: { workspaceId, suppressionId: entry.id },
                });
                if (result.ok) {
                  return null;
                }
                return result.signedOut ? null : errorMessage(result.error);
              },
            }}
          >
            Remove
          </ConfirmButton>
        ) : (
          <span className="text-xs text-muted-foreground">Stays</span>
        ),
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Do-not-contact list"
        description="Addresses and domains that must never be contacted. Imports exclude them, and sending checks them again before every email."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="add-title">
          <CardHeader>
            <CardTitle id="add-title">Add an address or a domain</CardTitle>
          </CardHeader>
          <CardContent>
            <AddForm workspaceId={workspaceId} />
          </CardContent>
        </Card>
        {can('contacts.write') ? (
          <Card aria-labelledby="erase-title">
            <CardHeader>
              <CardTitle id="erase-title">Erase a person on request</CardTitle>
            </CardHeader>
            <CardContent>
              <DeletionForm workspaceId={workspaceId} />
            </CardContent>
          </Card>
        ) : null}
      </div>
      <ListFilters
        label="Find on the list"
        filtered={view.filtered}
        onClear={view.clear}
      >
        <SearchField
          label="Search"
          placeholder="Part of an address or domain"
          value={q}
          onSearch={(text) => {
            view.update({ q: text });
          }}
        />
        <FilterSelect
          label="Kind"
          value={kind}
          allLabel="Addresses and domains"
          options={SUPPRESSION_KINDS.map((value) => ({
            value,
            label: KIND_LABELS[value],
          }))}
          onChange={(value) => {
            view.update({
              kind: value as z.output<typeof viewSchema>['kind'],
            });
          }}
        />
      </ListFilters>
      <DataTable
        label="Do-not-contact list"
        columns={columns}
        rows={list.data?.items}
        rowKey={(entry) => entry.id}
        status={list.status}
        error={list.error}
        onRetry={list.retry}
        refreshing={list.refreshing}
        empty={
          view.filtered ? (
            <p className="text-sm text-muted-foreground">
              Nothing on the list matches.
            </p>
          ) : (
            <EmptyState
              icon={Ban}
              title="The list is empty"
              description="Add an address or a domain that must never be contacted."
            />
          )
        }
        footer={
          <CursorPagination
            label="Do-not-contact list"
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
    </div>
  );
}

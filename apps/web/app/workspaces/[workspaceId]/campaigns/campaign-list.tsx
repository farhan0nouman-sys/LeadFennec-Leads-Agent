'use client';

// The Campaigns page (task 06B): the workspace's campaigns with how far each one's setup is,
// a dialog to create one (it opens in the setup wizard), and copying. The page checks access on
// the server first; the list reads through the workspace-scoped cache.
import {
  API,
  CAMPAIGN_READINESS_SECTIONS,
  createCampaignRequestSchema,
  type CampaignListItem,
} from '@lead-fennec-ai/shared';
import { Megaphone, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { campaignHref } from '@/components/campaigns/campaign-wizard';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { CursorPagination } from '@/components/data/pagination';
import { Status } from '@/components/data/status-label';
import { EmptyState } from '@/components/feedback/empty-state';
import {
  FormError,
  FormField,
  SubmitButton,
  TextareaField,
} from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/typography';
import { errorMessage } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useCursorTrail } from '@/lib/use-list-params';
import { useFormSubmit } from '@/lib/use-form-submit';
import { useWorkspace } from '@/lib/workspace';

const PAGE_SIZE = 25;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

type Notice = { readonly ok: boolean; readonly text: string } | null;

/** "Ready to start", or how many of the needed parts are filled in. */
function setupText(item: CampaignListItem): string {
  const total = CAMPAIGN_READINESS_SECTIONS.length;
  return item.readiness.complete
    ? 'Ready to start'
    : `${String(total - item.readiness.missing.length)} of ${String(total)} parts filled in`;
}

function NewCampaignDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const router = useRouter();
  const create = useApiMutation(API.campaigns.create);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const form = useFormSubmit({
    schema: createCampaignRequestSchema,
    submit: (body) => create.mutate({ params: { workspaceId }, body }),
    onSuccess: (campaign) => {
      router.push(campaignHref(workspaceId, campaign.id));
    },
    fieldErrors: {
      campaign_name_taken: {
        field: 'name',
        message: 'Another campaign in this workspace has this name.',
      },
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!form.pending}
      title="New campaign"
      description="Give it a name. You set up the rest step by step, and can save an unfinished campaign at any point."
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit({
            name,
            ...(description.trim() === '' ? {} : { description }),
          });
        }}
      >
        <FormError message={form.formError} />
        <FormField
          label="Campaign name"
          name="name"
          autoFocus
          hint="Up to 120 characters."
          value={name}
          error={form.errors['name']}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextareaField
          label="Description (optional)"
          name="description"
          rows={2}
          value={description}
          error={form.errors['description']}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={form.pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <SubmitButton pending={form.pending} pendingLabel="Creating…">
            Create and set up
          </SubmitButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function CampaignList() {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const canWrite = can('campaigns.write');
  const pages = useCursorTrail(workspaceId);
  const campaigns = useApiQuery(API.campaigns.list, {
    params: { workspaceId },
    query: {
      limit: PAGE_SIZE,
      ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
    },
  });
  const duplicate = useApiMutation(API.campaigns.duplicate);
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const copy = async (item: CampaignListItem) => {
    setCopying(item.id);
    setNotice(null);
    const result = await duplicate.mutate({
      params: { workspaceId, campaignId: item.id },
      body: {},
    });
    setCopying(null);
    if (result.ok) {
      setNotice({
        ok: true,
        text: `Copied “${item.name}” as “${result.data.name}”, a new draft.`,
      });
    } else if (!result.signedOut) {
      setNotice({ ok: false, text: errorMessage(result.error) });
    }
  };

  const newButton = canWrite ? (
    <Button
      onClick={() => {
        setCreating(true);
      }}
    >
      <Plus aria-hidden="true" />
      New campaign
    </Button>
  ) : null;

  const columns: DataColumn<CampaignListItem>[] = [
    {
      key: 'name',
      header: 'Campaign',
      rowHeader: true,
      cell: (item) => (
        <Link
          href={campaignHref(workspaceId, item.id)}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {item.name}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (item) => <Status kind="campaign" value={item.status} />,
    },
    { key: 'setup', header: 'Setup', cell: setupText },
    {
      key: 'approval',
      header: 'Approval',
      cell: (item) =>
        item.approvalMode === 'HUMAN'
          ? 'A person approves each email'
          : 'Automatic',
    },
    {
      key: 'updated',
      header: 'Last changed',
      cell: (item) => dateFormat.format(new Date(item.updatedAt)),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: 'Actions',
            hideHeader: true,
            cell: (item: CampaignListItem) => (
              <Button
                variant="outline"
                size="sm"
                disabled={copying === item.id}
                aria-label={`Make a copy of ${item.name}`}
                onClick={() => {
                  void copy(item);
                }}
              >
                {copying === item.id ? 'Copying…' : 'Make a copy'}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const nextCursor = campaigns.data?.nextCursor ?? null;
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Campaigns"
        description={
          canWrite
            ? 'Set up email campaigns step by step. Unfinished ones are saved as drafts.'
            : 'You can see the campaigns. Your role cannot create or change them.'
        }
        {...(newButton === null ? {} : { actions: newButton })}
      />
      {notice === null ? null : (
        <Alert variant={notice.ok ? 'success' : 'destructive'}>
          <AlertDescription
            className={notice.ok ? undefined : 'text-destructive'}
          >
            {notice.text}
          </AlertDescription>
        </Alert>
      )}
      <DataTable
        label="Campaigns"
        columns={columns}
        rows={campaigns.data?.items}
        rowKey={(item) => item.id}
        rowAttributes={(item) => ({ 'data-testid': `campaign-${item.name}` })}
        status={campaigns.status}
        error={campaigns.error}
        onRetry={campaigns.retry}
        refreshing={campaigns.refreshing}
        empty={
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="Create a campaign and set it up step by step. You can save an unfinished campaign and come back to it."
            {...(newButton === null ? {} : { action: newButton })}
          />
        }
        footer={
          <CursorPagination
            label="Campaigns"
            page={pages.page}
            hasPrevious={pages.hasPrevious}
            hasNext={nextCursor !== null}
            onPrevious={pages.previous}
            onNext={() => {
              if (nextCursor !== null) {
                pages.next(nextCursor);
              }
            }}
            disabled={campaigns.status === 'loading'}
          />
        }
      />
      <NewCampaignDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
    </div>
  );
}

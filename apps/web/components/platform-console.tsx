'use client';

import {
  ACCESS_REASON_HEADER,
  API,
  accessReasonSchema,
  type workspaceSchema,
} from '@lead-fennec-ai/shared';
import { Building2 } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import type { z } from 'zod';
import { CursorPagination } from '@/components/data/pagination';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { Status } from '@/components/data/status-label';
import { ConfirmButton } from '@/components/feedback/confirm';
import { EmptyState } from '@/components/feedback/empty-state';
import { FormField } from '@/components/form-field';
import { AccessDenied } from '@/components/section-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/typography';
import { ApiError, callApi, errorMessage } from '@/lib/api';
import { useApiMutation } from '@/lib/query';
import { useSession } from '@/lib/session';

type Workspace = z.output<typeof workspaceSchema>;

/** Header values must be plain ASCII; the reason is sent in one on GET. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const PAGE_SIZE = 50;

interface ConsolePage {
  /** The reason the console was opened with; every page request states it again. */
  readonly reason: string;
  /** Cursors of the pages before this one. */
  readonly trail: readonly string[];
  readonly items: readonly Workspace[];
  readonly nextCursor: string | null;
}

/**
 * Platform-admin console (task 04B routes; at /admin since 05A, after the server checked the
 * user is a platform admin). Every action states a reason, which the API stores in the audit
 * records; if the API refuses (e.g. the role was removed meanwhile), "platform admins only".
 * Nothing here is cached (05B): each page is an audited access.
 */
export function PlatformConsole() {
  const { handleAuthError } = useSession();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [view, setView] = useState<ConsolePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [memberCounts, setMemberCounts] = useState<
    Readonly<Record<string, number>>
  >({});
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const openAccess = useApiMutation(API.platform.openAccess);
  const setWorkspaceStatus = useApiMutation(API.platform.setWorkspaceStatus);

  function checkedReason(): string | null {
    const result = accessReasonSchema.safeParse(reason);
    if (!result.success) {
      setReasonError(result.error.issues[0]?.message ?? 'State the reason.');
      return null;
    }
    if (!PRINTABLE_ASCII.test(result.data)) {
      setReasonError('Use letters, digits and punctuation without accents.');
      return null;
    }
    setReasonError(undefined);
    return result.data;
  }

  /** Handles a refusal; returns the message to show for anything else. */
  function refusal(error: ApiError): string | null {
    if (handleAuthError(error)) {
      return null;
    }
    if (error.code === 'forbidden') {
      setDenied(true);
      return null;
    }
    return errorMessage(error);
  }

  async function load(why: string, trail: readonly string[]) {
    setLoading(true);
    setLoadError(null);
    const cursor = trail.at(-1);
    try {
      const page = await callApi(API.platform.listWorkspaces, {
        headers: { [ACCESS_REASON_HEADER]: why },
        query: {
          limit: PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        },
      });
      setView({
        reason: why,
        trail,
        items: page.items,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(0, 'unexpected_response', errorMessage(error));
      if (refusal(apiError) !== null) {
        setLoadError(apiError);
      }
    } finally {
      setLoading(false);
    }
  }

  function open(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const why = checkedReason();
    if (why !== null) {
      setNotice(null);
      void load(why, []);
    }
  }

  async function inspect(workspace: Workspace) {
    const why = checkedReason();
    if (why === null) {
      return;
    }
    setBusy(workspace.id);
    const result = await openAccess.mutate({
      params: { workspaceId: workspace.id },
      body: { reason: why },
    });
    setBusy(null);
    if (result.ok) {
      setMemberCounts({
        ...memberCounts,
        [workspace.id]: result.data.memberCount,
      });
    } else {
      const message = refusal(result.error);
      if (message !== null) {
        setNotice({ ok: false, text: message });
      }
    }
  }

  /** Changes the status; null when it worked, else the message to show. */
  async function changeStatus(
    workspace: Workspace,
    status: 'ACTIVE' | 'SUSPENDED',
  ): Promise<string | null> {
    const why = checkedReason();
    if (why === null) {
      return 'State the reason for this change in the form above first.';
    }
    setBusy(workspace.id);
    setNotice(null);
    const result = await setWorkspaceStatus.mutate({
      params: { workspaceId: workspace.id },
      body: { status, reason: why },
    });
    setBusy(null);
    if (!result.ok) {
      return refusal(result.error);
    }
    const updated = result.data;
    setView((page) =>
      page === null
        ? page
        : {
            ...page,
            items: page.items.map((w) => (w.id === updated.id ? updated : w)),
          },
    );
    setNotice({
      ok: true,
      text: `${updated.name} is now ${updated.status === 'ACTIVE' ? 'active' : 'suspended'}.`,
    });
    return null;
  }

  if (denied) {
    return (
      <AccessDenied
        title="Platform admins only"
        backHref="/workspaces"
        backLabel="Go to your workspaces"
      >
        <p>This area is for Lead Fennec platform administrators.</p>
      </AccessDenied>
    );
  }

  const columns: DataColumn<Workspace>[] = [
    {
      key: 'workspace',
      header: 'Workspace',
      rowHeader: true,
      cell: (workspace) => (
        <>
          <span className="block font-medium">{workspace.name}</span>
          <span className="text-xs text-muted-foreground">
            {workspace.slug}
          </span>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (workspace) => <Status kind="workspace" value={workspace.status} />,
    },
    {
      key: 'members',
      header: 'Members',
      cell: (workspace) =>
        memberCounts[workspace.id] ?? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            disabled={busy === workspace.id}
            onClick={() => void inspect(workspace)}
          >
            Count members
          </Button>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      hideHeader: true,
      className: 'text-right',
      cell: (workspace) =>
        workspace.status === 'ACTIVE' ? (
          <ConfirmButton
            variant="destructive"
            size="sm"
            disabled={busy === workspace.id}
            confirm={{
              title: `Suspend ${workspace.name}?`,
              description:
                'Its members lose access until it is reactivated. The change and your reason are recorded.',
              confirmLabel: 'Suspend workspace',
              pendingLabel: 'Suspending…',
              destructive: true,
              onConfirm: () => changeStatus(workspace, 'SUSPENDED'),
            }}
          >
            Suspend
          </ConfirmButton>
        ) : workspace.status === 'SUSPENDED' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy === workspace.id}
            onClick={() => {
              void changeStatus(workspace, 'ACTIVE').then((message) => {
                if (message !== null) {
                  setNotice({ ok: false, text: message });
                }
              });
            }}
          >
            Reactivate
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Workspaces"
        description="Every workspace on the platform. Each action is recorded with your reason."
      />
      <form className="grid max-w-lg gap-4" noValidate onSubmit={open}>
        <FormField
          label="Reason for this access"
          name="reason"
          hint="For example a support ticket number and what you need to check."
          value={reason}
          error={reasonError}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        <Button type="submit" className="w-fit" disabled={loading}>
          Open console
        </Button>
      </form>
      {notice === null ? null : (
        <Alert variant={notice.ok ? 'success' : 'destructive'}>
          <AlertDescription
            className={notice.ok ? undefined : 'text-destructive'}
          >
            {notice.text}
          </AlertDescription>
        </Alert>
      )}
      {view === null && !loading && loadError === null ? null : (
        <DataTable
          label="All workspaces"
          columns={columns}
          rows={view?.items}
          rowKey={(workspace) => workspace.id}
          rowAttributes={(workspace) => ({
            'data-testid': `platform-workspace-${workspace.slug}`,
          })}
          status={
            loadError !== null ? 'error' : view === null ? 'loading' : 'success'
          }
          error={loadError}
          onRetry={() => {
            if (view !== null) {
              void load(view.reason, view.trail);
            } else {
              const why = checkedReason();
              if (why !== null) {
                void load(why, []);
              }
            }
          }}
          refreshing={loading && view !== null}
          empty={<EmptyState icon={Building2} title="No workspaces yet" />}
          footer={
            view === null ? undefined : (
              <CursorPagination
                label="Workspaces"
                page={view.trail.length + 1}
                hasPrevious={view.trail.length > 0}
                hasNext={view.nextCursor !== null}
                disabled={loading}
                onPrevious={() => {
                  void load(view.reason, view.trail.slice(0, -1));
                }}
                onNext={() => {
                  if (view.nextCursor !== null) {
                    void load(view.reason, [...view.trail, view.nextCursor]);
                  }
                }}
              />
            )
          }
        />
      )}
    </div>
  );
}

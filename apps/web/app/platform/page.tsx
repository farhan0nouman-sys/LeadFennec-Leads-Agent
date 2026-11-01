'use client';

import {
  ACCESS_REASON_HEADER,
  WORKSPACE_ROUTES,
  accessReasonSchema,
  platformWorkspaceDetailSchema,
  platformWorkspacePageSchema,
  workspaceSchema,
} from '@lead-fennec-ai/shared';
import { useState, type SubmitEvent } from 'react';
import type { z } from 'zod';
import { AppHeader } from '@/components/app-header';
import { FormField } from '@/components/form-field';
import { Loading, NotAvailable } from '@/components/page-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { useRequiredSession, useSession } from '@/lib/session';

type Workspace = z.output<typeof workspaceSchema>;

/** Header values must be plain ASCII; the reason is sent in one on GET. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * Platform-admin console (task 04B routes). Every action states a reason, which the API stores
 * in the audit records; anyone else gets "platform admins only".
 */
export default function PlatformPage() {
  const session = useRequiredSession();
  const { handleAuthError } = useSession();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [workspaces, setWorkspaces] = useState<readonly Workspace[] | null>(
    null,
  );
  const [memberCounts, setMemberCounts] = useState<
    Readonly<Record<string, number>>
  >({});
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

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

  function fail(error: unknown) {
    if (handleAuthError(error)) {
      return;
    }
    if (error instanceof ApiError && error.code === 'forbidden') {
      setDenied(true);
      return;
    }
    setNotice({ ok: false, text: errorMessage(error) });
  }

  async function open(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const why = checkedReason();
    if (why === null) {
      return;
    }
    setNotice(null);
    setBusy('console');
    try {
      const page = await apiRequest(
        `${WORKSPACE_ROUTES.platformWorkspaces}?limit=100`,
        platformWorkspacePageSchema,
        { headers: { [ACCESS_REASON_HEADER]: why } },
      );
      setWorkspaces(page.items);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  async function inspect(workspace: Workspace) {
    const why = checkedReason();
    if (why === null || session === null) {
      return;
    }
    setBusy(workspace.id);
    try {
      const detail = await apiRequest(
        WORKSPACE_ROUTES.platformWorkspaceAccess(workspace.id),
        platformWorkspaceDetailSchema,
        { method: 'POST', body: { reason: why }, csrfToken: session.csrfToken },
      );
      setMemberCounts({ ...memberCounts, [workspace.id]: detail.memberCount });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(
    workspace: Workspace,
    status: 'ACTIVE' | 'SUSPENDED',
  ) {
    const why = checkedReason();
    if (why === null || session === null || workspaces === null) {
      return;
    }
    setBusy(workspace.id);
    setNotice(null);
    try {
      const updated = await apiRequest(
        WORKSPACE_ROUTES.platformWorkspaceStatus(workspace.id),
        workspaceSchema,
        {
          method: 'POST',
          body: { status, reason: why },
          csrfToken: session.csrfToken,
        },
      );
      setWorkspaces(workspaces.map((w) => (w.id === updated.id ? updated : w)));
      setNotice({
        ok: true,
        text: `${updated.name} is now ${updated.status === 'ACTIVE' ? 'active' : 'suspended'}.`,
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8">
        {session === null ? (
          <Loading />
        ) : denied ? (
          <NotAvailable title="Platform admins only">
            <p>This console is for Lead Fennec platform administrators.</p>
          </NotAvailable>
        ) : (
          <>
            <div className="grid gap-1">
              <h1 className="text-2xl font-semibold">Platform console</h1>
              <p className="text-sm text-muted-foreground">
                Every action is recorded with your reason.
              </p>
            </div>
            <form
              className="grid max-w-lg gap-4"
              noValidate
              onSubmit={(e) => void open(e)}
            >
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
              <Button type="submit" className="w-fit" disabled={busy !== null}>
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
            {workspaces === null ? null : (
              <Table aria-label="All workspaces">
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspaces.map((workspace) => (
                    <TableRow
                      key={workspace.id}
                      data-testid={`platform-workspace-${workspace.slug}`}
                    >
                      <TableCell>
                        <span className="block font-medium">
                          {workspace.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {workspace.slug}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            workspace.status === 'ACTIVE'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {workspace.status === 'ACTIVE'
                            ? 'Active'
                            : workspace.status === 'SUSPENDED'
                              ? 'Suspended'
                              : 'Archived'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {memberCounts[workspace.id] ?? (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0"
                            disabled={busy === workspace.id}
                            onClick={() => void inspect(workspace)}
                          >
                            Count members
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {workspace.status === 'ACTIVE' ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy === workspace.id}
                            onClick={() =>
                              void setStatus(workspace, 'SUSPENDED')
                            }
                          >
                            Suspend
                          </Button>
                        ) : workspace.status === 'SUSPENDED' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy === workspace.id}
                            onClick={() => void setStatus(workspace, 'ACTIVE')}
                          >
                            Reactivate
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </main>
    </>
  );
}

'use client';

// The team page's content (task 04C); the page checks access on the server first (05A). Since
// 05B it reads through the workspace-scoped cache (useApiQuery), pages by cursor, and each
// change makes the affected lists of this workspace stale so they load again.

import {
  API,
  createInvitationRequestSchema,
  type Invitation,
  type Member,
} from '@lead-fennec-ai/shared';
import { MailOpen } from 'lucide-react';
import { useState } from 'react';
import { CursorPagination } from '@/components/data/pagination';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import { Status } from '@/components/data/status-label';
import { ConfirmButton, ConfirmDialog } from '@/components/feedback/confirm';
import { EmptyState } from '@/components/feedback/empty-state';
import { RetryState } from '@/components/feedback/retry-state';
import {
  FormError,
  FormField,
  SelectField,
  SubmitButton,
} from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/select';
import { PageHeader, SectionHeading } from '@/components/ui/typography';
import { errorMessage, type ApiError } from '@/lib/api';
import { useApiMutation, useApiQuery, type MutationResult } from '@/lib/query';
import { useCursorTrail } from '@/lib/use-list-params';
import { useFormSubmit } from '@/lib/use-form-submit';
import { useWorkspace } from '@/lib/workspace';

interface Role {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

type Notice = { readonly ok: boolean; readonly text: string } | null;

const PAGE_SIZE = 50;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));
const nameOf = (member: Member) => member.user.displayName ?? member.user.email;

const LAST_ADMIN =
  'A workspace needs at least one admin. Make someone else an admin first.';

export function TeamPanel() {
  const { current, can, reload } = useWorkspace();
  const workspaceId = current.workspace.id;
  const canManage = can('members.manage');
  const [notice, setNotice] = useState<Notice>(null);
  const roles = useApiQuery(API.roles.list, { params: { workspaceId } });

  /** Shows a failure; a refusal can mean the user's own role changed meanwhile. */
  const failed = (error: ApiError) => {
    setNotice({ ok: false, text: errorMessage(error) });
    if (error.status === 403) {
      reload();
    }
  };

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Team"
        description={
          canManage
            ? 'Invite people, change roles and revoke invitations.'
            : 'You can see the team. Only admins can invite people or change roles.'
        }
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
      {roles.status === 'error' ? (
        <RetryState
          title="We couldn't load the roles"
          error={roles.error}
          onRetry={roles.retry}
        />
      ) : null}
      <MembersSection
        roles={canManage ? roles.data?.items : undefined}
        onNotice={setNotice}
        onFailure={failed}
      />
      <InvitationsSection onNotice={setNotice} onFailure={failed} />
      {canManage && roles.data !== undefined ? (
        <InviteForm
          roles={roles.data.items}
          onInvited={(invitation) => {
            setNotice({
              ok: true,
              text: `Invitation sent to ${invitation.email}.`,
            });
          }}
          onFailure={failed}
        />
      ) : null}
    </div>
  );
}

function MembersSection({
  roles,
  onNotice,
  onFailure,
}: {
  /** Present when the user may change roles. */
  readonly roles: readonly Role[] | undefined;
  readonly onNotice: (notice: Notice) => void;
  readonly onFailure: (error: ApiError) => void;
}) {
  const { user, current, reload } = useWorkspace();
  const workspaceId = current.workspace.id;
  const pages = useCursorTrail(workspaceId);
  const members = useApiQuery(API.members.list, {
    params: { workspaceId },
    query: {
      limit: PAGE_SIZE,
      ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
    },
  });
  const changeRole = useApiMutation(API.members.changeRole);
  const [busy, setBusy] = useState<string | null>(null);
  const [ownChange, setOwnChange] = useState<{
    readonly member: Member;
    readonly role: Role;
  } | null>(null);

  async function applyRole(member: Member, role: Role): Promise<void> {
    setBusy(member.id);
    onNotice(null);
    const result = await changeRole.mutate({
      params: { workspaceId, membershipId: member.id },
      body: { roleId: role.id },
    });
    setBusy(null);
    if (result.ok) {
      onNotice({
        ok: true,
        text: `${nameOf(result.data)} is now ${result.data.role.name}.`,
      });
      if (result.data.user.id === user.id) {
        reload();
      }
    } else if (result.error.code === 'last_admin') {
      onNotice({ ok: false, text: LAST_ADMIN });
    } else if (!result.signedOut) {
      onFailure(result.error);
    }
  }

  const choose = (member: Member, roleId: string) => {
    const role = roles?.find((r) => r.id === roleId);
    if (role === undefined || role.id === member.role.id) {
      return;
    }
    if (member.user.id === user.id) {
      // Changing one's own role can take away the right to change it back: ask first.
      setOwnChange({ member, role });
    } else {
      void applyRole(member, role);
    }
  };

  const columns: DataColumn<Member>[] = [
    {
      key: 'name',
      header: 'Name',
      rowHeader: true,
      cell: (member) => (
        <>
          {member.user.displayName ?? '—'}
          {member.user.id === user.id ? (
            <span className="text-muted-foreground"> (you)</span>
          ) : null}
        </>
      ),
    },
    { key: 'email', header: 'Email', cell: (member) => member.user.email },
    {
      key: 'role',
      header: 'Role',
      cell: (member) =>
        roles !== undefined && member.status === 'ACTIVE' ? (
          <NativeSelect
            aria-label={`Role of ${member.user.email}`}
            className="w-48"
            value={member.role.id}
            disabled={busy === member.id}
            onChange={(event) => {
              choose(member, event.target.value);
            }}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        ) : (
          member.role.name
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (member) => <Status kind="member" value={member.status} />,
    },
    {
      key: 'joined',
      header: 'Joined',
      cell: (member) => formatDate(member.createdAt),
    },
  ];

  const nextCursor = members.data?.nextCursor ?? null;
  return (
    <section className="grid gap-3" aria-labelledby="members-heading">
      <SectionHeading id="members-heading">Members</SectionHeading>
      <DataTable
        label="Members"
        columns={columns}
        rows={members.data?.items}
        rowKey={(member) => member.id}
        rowAttributes={(member) => ({
          'data-testid': `member-${member.user.email}`,
        })}
        status={members.status}
        error={members.error}
        onRetry={members.retry}
        refreshing={members.refreshing}
        empty={<EmptyState title="No members on this page" />}
        footer={
          <CursorPagination
            label="Members"
            page={pages.page}
            hasPrevious={pages.hasPrevious}
            hasNext={nextCursor !== null}
            onPrevious={pages.previous}
            onNext={() => {
              if (nextCursor !== null) {
                pages.next(nextCursor);
              }
            }}
            disabled={members.status === 'loading'}
          />
        }
      />
      <ConfirmDialog
        open={ownChange !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOwnChange(null);
          }
        }}
        title="Change your own role?"
        description={
          ownChange === null
            ? ''
            : `You will have the permissions of ${ownChange.role.name} in this workspace. If you lose the right to manage the team, another admin has to change it back.`
        }
        confirmLabel="Change my role"
        pendingLabel="Changing…"
        onConfirm={async () => {
          if (ownChange !== null) {
            await applyRole(ownChange.member, ownChange.role);
          }
          return null;
        }}
      />
    </section>
  );
}

function InvitationsSection({
  onNotice,
  onFailure,
}: {
  readonly onNotice: (notice: Notice) => void;
  readonly onFailure: (error: ApiError) => void;
}) {
  const { current, can } = useWorkspace();
  const workspaceId = current.workspace.id;
  const canManage = can('members.manage');
  const pages = useCursorTrail(workspaceId);
  const invitations = useApiQuery(API.invitations.list, {
    params: { workspaceId },
    query: {
      limit: PAGE_SIZE,
      ...(pages.cursor === undefined ? {} : { cursor: pages.cursor }),
    },
  });
  const revoke = useApiMutation(API.invitations.revoke);

  const revokeInvitation = async (invitation: Invitation) => {
    onNotice(null);
    const result = await revoke.mutate({
      params: { workspaceId, invitationId: invitation.id },
    });
    if (result.ok) {
      onNotice({
        ok: true,
        text: `The invitation for ${invitation.email} was revoked.`,
      });
      return null;
    }
    if (!result.signedOut && result.error.status === 403) {
      onFailure(result.error);
      return null;
    }
    return result.signedOut ? null : errorMessage(result.error);
  };

  const columns: DataColumn<Invitation>[] = [
    {
      key: 'email',
      header: 'Email',
      rowHeader: true,
      cell: (invitation) => invitation.email,
    },
    { key: 'role', header: 'Role', cell: (invitation) => invitation.role.name },
    {
      key: 'invitedBy',
      header: 'Invited by',
      cell: (invitation) => invitation.invitedBy.displayName ?? '—',
    },
    {
      key: 'expires',
      header: 'Expires',
      cell: (invitation) => formatDate(invitation.expiresAt),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            hideHeader: true,
            className: 'text-right',
            cell: (invitation: Invitation) => (
              <ConfirmButton
                variant="outline"
                size="sm"
                aria-label={`Revoke the invitation for ${invitation.email}`}
                confirm={{
                  title: 'Revoke this invitation?',
                  description: `The link sent to ${invitation.email} stops working. You can invite them again later.`,
                  confirmLabel: 'Revoke invitation',
                  pendingLabel: 'Revoking…',
                  destructive: true,
                  onConfirm: () => revokeInvitation(invitation),
                }}
              >
                Revoke
              </ConfirmButton>
            ),
          },
        ]
      : []),
  ];

  const nextCursor = invitations.data?.nextCursor ?? null;
  return (
    <section className="grid gap-3" aria-labelledby="invitations-heading">
      <SectionHeading id="invitations-heading">Open invitations</SectionHeading>
      <DataTable
        label="Open invitations"
        columns={columns}
        rows={invitations.data?.items}
        rowKey={(invitation) => invitation.id}
        rowAttributes={(invitation) => ({
          'data-testid': `invitation-${invitation.email}`,
        })}
        status={invitations.status}
        error={invitations.error}
        onRetry={invitations.retry}
        refreshing={invitations.refreshing}
        empty={
          <EmptyState
            icon={MailOpen}
            title="No open invitations"
            description={
              canManage
                ? 'Invite someone with the form below.'
                : 'Admins can invite people to this workspace.'
            }
          />
        }
        footer={
          <CursorPagination
            label="Open invitations"
            page={pages.page}
            hasPrevious={pages.hasPrevious}
            hasNext={nextCursor !== null}
            onPrevious={pages.previous}
            onNext={() => {
              if (nextCursor !== null) {
                pages.next(nextCursor);
              }
            }}
            disabled={invitations.status === 'loading'}
          />
        }
      />
    </section>
  );
}

function InviteForm({
  roles,
  onInvited,
  onFailure,
}: {
  readonly roles: readonly Role[];
  readonly onInvited: (invitation: Invitation) => void;
  readonly onFailure: (error: ApiError) => void;
}) {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const defaultRole =
    roles.find((role) => role.key === 'client_member') ?? roles[0];
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(defaultRole?.id ?? '');
  const createInvitation = useApiMutation(API.invitations.create);
  const form = useFormSubmit({
    schema: createInvitationRequestSchema,
    submit: async (value): Promise<MutationResult<Invitation>> => {
      const result = await createInvitation.mutate({
        params: { workspaceId },
        body: value,
      });
      if (!result.ok && !result.signedOut && result.error.status === 403) {
        onFailure(result.error);
      }
      return result;
    },
    fieldErrors: {
      already_member: {
        field: 'email',
        message: 'This address already belongs to a member of the workspace.',
      },
    },
    onSuccess: (invitation) => {
      setEmail('');
      onInvited(invitation);
    },
  });

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
        <CardDescription>
          We email them a link that works for 7 days, only for that address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit({ email, roleId });
          }}
        >
          <FormError message={form.formError} />
          <FormField
            label="Email address to invite"
            type="email"
            name="email"
            autoComplete="off"
            value={email}
            error={form.errors['email']}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <SelectField
            label="Role"
            name="roleId"
            value={roleId}
            error={form.errors['roleId']}
            onChange={(event) => {
              setRoleId(event.target.value);
            }}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </SelectField>
          <SubmitButton pending={form.pending} pendingLabel="Sending…">
            Send invitation
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

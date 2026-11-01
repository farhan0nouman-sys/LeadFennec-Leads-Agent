'use client';

import {
  WORKSPACE_ROUTES,
  createInvitationRequestSchema,
  invitationPageSchema,
  invitationSchema,
  memberPageSchema,
  memberSchema,
  roleListResponseSchema,
  type Invitation,
  type Member,
} from '@lead-fennec-ai/shared';
import { useEffect, useId, useState, type SubmitEvent } from 'react';
import type { z } from 'zod';
import { FormField } from '@/components/form-field';
import { Loading, Unavailable } from '@/components/page-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiCommand, apiRequest, errorMessage } from '@/lib/api';
import { apiFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';

type Role = z.output<typeof roleListResponseSchema>['items'][number];

interface TeamData {
  readonly members: readonly Member[];
  readonly membersCursor: string | null;
  readonly invitations: readonly Invitation[];
  readonly invitationsCursor: string | null;
  readonly roles: readonly Role[];
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));
const PAGE = 50;

const pagePath = (path: string, cursor: string | null) =>
  `${path}?${new URLSearchParams({
    limit: String(PAGE),
    ...(cursor === null ? {} : { cursor }),
  }).toString()}`;

async function fetchTeam(workspaceId: string): Promise<TeamData> {
  const [members, invitations, roles] = await Promise.all([
    apiRequest(
      pagePath(WORKSPACE_ROUTES.members(workspaceId), null),
      memberPageSchema,
    ),
    apiRequest(
      pagePath(WORKSPACE_ROUTES.invitations(workspaceId), null),
      invitationPageSchema,
    ),
    apiRequest(WORKSPACE_ROUTES.roles(workspaceId), roleListResponseSchema),
  ]);
  return {
    members: members.items,
    membersCursor: members.nextCursor,
    invitations: invitations.items,
    invitationsCursor: invitations.nextCursor,
    roles: roles.items,
  };
}

export default function TeamPage() {
  const { session, current, can, reload } = useWorkspace();
  const { handleAuthError } = useSession();
  const workspaceId = current.workspace.id;
  const canManage = can('members.manage');
  const [data, setData] = useState<TeamData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  function fail(error: unknown) {
    if (handleAuthError(error)) {
      return;
    }
    setNotice({ ok: false, text: errorMessage(error) });
    // A refusal can mean the user's own role changed meanwhile.
    if (error instanceof ApiError && error.status === 403) {
      reload();
    }
  }

  useEffect(() => {
    let active = true;
    fetchTeam(workspaceId).then(
      (team) => {
        if (active) {
          setData(team);
          setLoadFailed(false);
        }
      },
      (error: unknown) => {
        if (active && !handleAuthError(error)) {
          setLoadFailed(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [workspaceId, attempt, handleAuthError]);

  async function moreMembers() {
    if (data?.membersCursor == null) {
      return;
    }
    try {
      const page = await apiRequest(
        pagePath(WORKSPACE_ROUTES.members(workspaceId), data.membersCursor),
        memberPageSchema,
      );
      setData({
        ...data,
        members: [...data.members, ...page.items],
        membersCursor: page.nextCursor,
      });
    } catch (error) {
      fail(error);
    }
  }

  async function moreInvitations() {
    if (data?.invitationsCursor == null) {
      return;
    }
    try {
      const page = await apiRequest(
        pagePath(
          WORKSPACE_ROUTES.invitations(workspaceId),
          data.invitationsCursor,
        ),
        invitationPageSchema,
      );
      setData({
        ...data,
        invitations: [...data.invitations, ...page.items],
        invitationsCursor: page.nextCursor,
      });
    } catch (error) {
      fail(error);
    }
  }

  async function changeRole(member: Member, roleId: string) {
    if (data === null || roleId === member.role.id) {
      return;
    }
    setBusy(member.id);
    setNotice(null);
    try {
      const updated = await apiRequest(
        WORKSPACE_ROUTES.member(workspaceId, member.id),
        memberSchema,
        { method: 'PATCH', body: { roleId }, csrfToken: session.csrfToken },
      );
      setData({
        ...data,
        members: data.members.map((m) => (m.id === updated.id ? updated : m)),
      });
      setNotice({
        ok: true,
        text: `${updated.user.displayName ?? updated.user.email} is now ${updated.role.name}.`,
      });
      if (updated.user.id === session.user.id) {
        reload();
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'last_admin') {
        setNotice({
          ok: false,
          text: 'A workspace needs at least one admin. Make someone else an admin first.',
        });
      } else {
        fail(error);
      }
    } finally {
      setBusy(null);
    }
  }

  async function revoke(invitation: Invitation) {
    if (data === null) {
      return;
    }
    setBusy(invitation.id);
    setNotice(null);
    try {
      await apiCommand(
        WORKSPACE_ROUTES.invitation(workspaceId, invitation.id),
        {
          method: 'DELETE',
          csrfToken: session.csrfToken,
        },
      );
      setData({
        ...data,
        invitations: data.invitations.filter((i) => i.id !== invitation.id),
      });
      setNotice({
        ok: true,
        text: `The invitation for ${invitation.email} was revoked.`,
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  function invited(invitation: Invitation) {
    if (data === null) {
      return;
    }
    setData({
      ...data,
      // Inviting the same address again replaced its earlier invitation.
      invitations: [
        invitation,
        ...data.invitations.filter((i) => i.email !== invitation.email),
      ],
    });
    setNotice({ ok: true, text: `Invitation sent to ${invitation.email}.` });
  }

  if (loadFailed) {
    return (
      <Unavailable
        onRetry={() => {
          setLoadFailed(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  if (data === null) {
    return <Loading label="Loading the team…" />;
  }
  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">
          {canManage
            ? 'Invite people, change roles and revoke invitations.'
            : 'You can see the team. Only admins can invite people or change roles.'}
        </p>
      </div>
      {notice === null ? null : (
        <Alert variant={notice.ok ? 'success' : 'destructive'}>
          <AlertDescription
            className={notice.ok ? undefined : 'text-destructive'}
          >
            {notice.text}
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-3" aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members
        </h2>
        <Table aria-labelledby="members-heading">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((member) => (
              <TableRow
                key={member.id}
                data-testid={`member-${member.user.email}`}
              >
                <TableCell>
                  {member.user.displayName ?? '—'}
                  {member.user.id === session.user.id ? (
                    <span className="text-muted-foreground"> (you)</span>
                  ) : null}
                </TableCell>
                <TableCell>{member.user.email}</TableCell>
                <TableCell>
                  {canManage && member.status === 'ACTIVE' ? (
                    <NativeSelect
                      aria-label={`Role of ${member.user.email}`}
                      className="w-48"
                      value={member.role.id}
                      disabled={busy === member.id}
                      onChange={(e) => void changeRole(member, e.target.value)}
                    >
                      {data.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    member.role.name
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      member.status === 'ACTIVE' ? 'secondary' : 'outline'
                    }
                  >
                    {member.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(member.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.membersCursor === null ? null : (
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => void moreMembers()}
          >
            Show more members
          </Button>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="invitations-heading">
        <h2 id="invitations-heading" className="text-lg font-semibold">
          Open invitations
        </h2>
        {data.invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open invitations.</p>
        ) : (
          <Table aria-labelledby="invitations-heading">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Invited by</TableHead>
                <TableHead>Expires</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invitations.map((invitation) => (
                <TableRow
                  key={invitation.id}
                  data-testid={`invitation-${invitation.email}`}
                >
                  <TableCell>{invitation.email}</TableCell>
                  <TableCell>{invitation.role.name}</TableCell>
                  <TableCell>
                    {invitation.invitedBy.displayName ?? '—'}
                  </TableCell>
                  <TableCell>{formatDate(invitation.expiresAt)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === invitation.id}
                        aria-label={`Revoke the invitation for ${invitation.email}`}
                        onClick={() => void revoke(invitation)}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data.invitationsCursor === null ? null : (
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => void moreInvitations()}
          >
            Show more invitations
          </Button>
        )}
      </section>

      {canManage ? (
        <InviteForm
          workspaceId={workspaceId}
          csrfToken={session.csrfToken}
          roles={data.roles}
          onInvited={invited}
          onError={fail}
        />
      ) : null}
    </div>
  );
}

function InviteForm({
  workspaceId,
  csrfToken,
  roles,
  onInvited,
  onError,
}: {
  readonly workspaceId: string;
  readonly csrfToken: string;
  readonly roles: readonly Role[];
  readonly onInvited: (invitation: Invitation) => void;
  readonly onError: (error: unknown) => void;
}) {
  const roleFieldId = useId();
  const defaultRole =
    roles.find((role) => role.key === 'client_member') ?? roles[0];
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(defaultRole?.id ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(createInvitationRequestSchema, { email, roleId });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const invitation = await apiRequest(
        WORKSPACE_ROUTES.invitations(workspaceId),
        invitationSchema,
        { method: 'POST', body: checked.value, csrfToken },
      );
      setEmail('');
      onInvited(invitation);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'already_member') {
        setErrors({
          email: 'This address already belongs to a member of the workspace.',
        });
      } else {
        setErrors(apiFieldErrors(error));
        onError(error);
      }
    } finally {
      setPending(false);
    }
  }

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
          onSubmit={(e) => void submit(e)}
        >
          <FormField
            label="Email address to invite"
            type="email"
            name="email"
            autoComplete="off"
            value={email}
            error={errors['email']}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
          <div className="grid gap-2">
            <Label htmlFor={roleFieldId}>Role</Label>
            <NativeSelect
              id={roleFieldId}
              value={roleId}
              aria-invalid={errors['roleId'] === undefined ? undefined : true}
              onChange={(e) => {
                setRoleId(e.target.value);
              }}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
            {errors['roleId'] === undefined ? null : (
              <p className="text-sm text-destructive">{errors['roleId']}</p>
            )}
          </div>
          <Button type="submit" className="w-fit" disabled={pending}>
            {pending ? 'Sending…' : 'Send invitation'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

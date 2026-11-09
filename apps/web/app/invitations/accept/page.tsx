'use client';

import {
  API,
  WORKSPACE_ROUTES,
  invitationPreviewSchema,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { AuthShell } from '@/components/auth-shell';
import { Loading, Unavailable } from '@/components/page-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiError, callApi, errorMessage } from '@/lib/api';
import { rememberLinkToken, useLinkToken } from '@/lib/link-token';
import { loginPath } from '@/lib/links';
import { useApiMutation } from '@/lib/query';
import { useSession } from '@/lib/session';

/**
 * The invitation token survives signing in within this tab (sessionStorage), and is removed
 * once the invitation is accepted or unusable. It is never sent anywhere but the API.
 */
const STORAGE_KEY = 'lead-fennec:invitation-token';
const PAGE = '/invitations/accept';

type Preview = z.output<typeof invitationPreviewSchema>;

type Step =
  | { readonly kind: 'loading' }
  | { readonly kind: 'preview'; readonly preview: Preview }
  | { readonly kind: 'unusable' }
  | { readonly kind: 'other_account' }
  | { readonly kind: 'already_member' }
  | { readonly kind: 'failed'; readonly message: string };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });

/** The step an API error leads to; unusable invitations are forgotten. */
function stepFor(error: unknown): Step {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'invalid_or_expired_invitation':
      case 'invitation_for_another_workspace':
        rememberLinkToken(STORAGE_KEY, null);
        return { kind: 'unusable' };
      case 'invitation_for_another_account':
        return { kind: 'other_account' };
      case 'already_member':
        rememberLinkToken(STORAGE_KEY, null);
        return { kind: 'already_member' };
      default:
        break;
    }
  }
  return { kind: 'failed', message: errorMessage(error) };
}

export default function AcceptInvitationPage() {
  const token = useLinkToken(STORAGE_KEY);
  return <AcceptInvitation key={token ?? ''} token={token} />;
}

function AcceptInvitation({
  token,
}: {
  readonly token: string | null | undefined;
}) {
  const router = useRouter();
  const { state, signOut, handleAuthError } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const acceptInvitation = useApiMutation(API.invitations.accept);

  const session = state.status === 'signed_in' ? state.session : null;

  useEffect(() => {
    if (token == null || session === null) {
      return;
    }
    let active = true;
    callApi(
      API.invitations.preview,
      { body: { token } },
      { csrfToken: session.csrfToken },
    ).then(
      (preview) => {
        if (active) {
          setStep({ kind: 'preview', preview });
        }
      },
      (error: unknown) => {
        if (active && !handleAuthError(error)) {
          setStep(stepFor(error));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [token, session, handleAuthError]);

  async function accept(preview: Preview) {
    if (token == null || session === null) {
      return;
    }
    const joined = await acceptInvitation.mutate({
      body: { token, workspaceId: preview.workspace.id },
    });
    if (joined.ok) {
      rememberLinkToken(STORAGE_KEY, null);
      router.push(WORKSPACE_ROUTES.workspace(joined.data.workspace.id));
    } else if (!joined.signedOut) {
      setStep(stepFor(joined.error));
    }
  }

  async function switchAccount() {
    await signOut();
    router.push(loginPath(PAGE));
  }

  const title = 'Join a workspace';
  if (token === undefined || state.status === 'loading') {
    return (
      <AuthShell title={title}>
        <Loading />
      </AuthShell>
    );
  }
  if (token === null) {
    return (
      <AuthShell
        title="Open your invitation link"
        description="This page needs the link from your invitation email."
      >
        <Link
          href="/workspaces"
          className={buttonVariants({ variant: 'outline' })}
        >
          Go to your workspaces
        </Link>
      </AuthShell>
    );
  }
  if (state.status === 'unavailable') {
    return (
      <AuthShell title={title}>
        <Unavailable />
      </AuthShell>
    );
  }
  if (session === null) {
    return (
      <AuthShell
        title="Sign in to accept your invitation"
        description="Use the email address the invitation was sent to."
      >
        <div className="grid gap-3">
          <Link href={loginPath(PAGE)} className={buttonVariants()}>
            Sign in
          </Link>
          <p className="text-sm text-muted-foreground">
            No account yet?{' '}
            <Link
              href="/register"
              className="text-foreground underline underline-offset-4"
            >
              Create one
            </Link>{' '}
            with the invited address, confirm it, then open the invitation link
            again.
          </p>
        </div>
      </AuthShell>
    );
  }
  switch (step.kind) {
    case 'loading':
      return (
        <AuthShell title={title}>
          <Loading label="Checking your invitation…" />
        </AuthShell>
      );
    case 'preview': {
      const { preview } = step;
      return (
        <AuthShell title={`Join ${preview.workspace.name}`}>
          <div className="grid gap-4 text-sm">
            <p>
              {preview.invitedBy.displayName ?? 'An admin'} invited you to join{' '}
              <strong>{preview.workspace.name}</strong> as{' '}
              <strong>{preview.role.name}</strong>.
            </p>
            <p className="text-muted-foreground">
              The invitation is valid until{' '}
              {dateFormat.format(new Date(preview.expiresAt))}.
            </p>
            <Button
              disabled={acceptInvitation.pending}
              onClick={() => void accept(preview)}
            >
              {acceptInvitation.pending ? 'Joining…' : 'Join workspace'}
            </Button>
          </div>
        </AuthShell>
      );
    }
    case 'unusable':
      return (
        <AuthShell
          title="This invitation is invalid or has expired"
          description="Invitations work once, for 7 days. Ask an admin of the workspace to invite you again."
        >
          <Link
            href="/workspaces"
            className={buttonVariants({ variant: 'outline' })}
          >
            Go to your workspaces
          </Link>
        </AuthShell>
      );
    case 'other_account':
      return (
        <AuthShell
          title="This invitation is for another email address"
          description={`You are signed in as ${session.user.email}.`}
        >
          <div className="grid gap-3">
            <p className="text-sm">
              Sign out, then sign in with the address the invitation was sent
              to.
            </p>
            <Button onClick={() => void switchAccount()}>
              Sign out and switch account
            </Button>
          </div>
        </AuthShell>
      );
    case 'already_member':
      return (
        <AuthShell title="You are already a member">
          <Link href="/workspaces" className={buttonVariants()}>
            Go to your workspaces
          </Link>
        </AuthShell>
      );
    case 'failed':
      return (
        <AuthShell title={title}>
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">
              {step.message}
            </AlertDescription>
          </Alert>
        </AuthShell>
      );
  }
}

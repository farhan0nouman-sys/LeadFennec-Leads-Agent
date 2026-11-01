'use client';

import {
  AUTH_ROUTES,
  emailVerifiedResponseSchema,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Loading } from '@/components/page-states';
import { ResendVerification } from '@/components/resend-verification';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { useLinkToken } from '@/lib/links';

type Outcome =
  | { readonly kind: 'verified' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Opened from the confirmation email (#token=…). Confirming takes a click, so link scanners
 * that open pages don't use up the link.
 */
export default function VerifyEmailPage() {
  const token = useLinkToken();
  if (token === undefined) {
    return (
      <AuthShell title="Confirm your email address">
        <Loading />
      </AuthShell>
    );
  }
  return <VerifyEmail key={token ?? ''} token={token} />;
}

function VerifyEmail({ token }: { readonly token: string | null }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm(value: string) {
    setPending(true);
    try {
      await apiRequest(AUTH_ROUTES.verifyEmail, emailVerifiedResponseSchema, {
        method: 'POST',
        body: { token: value },
      });
      setOutcome({ kind: 'verified' });
    } catch (error) {
      setOutcome(
        error instanceof ApiError && error.code === 'invalid_or_expired_token'
          ? { kind: 'invalid' }
          : { kind: 'failed', message: errorMessage(error) },
      );
    } finally {
      setPending(false);
    }
  }

  if (outcome?.kind === 'verified') {
    return (
      <AuthShell title="Email address confirmed">
        <div className="grid gap-4">
          <p className="text-sm">Your account is ready. Sign in to continue.</p>
          <Link href="/login" className={buttonVariants()}>
            Sign in
          </Link>
        </div>
      </AuthShell>
    );
  }
  if (token === null || outcome?.kind === 'invalid') {
    return (
      <AuthShell
        title="This link is invalid or has expired"
        description="Confirmation links work once, for 24 hours. Request a new one below."
      >
        <ResendVerification />
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Confirm your email address"
      description="Confirm that this address belongs to you."
    >
      <div className="grid gap-4">
        {outcome?.kind === 'failed' ? (
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">
              {outcome.message}
            </AlertDescription>
          </Alert>
        ) : null}
        <Button
          disabled={pending}
          onClick={() => {
            void confirm(token);
          }}
        >
          {pending ? 'Confirming…' : 'Confirm my email address'}
        </Button>
      </div>
    </AuthShell>
  );
}

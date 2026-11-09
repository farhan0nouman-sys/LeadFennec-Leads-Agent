'use client';

import {
  API,
  PASSWORD_MIN_LENGTH,
  passwordResetConfirmRequestSchema,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useState, type SubmitEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { FormField } from '@/components/form-field';
import { Loading } from '@/components/page-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiError, callApi, errorMessage } from '@/lib/api';
import { apiFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { useLinkToken } from '@/lib/link-token';
import { useSession } from '@/lib/session';

type Outcome = 'invalid' | 'done';

/** Opened from the reset email (#token=…). Every session of the account ends on success. */
export default function ResetPasswordPage() {
  const linkToken = useLinkToken();
  return linkToken === undefined ? (
    <AuthShell title="Choose a new password">
      <Loading />
    </AuthShell>
  ) : (
    <ResetPassword key={linkToken ?? ''} linkToken={linkToken} />
  );
}

function ResetPassword({ linkToken }: { readonly linkToken: string | null }) {
  const { reload } = useSession();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    const checked = validate(passwordResetConfirmRequestSchema, {
      token: linkToken,
      newPassword: password,
    });
    const fieldErrors: Record<string, string> = checked.ok
      ? {}
      : { ...checked.errors };
    if (confirm !== password) {
      fieldErrors['confirm'] = 'The passwords do not match.';
    }
    if (!checked.ok || Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await callApi(API.auth.passwordResetConfirm, { body: checked.value });
      setPassword('');
      setConfirm('');
      setOutcome('done');
      // Sessions of this account ended, including one in this browser.
      void reload();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'invalid_or_expired_token'
      ) {
        setOutcome('invalid');
        return;
      }
      setErrors(apiFieldErrors(error));
      setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const step = linkToken === null ? 'invalid' : (outcome ?? 'form');
  switch (step) {
    case 'invalid':
      return (
        <AuthShell
          title="This link is invalid or has expired"
          description="Password reset links work once, for 30 minutes."
        >
          <Link href="/forgot-password" className={buttonVariants()}>
            Request a new link
          </Link>
        </AuthShell>
      );
    case 'done':
      return (
        <AuthShell title="Password changed">
          <div className="grid gap-4">
            <p className="text-sm">
              Your new password is set and you were signed out everywhere. Sign
              in with the new password.
            </p>
            <Link href="/login" className={buttonVariants()}>
              Sign in
            </Link>
          </div>
        </AuthShell>
      );
    case 'form':
      return (
        <AuthShell title="Choose a new password">
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => void submit(e)}
          >
            {failure === null ? null : (
              <Alert variant="destructive">
                <AlertDescription className="text-destructive">
                  {failure}
                </AlertDescription>
              </Alert>
            )}
            <FormField
              label="New password"
              type="password"
              name="newPassword"
              autoComplete="new-password"
              hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
              value={password}
              error={errors['newPassword']}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
            <FormField
              label="Confirm new password"
              type="password"
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              error={errors['confirm']}
              onChange={(e) => {
                setConfirm(e.target.value);
              }}
            />
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Set new password'}
            </Button>
          </form>
        </AuthShell>
      );
  }
}

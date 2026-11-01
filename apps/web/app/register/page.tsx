'use client';

import {
  AUTH_ROUTES,
  PASSWORD_MIN_LENGTH,
  acceptedResponseSchema,
  registerRequestSchema,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useState, type SubmitEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiRequest, errorMessage } from '@/lib/api';
import { apiFieldErrors, validate, type FieldErrors } from '@/lib/forms';

export default function RegisterPage() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    const name = displayName.trim();
    const checked = validate(registerRequestSchema, {
      email,
      password,
      ...(name === '' ? {} : { displayName: name }),
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
      await apiRequest(AUTH_ROUTES.register, acceptedResponseSchema, {
        method: 'POST',
        body: checked.value,
      });
      setPassword('');
      setConfirm('');
      setSentTo(checked.value.email);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (sentTo !== null) {
    // The same answer whether or not the address already had an account.
    return (
      <AuthShell
        title="Check your inbox"
        footer={
          <Link href="/login" className="underline underline-offset-4">
            Go to sign in
          </Link>
        }
      >
        <p className="text-sm">
          We sent an email to <strong>{sentTo}</strong>. Open the link in it to
          confirm your address, then sign in. The link works for 24 hours.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create an account"
      description="You'll confirm your email address before you can sign in."
      footer={
        <p className="text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
        {failure === null ? null : (
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">
              {failure}
            </AlertDescription>
          </Alert>
        )}
        <FormField
          label="Name (optional)"
          name="displayName"
          autoComplete="name"
          value={displayName}
          error={errors['displayName']}
          onChange={(e) => {
            setDisplayName(e.target.value);
          }}
        />
        <FormField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          error={errors['email']}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <FormField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters. A few unrelated words work well.`}
          value={password}
          error={errors['password']}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <FormField
          label="Confirm password"
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
          {pending ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}

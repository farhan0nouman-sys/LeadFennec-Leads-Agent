'use client';

import { API, emailRequestSchema } from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useState, type SubmitEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { callApi, errorMessage } from '@/lib/api';
import { apiFieldErrors, validate, type FieldErrors } from '@/lib/forms';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    const checked = validate(emailRequestSchema, { email });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await callApi(API.auth.passwordResetRequest, { body: checked.value });
      setSent(true);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const footer = (
    <Link href="/login" className="underline underline-offset-4">
      Back to sign in
    </Link>
  );
  if (sent) {
    return (
      <AuthShell title="Check your inbox" footer={footer}>
        <p className="text-sm">
          If an account uses that address, we sent a link to choose a new
          password. It works once, for 30 minutes.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Reset your password"
      description="We'll email you a link to choose a new password."
      footer={footer}
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
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send the link'}
        </Button>
      </form>
    </AuthShell>
  );
}

'use client';

import { API, emailRequestSchema } from '@lead-fennec-ai/shared';
import { useState, type SubmitEvent } from 'react';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { callApi, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';

/** Requests a new confirmation link; the answer is the same for any address. */
export function ResendVerification() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(emailRequestSchema, { email });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await callApi(API.auth.resendVerification, { body: checked.value });
      setMessage({
        ok: true,
        text: 'If that address has an unconfirmed account, we sent a new link.',
      });
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
      {message === null ? null : (
        <Alert variant={message.ok ? 'success' : 'destructive'}>
          <AlertDescription
            className={message.ok ? undefined : 'text-destructive'}
          >
            {message.text}
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
      <Button type="submit" variant="outline" disabled={pending}>
        Send a new link
      </Button>
    </form>
  );
}

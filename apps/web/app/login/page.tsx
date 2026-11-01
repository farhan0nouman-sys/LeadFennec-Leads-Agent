'use client';

import {
  AUTH_ROUTES,
  acceptedResponseSchema,
  loginRequestSchema,
  sessionResponseSchema,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type SubmitEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { FormField } from '@/components/form-field';
import { Loading } from '@/components/page-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { apiFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { safeNextPath } from '@/lib/links';
import { useSession } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const expired = params.get('reason') === 'expired';
  const { state, signedIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiError | string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in: continue.
  useEffect(() => {
    if (state.status === 'signed_in') {
      router.replace(next);
    }
  }, [state.status, router, next]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setNotice(null);
    const checked = validate(loginRequestSchema, { email, password });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const session = await apiRequest(
        AUTH_ROUTES.login,
        sessionResponseSchema,
        {
          method: 'POST',
          body: checked.value,
        },
      );
      setPassword('');
      signedIn(session);
      router.replace(next);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFailure(error instanceof ApiError ? error : errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setPending(true);
    try {
      await apiRequest(AUTH_ROUTES.resendVerification, acceptedResponseSchema, {
        method: 'POST',
        body: { email: email.trim() },
      });
      setFailure(null);
      setNotice('We sent a new confirmation link. Check your inbox.');
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const unverified =
    failure instanceof ApiError && failure.code === 'email_not_verified';
  return (
    <AuthShell
      title="Sign in"
      description="Use the email address and password of your Lead Fennec account."
      footer={
        <>
          <Link
            href="/forgot-password"
            className="underline underline-offset-4"
          >
            Forgot your password?
          </Link>
          <p className="text-muted-foreground">
            New here?{' '}
            <Link
              href="/register"
              className="text-foreground underline underline-offset-4"
            >
              Create an account
            </Link>
          </p>
        </>
      }
    >
      <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
        {expired && failure === null ? (
          <Alert>
            <AlertDescription>
              Your session has expired. Sign in again.
            </AlertDescription>
          </Alert>
        ) : null}
        {failure === null ? null : (
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">
              {typeof failure === 'string'
                ? failure
                : failure.code === 'invalid_credentials'
                  ? 'The email address or password is incorrect.'
                  : errorMessage(failure)}
              {unverified ? (
                <Button
                  variant="link"
                  className="h-auto p-0 text-destructive"
                  disabled={pending}
                  onClick={() => void resend()}
                >
                  Send the confirmation link again
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        )}
        {notice === null ? null : (
          <Alert variant="success">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <FormField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
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
          autoComplete="current-password"
          value={password}
          error={errors['password']}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LoginForm />
    </Suspense>
  );
}

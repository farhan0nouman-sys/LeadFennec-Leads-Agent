'use client';

import {
  WORKSPACE_ROUTES,
  createWorkspaceRequestSchema,
  userWorkspaceSchema,
  workspaceListResponseSchema,
  type UserWorkspace,
} from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type SubmitEvent } from 'react';
import { AppHeader } from '@/components/app-header';
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
import { apiRequest, errorMessage } from '@/lib/api';
import { apiFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { useRequiredSession, useSession } from '@/lib/session';

export default function WorkspacesPage() {
  const session = useRequiredSession();
  const { handleAuthError } = useSession();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<readonly UserWorkspace[] | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signedIn = session !== null;
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    let active = true;
    apiRequest(WORKSPACE_ROUTES.workspaces, workspaceListResponseSchema).then(
      (list) => {
        if (active) {
          setWorkspaces(list.items);
          setUnavailable(false);
        }
      },
      (error: unknown) => {
        if (active && !handleAuthError(error)) {
          setUnavailable(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [signedIn, attempt, handleAuthError]);

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session === null) {
      return;
    }
    setFailure(null);
    const checked = validate(createWorkspaceRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const created = await apiRequest(
        WORKSPACE_ROUTES.workspaces,
        userWorkspaceSchema,
        { method: 'POST', body: checked.value, csrfToken: session.csrfToken },
      );
      router.push(WORKSPACE_ROUTES.workspace(created.workspace.id));
    } catch (error) {
      if (!handleAuthError(error)) {
        setErrors(apiFieldErrors(error));
        setFailure(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-8">
        <h1 className="text-2xl font-semibold">Your workspaces</h1>
        {session === null ? (
          <Loading />
        ) : unavailable ? (
          <Unavailable
            onRetry={() => {
              setUnavailable(false);
              setAttempt((n) => n + 1);
            }}
          />
        ) : workspaces === null ? (
          <Loading label="Loading your workspaces…" />
        ) : workspaces.length === 0 ? (
          <p className="text-muted-foreground">
            You are not a member of any workspace yet. Create one below, or open
            the invitation link a colleague sent you.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" aria-label="Workspaces">
            {workspaces.map(({ workspace, membership }) => (
              <li key={workspace.id}>
                <Link
                  href={WORKSPACE_ROUTES.workspace(workspace.id)}
                  className="block rounded-xl border p-4 transition-colors hover:bg-accent"
                >
                  <span className="block font-medium">{workspace.name}</span>
                  <Badge variant="secondary" className="mt-2">
                    {membership.role.name}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {session === null ? null : (
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>Create a workspace</CardTitle>
              <CardDescription>
                You become its admin and can invite your team.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                noValidate
                onSubmit={(e) => void create(e)}
              >
                {failure === null ? null : (
                  <Alert variant="destructive">
                    <AlertDescription className="text-destructive">
                      {failure}
                    </AlertDescription>
                  </Alert>
                )}
                <FormField
                  label="Workspace name"
                  name="name"
                  value={name}
                  error={errors['name']}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
                <Button type="submit" disabled={pending}>
                  {pending ? 'Creating…' : 'Create workspace'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

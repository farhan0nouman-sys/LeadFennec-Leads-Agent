'use client';

import {
  API,
  WORKSPACE_ROUTES,
  createWorkspaceRequestSchema,
} from '@lead-fennec-ai/shared';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { errorMessage } from '@/lib/api';
import { apiFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { useApiMutation } from '@/lib/query';

export function CreateWorkspaceForm() {
  const createWorkspace = useApiMutation(API.workspaces.create);
  const router = useRouter();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    const checked = validate(createWorkspaceRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    const created = await createWorkspace.mutate({ body: checked.value });
    if (created.ok) {
      router.push(WORKSPACE_ROUTES.workspace(created.data.workspace.id));
    } else if (!created.signedOut) {
      setErrors(apiFieldErrors(created.error));
      setFailure(errorMessage(created.error));
    }
  }

  return (
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
          <Button
            type="submit"
            className="w-fit"
            disabled={createWorkspace.pending}
          >
            {createWorkspace.pending ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

'use client';

import { PERMISSION_CATALOG, WORKSPACE_ROUTES } from '@lead-fennec-ai/shared';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useWorkspace } from '@/lib/workspace';

export default function WorkspaceOverviewPage() {
  const { current, can } = useWorkspace();
  const { workspace, membership } = current;
  const granted = PERMISSION_CATALOG.filter((p) => can(p.key));
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        <p className="text-sm text-muted-foreground">
          You are a <Badge variant="secondary">{membership.role.name}</Badge> in
          this workspace.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>What you can do here</CardTitle>
          <CardDescription>Your role grants these permissions.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul
            className="grid list-disc gap-1 pl-5 text-sm"
            aria-label="Your permissions"
          >
            {granted.map((permission) => (
              <li key={permission.key}>{permission.description}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {can('members.read') ? (
        <Link
          href={`${WORKSPACE_ROUTES.workspace(workspace.id)}/team`}
          className={buttonVariants({ variant: 'outline', className: 'w-fit' })}
        >
          View the team
        </Link>
      ) : null}
    </div>
  );
}

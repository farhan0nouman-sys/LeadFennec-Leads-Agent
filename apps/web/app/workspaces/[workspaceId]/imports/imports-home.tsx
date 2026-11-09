'use client';

// The Imports page (task 07C): find companies for an ideal customer profile, or import them
// from a CSV file, import people from a CSV file (task 11C), and the workspace's imports so far. The page checks access on the server
// first; the data comes through the workspace-scoped cache.
import { API } from '@lead-fennec-ai/shared';
import {
  ContactCsvImportForm,
  CsvImportForm,
  DiscoveryForm,
} from '@/components/imports/import-forms';
import { RunList } from '@/components/imports/run-list';
import { RetryState } from '@/components/feedback/retry-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/typography';
import { useApiQuery } from '@/lib/query';
import { useWorkspace } from '@/lib/workspace';

export function ImportsHome() {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const options = useApiQuery(API.imports.options, {
    params: { workspaceId },
  });
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Imports"
        description="Bring companies and people into the workspace. Someone already saved is matched, never added twice; addresses and domains on the do-not-contact list are excluded."
      />
      {options.data === undefined ? (
        options.status === 'error' ? (
          <RetryState
            title="We couldn't load the import options"
            error={options.error}
            onRetry={options.retry}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <span className="sr-only">Loading the import options</span>
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Find companies</CardTitle>
              <CardDescription>
                Search for companies that match an ideal customer profile.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DiscoveryForm options={options.data} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Import a CSV file</CardTitle>
              <CardDescription>
                Choose which column holds each detail, then import.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CsvImportForm options={options.data} />
            </CardContent>
          </Card>
          {options.data.contacts === null ? null : (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Import people from a CSV file</CardTitle>
                <CardDescription>
                  Each person with their company. Every row is checked first,
                  then imported in batches you can follow.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ContactCsvImportForm options={options.data.contacts} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
      <section aria-labelledby="runs-heading" className="grid gap-3">
        <h2 id="runs-heading" className="text-lg font-semibold">
          Imports so far
        </h2>
        <RunList />
      </section>
    </div>
  );
}

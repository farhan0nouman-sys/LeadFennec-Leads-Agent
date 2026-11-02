'use client';

// The component demo's content: fixture data only (fixtures/), through FixtureSource, never the
// API client or its cache (ESLint enforces both directions).
import { emailInputSchema } from '@lead-fennec-ai/shared';
import { Plus, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { CursorPagination } from '@/components/data/pagination';
import { DataTable, type DataColumn } from '@/components/data/data-table';
import {
  FilterSelect,
  ListFilters,
  SearchField,
} from '@/components/data/list-filters';
import { Status, StatusLabel } from '@/components/data/status-label';
import { ConfirmButton } from '@/components/feedback/confirm';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorBoundary } from '@/components/feedback/error-boundary';
import {
  FormError,
  FormField,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader, SectionHeading } from '@/components/ui/typography';
import { ApiError } from '@/lib/api';
import { useCursorTrail, useListParams } from '@/lib/use-list-params';
import { useFormSubmit } from '@/lib/use-form-submit';
import {
  DEMO_LEAD_STATUSES,
  demoLeads,
  type DemoLead,
  type DemoLeadStatus,
} from '@/fixtures/demo-leads';
import { FixtureSource, type FixturePage } from '@/fixtures/fixture-source';

const STATUS_VALUES = DEMO_LEAD_STATUSES.map((s) => s.value) as [
  DemoLeadStatus,
  ...DemoLeadStatus[],
];
const PAGE_SIZES = [5, 10, 25] as const;

/** The list's view in the address bar; invalid values fall back to the defaults. */
const viewSchema = z.object({
  q: z.string().trim().max(100).catch(''),
  status: z.enum(STATUS_VALUES).or(z.literal('')).catch(''),
  limit: z.coerce
    .number()
    .pipe(z.union([z.literal(5), z.literal(10), z.literal(25)]))
    .catch(10),
});

const newLeadSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Enter a name.')
      .max(100, 'Use at most 100 characters.'),
    email: emailInputSchema,
    status: z.enum(STATUS_VALUES, 'Choose a status.'),
    notes: z.string().max(500, 'Use at most 500 characters.'),
  })
  .strict();

const statusOf = (value: DemoLeadStatus) =>
  DEMO_LEAD_STATUSES.find((s) => s.value === value) ?? DEMO_LEAD_STATUSES[0];

export function UiDemo() {
  return (
    <>
      <PageHeader
        title="Component demo"
        description="The shared table, filters, status labels, forms, dialogs and states, on made-up data."
        badge={<Badge variant="outline">Fixture data</Badge>}
      />
      <Alert>
        <AlertTitle>Nothing here is real</AlertTitle>
        <AlertDescription>
          <p>
            The leads are invented, on reserved example domains. This page calls
            no API, reads no workspace and saves nothing; reloading starts over.
          </p>
        </AlertDescription>
      </Alert>
      <StatusSection />
      <LeadsSection />
      <BoundarySection />
    </>
  );
}

function StatusSection() {
  return (
    <section className="grid gap-3" aria-labelledby="statuses-heading">
      <SectionHeading id="statuses-heading">Status labels</SectionHeading>
      <ul className="flex flex-wrap gap-2" aria-label="Lead statuses">
        {DEMO_LEAD_STATUSES.map((status) => (
          <li key={status.value}>
            <StatusLabel tone={status.tone}>{status.label}</StatusLabel>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-2" aria-label="Workspace statuses">
        <li>
          <Status kind="workspace" value="ACTIVE" />
        </li>
        <li>
          <Status kind="workspace" value="SUSPENDED" />
        </li>
        <li>
          <Status kind="workspace" value="ARCHIVED" />
        </li>
      </ul>
    </section>
  );
}

interface Loaded {
  readonly key: string;
  readonly page?: FixturePage;
  readonly error?: unknown;
}

function LeadsSection() {
  const [source] = useState(() => new FixtureSource(demoLeads()));
  const view = useListParams(viewSchema);
  const { q, status, limit } = view.values;
  const pages = useCursorTrail(view.viewKey);
  const cursor = pages.cursor;
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const requestKey = JSON.stringify([q, status, limit, cursor, version]);

  useEffect(() => {
    let active = true;
    source.list({ q, status, limit, cursor }).then(
      (page) => {
        if (active) {
          setLoaded({ key: requestKey, page });
        }
      },
      (error: unknown) => {
        if (active) {
          setLoaded({ key: requestKey, error });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [source, requestKey, q, status, limit, cursor]);

  const reload = () => {
    setVersion((n) => n + 1);
  };
  const current = loaded?.key === requestKey ? loaded : null;
  const failed = current?.error !== undefined;
  const page = current?.page ?? loaded?.page;
  const tableStatus = failed
    ? 'error'
    : page === undefined
      ? 'loading'
      : 'success';
  const clearFilters = () => {
    view.clear();
  };

  const columns: DataColumn<DemoLead>[] = [
    { key: 'name', header: 'Name', rowHeader: true, cell: (lead) => lead.name },
    { key: 'company', header: 'Company', cell: (lead) => lead.company },
    { key: 'email', header: 'Email', cell: (lead) => lead.email },
    {
      key: 'status',
      header: 'Status',
      cell: (lead) => {
        const s = statusOf(lead.status);
        return <StatusLabel tone={s.tone}>{s.label}</StatusLabel>;
      },
    },
    {
      key: 'score',
      header: 'Score',
      className: 'text-right tabular-nums',
      cell: (lead) => lead.score,
    },
    {
      key: 'actions',
      header: 'Actions',
      hideHeader: true,
      className: 'text-right',
      cell: (lead) => (
        <ConfirmButton
          variant="outline"
          size="sm"
          aria-label={`Remove ${lead.name}`}
          confirm={{
            title: `Remove ${lead.name}?`,
            description: 'Only from this demo list; nothing is saved anywhere.',
            confirmLabel: 'Remove lead',
            pendingLabel: 'Removing…',
            destructive: true,
            onConfirm: async () => {
              try {
                await source.remove(lead.id);
              } catch {
                return 'The demo could not remove this lead. Try again.';
              }
              setNotice(`${lead.name} was removed.`);
              reload();
              return null;
            },
          }}
        >
          Remove
        </ConfirmButton>
      ),
    },
  ];

  return (
    <section className="grid gap-4" aria-labelledby="leads-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading id="leads-heading">Demo leads</SectionHeading>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              source.failNextRequest();
              reload();
            }}
          >
            Fail the next load
          </Button>
          <ConfirmButton
            variant="outline"
            confirm={{
              title: 'Reset the demo list?',
              description:
                'Puts back all invented leads and removes the ones you added.',
              confirmLabel: 'Reset list',
              destructive: true,
              typeToConfirm: 'reset',
              onConfirm: () => {
                source.reset(demoLeads());
                setNotice('The demo list was reset.');
                clearFilters();
                reload();
                return Promise.resolve(null);
              },
            }}
          >
            Reset list
          </ConfirmButton>
          <Button
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden="true" />
            Add a demo lead
          </Button>
        </div>
      </div>
      {notice === null ? null : (
        <Alert variant="success">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <ListFilters
        label="Filter demo leads"
        filtered={q !== '' || status !== ''}
        onClear={clearFilters}
      >
        <SearchField
          label="Search leads"
          placeholder="Name, company or email"
          value={q}
          onSearch={(text) => {
            view.update({ q: text });
          }}
        />
        <FilterSelect
          label="Status"
          allLabel="All statuses"
          value={status}
          options={DEMO_LEAD_STATUSES}
          onChange={(value) => {
            view.update({ status: value as DemoLeadStatus | '' });
          }}
        />
      </ListFilters>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {failed
          ? 'The demo leads could not be loaded.'
          : page === undefined
            ? 'Loading demo leads…'
            : `${String(page.total)} ${page.total === 1 ? 'lead matches' : 'leads match'}.`}
      </p>
      <DataTable
        label="Demo leads"
        columns={columns}
        rows={failed ? undefined : page?.items}
        rowKey={(lead) => lead.id}
        status={tableStatus}
        error={
          failed
            ? new ApiError(
                0,
                'network_error',
                'The demo was told to fail this load. Try again.',
              )
            : undefined
        }
        onRetry={reload}
        refreshing={current === null && page !== undefined}
        empty={
          <EmptyState
            icon={SearchX}
            title="No leads match"
            description="Try another search or status."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        }
        footer={
          <CursorPagination
            label="Demo leads"
            page={pages.page}
            hasPrevious={pages.hasPrevious}
            hasNext={page?.nextCursor != null && current !== null}
            onPrevious={pages.previous}
            onNext={() => {
              if (page?.nextCursor != null) {
                pages.next(page.nextCursor);
              }
            }}
            pageSize={limit}
            pageSizes={PAGE_SIZES}
            onPageSizeChange={(size) => {
              view.update({ limit: size as 5 | 10 | 25 });
            }}
            disabled={current === null}
          />
        }
      />
      <Dialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        title="Add a demo lead"
        description="Validated like a real form; added to this page only."
      >
        <AddLeadForm
          source={source}
          onAdded={(lead) => {
            setAdding(false);
            setNotice(`${lead.name} was added.`);
            reload();
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      </Dialog>
    </section>
  );
}

function AddLeadForm({
  source,
  onAdded,
  onCancel,
}: {
  readonly source: FixtureSource;
  readonly onAdded: (lead: DemoLead) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string>('new');
  const [notes, setNotes] = useState('');
  const form = useFormSubmit({
    schema: newLeadSchema,
    // A stand-in for the API: the same result shape as useApiMutation.
    submit: async (value) => {
      if (source.has(value.email)) {
        return {
          ok: false,
          signedOut: false,
          error: new ApiError(400, 'validation_failed', 'Check the fields.', [
            { path: 'email', message: 'This address is already on the list.' },
          ]),
        };
      }
      try {
        const lead = await source.add({
          name: value.name,
          email: value.email.toLowerCase(),
          company: 'Added in the demo',
          status: value.status,
        });
        return { ok: true, data: lead };
      } catch {
        return {
          ok: false,
          signedOut: false,
          error: new ApiError(
            0,
            'network_error',
            'The demo was told to fail this request. Try again.',
          ),
        };
      }
    },
    onSuccess: onAdded,
  });

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit({ name, email, status, notes });
      }}
    >
      <FormError message={form.formError} />
      <FormField
        label="Name"
        name="name"
        autoComplete="off"
        value={name}
        error={form.errors['name']}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="off"
        hint="Use an example.com address: this is demo data."
        value={email}
        error={form.errors['email']}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <SelectField
        label="Status"
        name="status"
        value={status}
        error={form.errors['status']}
        onChange={(event) => {
          setStatus(event.target.value);
        }}
      >
        {DEMO_LEAD_STATUSES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>
      <TextareaField
        label="Notes"
        name="notes"
        hint="Optional, up to 500 characters."
        value={notes}
        error={form.errors['notes']}
        onChange={(event) => {
          setNotes(event.target.value);
        }}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton pending={form.pending} pendingLabel="Adding…">
          Add lead
        </SubmitButton>
      </div>
    </form>
  );
}

function BoundarySection() {
  return (
    <section className="grid gap-3" aria-labelledby="boundary-heading">
      <SectionHeading id="boundary-heading">Error boundary</SectionHeading>
      <p className="text-sm text-muted-foreground">
        A failure inside the panel is contained: the rest of the page keeps
        working, and the panel offers to try again.
      </p>
      <ErrorBoundary title="The demo panel failed">
        <FragilePanel />
      </ErrorBoundary>
    </section>
  );
}

function FragilePanel() {
  const [broken, setBroken] = useState(false);
  if (broken) {
    throw new Error('The demo panel failed on purpose.');
  }
  return (
    <div className="grid justify-items-start gap-3 rounded-xl border p-4">
      <p>This panel works until you break it.</p>
      <Button
        variant="outline"
        onClick={() => {
          setBroken(true);
        }}
      >
        Break this panel
      </Button>
    </div>
  );
}

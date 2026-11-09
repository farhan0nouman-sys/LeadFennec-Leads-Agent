'use client';

// The two ways to bring companies in (task 07C, docs/decisions.md D-07C-06): a search from an
// ideal customer profile, and a CSV file with a column mapping; and a CSV file of people
// (task 11C). Both validate with the shared
// request schemas first; the API checks everything again. The file is read in the browser
// only to show its columns: the server parses it again and is the authority.
import {
  API,
  CONTACT_IMPORT_FIELDS,
  CONTACT_IMPORT_FIELD_LABELS,
  CONTACT_IMPORT_LIMITS,
  CONTACT_IMPORT_REQUIRED_FIELDS,
  CsvError,
  ORGANIZATION_IMPORT_FIELDS,
  ORGANIZATION_IMPORT_FIELD_LABELS,
  ORGANIZATION_IMPORT_LIMITS,
  contactImportRequestSchema,
  csvImportRequestSchema,
  discoveryRequestSchema,
  parseCsv,
  type ContactImportField,
  type ImportOptions,
  type OrganizationImportField,
} from '@lead-fennec-ai/shared';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import {
  FormError,
  FormField,
  SelectField,
  SubmitButton,
} from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  contactMappingFrom,
  guessContactMapping,
  guessMapping,
  mappingFrom,
} from '@/lib/imports';
import { useApiMutation } from '@/lib/query';
import { useFormSubmit } from '@/lib/use-form-submit';
import { useWorkspace } from '@/lib/workspace';

export const importHref = (workspaceId: string, importId: string) =>
  `/workspaces/${workspaceId}/imports/${importId}`;

/** Errors the form can't put next to a field (e.g. the profile's criteria). */
function OtherErrors({
  errors,
  fields,
  title,
}: {
  readonly errors: Readonly<Record<string, string>>;
  readonly fields: readonly string[];
  readonly title: string;
}) {
  const other = Object.entries(errors).filter(([key]) => !fields.includes(key));
  if (other.length === 0) {
    return null;
  }
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription className="text-destructive">
        <p>{title}</p>
        <ul className="mt-1 list-disc pl-5">
          {other.map(([key, message]) => (
            <li key={key}>{message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export function DiscoveryForm({
  options,
}: {
  readonly options: ImportOptions;
}) {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const router = useRouter();
  const request = useApiMutation(API.discovery.request);
  const [icpId, setIcpId] = useState(options.icps[0]?.id ?? '');
  const [maxResults, setMaxResults] = useState(
    String(options.search.defaultResults),
  );
  const form = useFormSubmit({
    schema: discoveryRequestSchema,
    submit: (body) => request.mutate({ params: { workspaceId }, body }),
    onSuccess: (accepted) => {
      router.push(importHref(workspaceId, accepted.runId));
    },
  });
  if (options.icps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Searches start from an ideal customer profile, and this workspace has
        none yet. Profiles can’t be created in the app yet; import a CSV file
        instead.
      </p>
    );
  }
  return (
    <form
      noValidate
      aria-label="Find companies"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const count = maxResults.trim();
        void form.handleSubmit({
          icpId,
          ...(count === '' ? {} : { maxResults: Number(count) }),
        });
      }}
    >
      <FormError message={form.formError} />
      <OtherErrors
        errors={form.errors}
        fields={['icpId', 'maxResults']}
        title="This profile can’t be searched as it is:"
      />
      <SelectField
        label="Ideal customer profile"
        name="icpId"
        value={icpId}
        error={form.errors['icpId']}
        onChange={(event) => {
          setIcpId(event.target.value);
        }}
      >
        {options.icps.map((icp) => (
          <option key={icp.id} value={icp.id}>
            {icp.name}
          </option>
        ))}
      </SelectField>
      <FormField
        label="Most companies to find"
        name="maxResults"
        type="number"
        inputMode="numeric"
        min={1}
        max={options.search.maxResults}
        value={maxResults}
        hint={`From 1 to ${String(options.search.maxResults)}. The search finds companies only; people come later.`}
        error={form.errors['maxResults']}
        onChange={(event) => {
          setMaxResults(event.target.value);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {options.search.provider === 'FAKE'
          ? 'Development provider: synthetic companies, not real businesses.'
          : options.search.attribution}
      </p>
      <div>
        <SubmitButton pending={form.pending} pendingLabel="Starting…">
          Find companies
        </SubmitButton>
      </div>
    </form>
  );
}

interface LoadedFile {
  readonly name: string;
  readonly content: string;
  readonly headers: readonly string[];
  readonly rows: number;
}

export function CsvImportForm({
  options,
}: {
  readonly options: ImportOptions;
}) {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const router = useRouter();
  const fileId = useId();
  const importCsv = useApiMutation(API.imports.csv);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [choice, setChoice] = useState<
    Partial<Record<OrganizationImportField, string>>
  >({});
  const form = useFormSubmit({
    schema: csvImportRequestSchema,
    submit: (body) => importCsv.mutate({ params: { workspaceId }, body }),
    onSuccess: (run) => {
      router.push(importHref(workspaceId, run.id));
    },
  });

  const choose = async (selected: File | undefined) => {
    setFile(null);
    setFileError(null);
    form.reset();
    if (selected === undefined) {
      return;
    }
    if (selected.size > ORGANIZATION_IMPORT_LIMITS.maxChars * 4) {
      setFileError(
        'The file is larger than 256 KB. Split it into smaller files.',
      );
      return;
    }
    const content = await selected.text();
    try {
      const table = parseCsv(content, ORGANIZATION_IMPORT_LIMITS);
      setFile({
        name: selected.name,
        content,
        headers: table.headers,
        rows: table.rows.length,
      });
      setChoice(guessMapping(table.headers));
    } catch (error) {
      setFileError(
        error instanceof CsvError
          ? error.message
          : 'The file could not be read as CSV.',
      );
    }
  };

  const fileErrorText =
    fileError ?? form.errors['content'] ?? form.errors['fileName'];
  return (
    <form
      noValidate
      aria-label="Import a CSV file"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (file === null) {
          setFileError('Choose a CSV file.');
          return;
        }
        void form.handleSubmit({
          fileName: file.name,
          content: file.content,
          mapping: mappingFrom(choice) ?? { name: '' },
        });
      }}
    >
      <FormError message={form.formError} />
      <OtherErrors
        errors={form.errors}
        fields={[
          'content',
          'fileName',
          ...ORGANIZATION_IMPORT_FIELDS.map((field) => `mapping.${field}`),
        ]}
        title="The file can’t be imported as it is:"
      />
      <div className="grid gap-2">
        <Label htmlFor={fileId}>CSV file</Label>
        <Input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          aria-describedby={`${fileId}-hint${fileErrorText === undefined ? '' : ` ${fileId}-error`}`}
          aria-invalid={fileErrorText === undefined ? undefined : true}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
          }}
        />
        <p id={`${fileId}-hint`} className="text-xs text-muted-foreground">
          {`One company per row, with a header row. At most ${String(options.csv.maxRows)} rows and 256 KB. Formulas are imported as plain text.`}
        </p>
        {fileErrorText === undefined ? null : (
          <p id={`${fileId}-error`} className="text-sm text-destructive">
            {fileErrorText}
          </p>
        )}
      </div>
      {file === null ? null : (
        <fieldset className="grid gap-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">
            Columns of {file.name} (
            {file.rows === 1 ? '1 row' : `${String(file.rows)} rows`})
          </legend>
          <p className="text-xs text-muted-foreground">
            Choose the column for each detail. Columns you don’t choose are not
            imported.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {ORGANIZATION_IMPORT_FIELDS.map((field) => (
              <SelectField
                key={field}
                label={
                  field === 'name'
                    ? ORGANIZATION_IMPORT_FIELD_LABELS[field]
                    : `${ORGANIZATION_IMPORT_FIELD_LABELS[field]} (optional)`
                }
                name={`mapping.${field}`}
                value={choice[field] ?? ''}
                error={form.errors[`mapping.${field}`]}
                onChange={(event) => {
                  setChoice({ ...choice, [field]: event.target.value });
                }}
              >
                <option value="">
                  {field === 'name' ? 'Choose a column' : 'Not in this file'}
                </option>
                {file.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </SelectField>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        <SubmitButton pending={form.pending} pendingLabel="Importing…">
          Import companies
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * People from a CSV file (task 11C): a first, a last and a company name are required, and an
 * address, a LinkedIn profile or a company domain identifies each person. The API checks every
 * row at once; the worker saves the rest in batches, and the run's page follows its progress.
 * People on the do-not-contact list are excluded.
 */
export function ContactCsvImportForm({
  options,
}: {
  readonly options: NonNullable<ImportOptions['contacts']>;
}) {
  const { current } = useWorkspace();
  const workspaceId = current.workspace.id;
  const router = useRouter();
  const fileId = useId();
  const importPeople = useApiMutation(API.imports.contacts);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [choice, setChoice] = useState<
    Partial<Record<ContactImportField, string>>
  >({});
  const [leadListId, setLeadListId] = useState('');
  const form = useFormSubmit({
    schema: contactImportRequestSchema,
    submit: (body) => importPeople.mutate({ params: { workspaceId }, body }),
    onSuccess: (run) => {
      router.push(importHref(workspaceId, run.id));
    },
  });

  const choose = async (selected: File | undefined) => {
    setFile(null);
    setFileError(null);
    form.reset();
    if (selected === undefined) {
      return;
    }
    if (selected.size > CONTACT_IMPORT_LIMITS.maxChars * 4) {
      setFileError(
        'The file is larger than 256 KB. Split it into smaller files.',
      );
      return;
    }
    const content = await selected.text();
    try {
      const table = parseCsv(content, CONTACT_IMPORT_LIMITS);
      setFile({
        name: selected.name,
        content,
        headers: table.headers,
        rows: table.rows.length,
      });
      setChoice(guessContactMapping(table.headers));
    } catch (error) {
      setFileError(
        error instanceof CsvError
          ? error.message
          : 'The file could not be read as CSV.',
      );
    }
  };

  const required = new Set<string>(CONTACT_IMPORT_REQUIRED_FIELDS);
  const fileErrorText =
    fileError ?? form.errors['content'] ?? form.errors['fileName'];
  return (
    <form
      noValidate
      aria-label="Import people from a CSV file"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (file === null) {
          setFileError('Choose a CSV file.');
          return;
        }
        void form.handleSubmit({
          fileName: file.name,
          content: file.content,
          mapping: contactMappingFrom(choice) ?? {
            firstName: choice.firstName ?? '',
            lastName: choice.lastName ?? '',
            company: choice.company ?? '',
          },
          ...(leadListId === '' ? {} : { leadListId }),
        });
      }}
    >
      <FormError message={form.formError} />
      <OtherErrors
        errors={form.errors}
        fields={[
          'content',
          'fileName',
          'leadListId',
          ...CONTACT_IMPORT_FIELDS.map((field) => `mapping.${field}`),
        ]}
        title="The file can’t be imported as it is:"
      />
      <div className="grid gap-2">
        <Label htmlFor={fileId}>CSV file of people</Label>
        <Input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          aria-describedby={`${fileId}-hint${fileErrorText === undefined ? '' : ` ${fileId}-error`}`}
          aria-invalid={fileErrorText === undefined ? undefined : true}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
          }}
        />
        <p id={`${fileId}-hint`} className="text-xs text-muted-foreground">
          {`One person per row, with a header row. At most ${String(options.maxRows)} rows and 256 KB, imported ${String(options.rowsPerBatch)} rows at a time. Formulas are imported as plain text.`}
        </p>
        {fileErrorText === undefined ? null : (
          <p id={`${fileId}-error`} className="text-sm text-destructive">
            {fileErrorText}
          </p>
        )}
      </div>
      {file === null ? null : (
        <fieldset className="grid gap-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">
            Columns of {file.name} (
            {file.rows === 1 ? '1 row' : `${String(file.rows)} rows`})
          </legend>
          <p className="text-xs text-muted-foreground">
            Choose the column for each detail. Columns you don’t choose are not
            imported.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {CONTACT_IMPORT_FIELDS.map((field) => (
              <SelectField
                key={field}
                label={
                  required.has(field)
                    ? CONTACT_IMPORT_FIELD_LABELS[field]
                    : `${CONTACT_IMPORT_FIELD_LABELS[field]} (optional)`
                }
                name={`mapping.${field}`}
                value={choice[field] ?? ''}
                error={form.errors[`mapping.${field}`]}
                onChange={(event) => {
                  setChoice({ ...choice, [field]: event.target.value });
                }}
              >
                <option value="">
                  {required.has(field) ? 'Choose a column' : 'Not in this file'}
                </option>
                {file.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </SelectField>
            ))}
          </div>
        </fieldset>
      )}
      {options.leadLists.length === 0 ? null : (
        <SelectField
          label="Add them to a lead list (optional)"
          name="leadListId"
          value={leadListId}
          hint="Only people with an address that isn’t known to be invalid are added."
          error={form.errors['leadListId']}
          onChange={(event) => {
            setLeadListId(event.target.value);
          }}
        >
          <option value="">No lead list</option>
          {options.leadLists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </SelectField>
      )}
      <div>
        <SubmitButton pending={form.pending} pendingLabel="Checking the file…">
          Import people
        </SubmitButton>
      </div>
    </form>
  );
}

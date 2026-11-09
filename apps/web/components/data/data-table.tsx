import type { ReactNode } from 'react';
import { RetryState } from '@/components/feedback/retry-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface DataColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
  /** This column names the row: its cells are row headers for screen readers. */
  readonly rowHeader?: boolean;
  /** The header is read by screen readers only (e.g. a column of action buttons). */
  readonly hideHeader?: boolean;
  readonly className?: string;
}

export type DataTableStatus = 'loading' | 'error' | 'success';

/**
 * A table of records with its loading, empty and failed states (task 05B). Its name is a caption
 * (visually hidden); while loading it shows placeholder rows and announces it; when loading
 * failed it says so and offers a retry, keeping rows it already had. Pagination goes in
 * `footer`.
 */
export function DataTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  rowAttributes,
  status,
  error,
  onRetry,
  refreshing = false,
  empty,
  footer,
  placeholderRows = 3,
}: {
  /** The table's name, e.g. "Members". */
  readonly label: string;
  readonly columns: readonly DataColumn<Row>[];
  readonly rows: readonly Row[] | undefined;
  readonly rowKey: (row: Row) => string;
  /** Extra attributes per row, e.g. data-testid. */
  readonly rowAttributes?: (
    row: Row,
  ) => Readonly<Record<`data-${string}`, string>>;
  readonly status: DataTableStatus;
  readonly error?: unknown;
  readonly onRetry?: () => void;
  /** Showing the rows it has while they load again. */
  readonly refreshing?: boolean;
  /** Shown instead of the table when there are no rows. */
  readonly empty: ReactNode;
  readonly footer?: ReactNode;
  readonly placeholderRows?: number;
}) {
  if (status === 'error' && rows === undefined) {
    return (
      <RetryState
        title={`We couldn't load ${label.toLowerCase()}`}
        error={error}
        {...(onRetry === undefined ? {} : { onRetry })}
      />
    );
  }
  const loading = status === 'loading';
  if (!loading && rows?.length === 0 && status !== 'error') {
    return (
      <div className="grid gap-3">
        {empty}
        {footer}
      </div>
    );
  }
  return (
    <div className="grid gap-3" data-slot="data-table">
      {status === 'error' ? (
        <RetryState
          title={`We couldn't refresh ${label.toLowerCase()}`}
          error={error}
          {...(onRetry === undefined ? {} : { onRetry })}
        />
      ) : null}
      {loading ? (
        <p role="status" className="sr-only">
          Loading {label.toLowerCase()}…
        </p>
      ) : null}
      <Table
        scrollLabel={label}
        aria-busy={loading || refreshing ? true : undefined}
        className={cn(refreshing && 'opacity-60 transition-opacity')}
      >
        <caption className="sr-only">{label}</caption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.hideHeader === true ? (
                  <span className="sr-only">{column.header}</span>
                ) : (
                  column.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading || rows === undefined
            ? Array.from({ length: placeholderRows }, (_, index) => (
                <TableRow key={index} aria-hidden="true">
                  {columns.map((column) => (
                    <TableCell key={column.key}>
                      <Skeleton className="w-24" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow key={rowKey(row)} {...rowAttributes?.(row)}>
                  {columns.map((column) =>
                    column.rowHeader === true ? (
                      <th
                        key={column.key}
                        scope="row"
                        className={cn(
                          'p-2 text-left align-middle font-normal',
                          column.className,
                        )}
                      >
                        {column.cell(row)}
                      </th>
                    ) : (
                      <TableCell key={column.key} className={column.className}>
                        {column.cell(row)}
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {footer}
    </div>
  );
}

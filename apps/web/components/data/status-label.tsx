import { cn } from '@/lib/utils';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const DOT: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

/**
 * A status in words with a coloured dot (task 05B). The text carries the meaning; the colour
 * only repeats it, and the label's own text keeps full contrast.
 */
export function StatusLabel({
  tone = 'neutral',
  children,
  className,
}: {
  readonly tone?: StatusTone;
  readonly children: string;
  readonly className?: string;
}) {
  return (
    <span
      data-slot="status-label"
      data-tone={tone}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])}
      />
      {children}
    </span>
  );
}

/** Labels and tones of the statuses the API returns, one table per kind of record. */
export const STATUS_LABELS = {
  workspace: {
    ACTIVE: { label: 'Active', tone: 'success' },
    SUSPENDED: { label: 'Suspended', tone: 'warning' },
    ARCHIVED: { label: 'Archived', tone: 'neutral' },
  },
  member: {
    ACTIVE: { label: 'Active', tone: 'success' },
    SUSPENDED: { label: 'Suspended', tone: 'warning' },
  },
  campaign: {
    DRAFT: { label: 'Draft', tone: 'neutral' },
    ACTIVE: { label: 'Running', tone: 'success' },
    PAUSED: { label: 'Paused', tone: 'warning' },
    COMPLETED: { label: 'Completed', tone: 'info' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  // A mailbox's stored status: only ACTIVE is a working connection (task 06B).
  mailbox: {
    ACTIVE: { label: 'Connected', tone: 'success' },
    PAUSED: { label: 'Paused', tone: 'warning' },
    PENDING: { label: 'Waiting for authorization', tone: 'info' },
    ERROR: { label: 'Needs reconnecting', tone: 'danger' },
  },
  integration: {
    not_connected: { label: 'Not connected', tone: 'neutral' },
    connecting: { label: 'Connecting', tone: 'info' },
    healthy: { label: 'Healthy', tone: 'success' },
    attention: { label: 'Needs attention', tone: 'danger' },
  },
} as const satisfies Record<
  string,
  Record<string, { label: string; tone: StatusTone }>
>;

type StatusKind = keyof typeof STATUS_LABELS;

/** The label of `value` for a kind of record, e.g. `<Status kind="member" value="ACTIVE" />`. */
export function Status<K extends StatusKind>({
  kind,
  value,
}: {
  readonly kind: K;
  readonly value: keyof (typeof STATUS_LABELS)[K];
}) {
  const status = STATUS_LABELS[kind][value] as {
    label: string;
    tone: StatusTone;
  };
  return <StatusLabel tone={status.tone}>{status.label}</StatusLabel>;
}

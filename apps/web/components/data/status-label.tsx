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
  // An import or a company search (task 07C).
  importRun: {
    PENDING: { label: 'Queued', tone: 'info' },
    PROCESSING: { label: 'Running', tone: 'info' },
    COMPLETED: { label: 'Completed', tone: 'success' },
    FAILED: { label: 'Failed', tone: 'danger' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  // A company's website research run, and its outcome (task 09C).
  research: {
    PENDING: { label: 'Queued', tone: 'info' },
    RUNNING: { label: 'Running', tone: 'info' },
    COMPLETED: { label: 'Completed', tone: 'success' },
    FAILED: { label: 'Failed', tone: 'danger' },
  },
  researchResult: {
    COMPLETED: { label: 'Checked', tone: 'success' },
    REVIEW_REQUIRED: { label: 'Needs review', tone: 'warning' },
    NO_CONTENT: { label: 'Nothing to read', tone: 'neutral' },
  },
  // A lead's qualification, its score's band, and its eligibility (task 10C).
  qualification: {
    QUALIFIED: { label: 'Qualified', tone: 'success' },
    REVIEW: { label: 'Review', tone: 'warning' },
    REJECTED: { label: 'Rejected', tone: 'neutral' },
  },
  scoreBand: {
    HIGH_PRIORITY: { label: 'High Priority', tone: 'success' },
    REVIEW: { label: 'Review', tone: 'warning' },
    LOW_PRIORITY: { label: 'Low Priority', tone: 'neutral' },
  },
  eligibility: {
    eligible: { label: 'May be emailed', tone: 'success' },
    review: { label: 'A person must decide', tone: 'warning' },
    blocked: { label: 'May not be emailed', tone: 'danger' },
  },
  eligibilityCheck: {
    pass: { label: 'Passed', tone: 'success' },
    review: { label: 'Needs a person', tone: 'warning' },
    blocked: { label: 'Blocked', tone: 'danger' },
  },
  // What happened to one record of a run.
  importResult: {
    CREATED: { label: 'Saved (new)', tone: 'success' },
    MATCHED: { label: 'Already saved', tone: 'info' },
    EXCLUDED: { label: 'Excluded', tone: 'warning' },
    FAILED: { label: 'Failed', tone: 'danger' },
  },
  // A contact's data quality and its address's state (task 08C).
  contactQuality: {
    good: { label: 'Good', tone: 'success' },
    review: { label: 'Needs review', tone: 'warning' },
    unusable: { label: "Can't be emailed", tone: 'danger' },
  },
  emailState: {
    eligible: { label: 'Verified', tone: 'success' },
    needs_review: { label: 'Needs a person', tone: 'warning' },
    stale: { label: 'Check is old', tone: 'warning' },
    unverified: { label: 'Not checked', tone: 'neutral' },
    blocked: { label: "Doesn't accept email", tone: 'danger' },
  },
  emailCheck: {
    verified: { label: 'Verified', tone: 'success' },
    risky: { label: 'Risky', tone: 'warning' },
    unknown: { label: 'Unknown', tone: 'warning' },
    invalid: { label: 'Invalid', tone: 'danger' },
  },
  integration: {
    not_connected: { label: 'Not connected', tone: 'neutral' },
    connecting: { label: 'Connecting', tone: 'info' },
    healthy: { label: 'Healthy', tone: 'success' },
    attention: { label: 'Needs attention', tone: 'danger' },
  },
  // A lead file (task 11C): downloadable until it expires, then deleted.
  export: {
    READY: { label: 'Ready', tone: 'success' },
    EXPIRED: { label: 'Expired', tone: 'neutral' },
  },
  // Why an address or a domain is on the do-not-contact list (task 11C).
  suppressionReason: {
    OPT_OUT: { label: 'Asked not to be contacted', tone: 'warning' },
    HARD_BOUNCE: { label: 'Address bounced', tone: 'danger' },
    COMPLAINT: { label: 'Complaint', tone: 'danger' },
    MANUAL: { label: 'Added by a member', tone: 'neutral' },
    DELETION_REQUEST: { label: 'Data deleted on request', tone: 'info' },
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

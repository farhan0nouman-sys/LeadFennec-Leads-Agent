import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Nothing to show yet (or nothing matches): says why and, if possible, what to do next. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center"
    >
      <Icon className="size-7 text-muted-foreground" aria-hidden="true" />
      <p className="font-semibold">{title}</p>
      {description === undefined ? null : (
        <div className="max-w-md text-sm text-muted-foreground">
          {description}
        </div>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

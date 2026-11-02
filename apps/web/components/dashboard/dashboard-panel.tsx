'use client';

import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatTime } from '@/lib/format';
import type { PollingState } from '@/lib/query';

/**
 * One dashboard panel (task 05C): a titled region, its content, and a footer that says when the
 * data was taken, how it refreshes and offers a refresh. Busy while it loads.
 */
export function DashboardPanel({
  id,
  title,
  description,
  busy,
  children,
  footer,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly busy: boolean;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <Card
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      data-panel={id}
      className="gap-4"
    >
      <CardHeader>
        <CardTitle id={`${id}-title`}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
      {footer === undefined ? null : (
        <CardFooter className="flex-wrap justify-between gap-x-4 gap-y-2 border-t pt-4 text-sm text-muted-foreground">
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}

const STOPPED_TEXT = {
  limit: 'Automatic updates stopped after 30 minutes.',
  failures: 'Automatic updates paused after repeated errors.',
} as const;

/**
 * When the data was taken and how it refreshes. A stop of automatic updates is announced
 * politely; the time of each update is not (it would be read out every minute).
 */
export function PanelFooter({
  title,
  generatedAt,
  refreshing,
  schedule,
  polling,
  onRefresh,
}: {
  /** The panel's title, for the refresh button's accessible name. */
  readonly title: string;
  readonly generatedAt: string | undefined;
  readonly refreshing: boolean;
  /** How the panel refreshes while nothing stopped it, e.g. "Updates every minute." */
  readonly schedule: string;
  readonly polling: PollingState | null;
  /** Left out while the panel shows a retry message, which offers the same action. */
  readonly onRefresh: (() => void) | undefined;
}) {
  const stopped = polling?.stopped ?? null;
  return (
    <>
      <div className="grid gap-0.5">
        <p>
          {generatedAt === undefined
            ? 'Not loaded yet.'
            : `Updated ${formatTime(generatedAt)}.`}{' '}
          {stopped === null ? schedule : null}
        </p>
        {/* Always present (empty until a stop), so screen readers notice when it fills. */}
        <p role="status">{stopped === null ? '' : STOPPED_TEXT[stopped]}</p>
      </div>
      {onRefresh === undefined ? null : (
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RotateCw
            aria-hidden="true"
            className={
              refreshing ? 'animate-spin motion-reduce:animate-none' : ''
            }
          />
          {refreshing
            ? 'Refreshing…'
            : stopped === null
              ? 'Refresh'
              : 'Resume updates'}
          {/* Several panels have this button; the name says which one it is for. */}
          <span className="sr-only"> {title}</span>
        </Button>
      )}
    </>
  );
}

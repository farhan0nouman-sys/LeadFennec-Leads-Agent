'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A modal dialog on the native <dialog> (task 05B): showModal() keeps focus inside and makes the
 * page behind inert, Escape closes it, and focus returns to the element that had it. Its content
 * is mounted only while open, so its state starts fresh each time.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  dismissible = true,
  role,
  className,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** False while something is in progress: Escape and the backdrop don't close it. */
  readonly dismissible?: boolean;
  /** `alertdialog` for confirmations that interrupt the user. */
  readonly role?: 'dialog' | 'alertdialog';
  readonly className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      returnFocusTo.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        if (!dismissible) {
          event.preventDefault();
        }
      }}
      onClose={() => {
        onClose();
        returnFocusTo.current?.focus();
        returnFocusTo.current = null;
      }}
      onClick={(event) => {
        // The dialog element itself is only reachable through its backdrop.
        if (dismissible && event.target === ref.current) {
          onClose();
        }
      }}
      className={cn(
        // Text styles reset: a dialog opened from a table cell must not inherit its alignment.
        'm-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-background p-0 text-left font-normal whitespace-normal text-foreground shadow-lg backdrop:bg-black/40',
        className,
      )}
    >
      {open ? (
        <div className="grid gap-4 p-6">
          <div className="grid gap-1.5">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            {description === undefined ? null : (
              <div id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </div>
            )}
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function DialogFooter({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
    >
      {children}
    </div>
  );
}

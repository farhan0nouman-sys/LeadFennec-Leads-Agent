'use client';

import { Menu, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';

/**
 * Navigation on narrow screens: a button that opens a modal dialog with the same navigation.
 * The native <dialog> keeps focus inside, closes on Escape, and makes the page behind inert.
 * Choosing a link, the close button or the backdrop closes it; focus returns to the button.
 */
export function MobileNav({
  label,
  children,
}: {
  /** The dialog's name, e.g. "Workspace navigation". */
  readonly label: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Keep the DOM dialog in step with the state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    const target = event.target as HTMLElement;
    // The dialog itself is the backdrop area; a link means the user navigated.
    if (target === dialogRef.current || target.closest('a') !== null) {
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        className="-ml-2 lg:hidden"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Menu aria-hidden="true" />
        <span className="sr-only">Open navigation</span>
      </Button>
      <dialog
        ref={dialogRef}
        aria-label={label}
        onClose={() => {
          setOpen(false);
          buttonRef.current?.focus();
        }}
        onClick={onClick}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r bg-background p-0 text-foreground shadow-lg backdrop:bg-black/40 lg:hidden"
      >
        {open ? (
          <div className="flex h-full flex-col">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="font-semibold tracking-tight">
                Lead Fennec AI
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                }}
              >
                <X aria-hidden="true" />
                <span className="sr-only">Close navigation</span>
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">{children}</div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

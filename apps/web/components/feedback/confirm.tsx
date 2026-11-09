'use client';

import { useId, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ConfirmOptions {
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly pendingLabel?: string;
  readonly cancelLabel?: string;
  /** Red confirm button: the action removes or blocks something. */
  readonly destructive?: boolean;
  /** The user must type this text first (for actions that are hard to undo). */
  readonly typeToConfirm?: string;
  /** Runs the action: null when it worked (the dialog closes), else the message to show. */
  readonly onConfirm: () => Promise<string | null>;
}

/**
 * Asks before an action takes effect (task 05B). Cancel has the initial focus, so Enter or
 * Escape never confirms by accident; while the action runs, the dialog can't be dismissed; a
 * failure is shown inside it and the dialog stays open.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  ...options
}: ConfirmOptions & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={() => {
        onOpenChange(false);
      }}
      title={options.title}
      description={options.description}
      dismissible={!pending}
      role="alertdialog"
    >
      <ConfirmBody
        {...options}
        pending={pending}
        setPending={setPending}
        close={() => {
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

function ConfirmBody({
  confirmLabel,
  pendingLabel = 'Working…',
  cancelLabel = 'Cancel',
  destructive = false,
  typeToConfirm,
  onConfirm,
  pending,
  setPending,
  close,
}: ConfirmOptions & {
  readonly pending: boolean;
  readonly setPending: (pending: boolean) => void;
  readonly close: () => void;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ready = typeToConfirm === undefined || typed.trim() === typeToConfirm;

  async function confirm() {
    setError(null);
    setPending(true);
    let message: string | null;
    try {
      message = await onConfirm();
    } catch {
      message = 'Something went wrong. Try again.';
    }
    setPending(false);
    if (message === null) {
      close();
    } else {
      setError(message);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !pending) {
          void confirm();
        }
      }}
    >
      {typeToConfirm === undefined ? null : (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>
            Type{' '}
            <span className="font-mono font-semibold">{typeToConfirm}</span> to
            confirm
          </Label>
          <Input
            id={inputId}
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </div>
      )}
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription className="text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button
          variant="outline"
          autoFocus={typeToConfirm === undefined}
          disabled={pending}
          onClick={close}
        >
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          variant={destructive ? 'destructive' : 'default'}
          disabled={!ready || pending}
        >
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A button that opens a ConfirmDialog; focus returns to it when the dialog closes. */
export function ConfirmButton({
  confirm,
  children,
  ...button
}: Omit<ButtonProps, 'onClick'> & {
  readonly confirm: ConfirmOptions;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        aria-haspopup="dialog"
        {...button}
        onClick={() => {
          setOpen(true);
        }}
      >
        {children}
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} {...confirm} />
    </>
  );
}

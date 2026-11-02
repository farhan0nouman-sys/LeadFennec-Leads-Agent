import { useId, type ComponentProps, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface FieldText {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string;
}

/** Ids and ARIA attributes that tie a control to its label, hint and error. */
function useField({ error, hint }: Omit<FieldText, 'label'>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value) => value !== undefined)
    .join(' ');
  return {
    id,
    control: {
      id,
      'aria-invalid': error === undefined ? undefined : true,
      'aria-describedby': describedBy === '' ? undefined : describedBy,
    },
    after: (
      <>
        {hint === undefined ? null : (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {error === undefined ? null : (
          <p id={errorId} className="text-sm text-destructive">
            {error}
          </p>
        )}
      </>
    ),
  };
}

/** A labelled input with its hint and error wired up for assistive technology. */
export function FormField({
  label,
  error,
  hint,
  ...input
}: FieldText & Omit<ComponentProps<'input'>, 'id'>) {
  const field = useField({ error, ...(hint === undefined ? {} : { hint }) });
  return (
    <div className="grid gap-2">
      <Label htmlFor={field.id}>{label}</Label>
      <Input {...field.control} {...input} />
      {field.after}
    </div>
  );
}

/** A labelled native select (task 05B). */
export function SelectField({
  label,
  error,
  hint,
  children,
  ...select
}: FieldText &
  Omit<ComponentProps<'select'>, 'id'> & { readonly children: ReactNode }) {
  const field = useField({ error, ...(hint === undefined ? {} : { hint }) });
  return (
    <div className="grid gap-2">
      <Label htmlFor={field.id}>{label}</Label>
      <NativeSelect {...field.control} {...select}>
        {children}
      </NativeSelect>
      {field.after}
    </div>
  );
}

/** A labelled multi-line text field (task 05B). */
export function TextareaField({
  label,
  error,
  hint,
  ...textarea
}: FieldText & Omit<ComponentProps<'textarea'>, 'id'>) {
  const field = useField({ error, ...(hint === undefined ? {} : { hint }) });
  return (
    <div className="grid gap-2">
      <Label htmlFor={field.id}>{label}</Label>
      <Textarea {...field.control} {...textarea} />
      {field.after}
    </div>
  );
}

/** A form-level error (not tied to one field); announced when it appears. */
export function FormError({ message }: { readonly message: string | null }) {
  return message === null ? null : (
    <Alert variant="destructive">
      <AlertDescription className="text-destructive">
        {message}
      </AlertDescription>
    </Alert>
  );
}

/** The submit button: disabled and relabelled while the form is being sent. */
export function SubmitButton({
  pending,
  pendingLabel,
  children,
  className,
}: {
  readonly pending: boolean;
  readonly pendingLabel: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <Button type="submit" className={className ?? 'w-fit'} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

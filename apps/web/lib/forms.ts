// Form helpers: field errors from the shared zod schemas (before sending) and from the API's
// validation_failed issues (after). Messages never echo what the user typed.
import type { z } from 'zod';
import { ApiError } from './api';

export type FieldErrors = Readonly<Record<string, string>>;

/** The first message per top-level field. */
export function issuesToFieldErrors(
  issues: readonly {
    readonly path: PropertyKey[] | string;
    readonly message: string;
  }[],
): FieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field =
      typeof issue.path === 'string'
        ? (issue.path.split('.')[0] ?? '')
        : String(issue.path[0] ?? '');
    if (field !== '' && !(field in errors)) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

/** Validates `input` with `schema`: the parsed value, or field errors. */
export function validate<S extends z.ZodType>(
  schema: S,
  input: unknown,
):
  | { readonly ok: true; readonly value: z.output<S> }
  | { readonly ok: false; readonly errors: FieldErrors } {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: issuesToFieldErrors(result.error.issues) };
}

/** Field errors the API reported (validation_failed), if any. */
export function apiFieldErrors(error: unknown): FieldErrors {
  return error instanceof ApiError && error.code === 'validation_failed'
    ? issuesToFieldErrors(error.issues)
    : {};
}

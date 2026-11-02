'use client';

// Submitting a form (task 05B): validate with the shared schema first, send, then map the
// answer to field errors (validation_failed, or codes that belong to one field) or a form-level
// message. A session that ended is handled by the mutation (sign-in), so nothing shows here.
import type { ApiErrorCode } from '@lead-fennec-ai/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { errorMessage } from './api';
import { apiFieldErrors, validate, type FieldErrors } from './forms';
import type { MutationResult } from './query';

export function useFormSubmit<S extends z.ZodType, T>({
  schema,
  submit,
  onSuccess,
  fieldErrors = {},
}: {
  readonly schema: S;
  readonly submit: (value: z.output<S>) => Promise<MutationResult<T>>;
  readonly onSuccess?: (data: T, value: z.output<S>) => void;
  /** API error codes shown on a field rather than above the form, with their text. */
  readonly fieldErrors?: Partial<
    Record<ApiErrorCode, { readonly field: string; readonly message: string }>
  >;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Resolves to true when the form was sent and accepted. */
  async function handleSubmit(input: unknown): Promise<boolean> {
    setFormError(null);
    const checked = validate(schema, input);
    if (!checked.ok) {
      setErrors(checked.errors);
      return false;
    }
    setErrors({});
    setPending(true);
    try {
      const result = await submit(checked.value);
      if (result.ok) {
        onSuccess?.(result.data, checked.value);
        return true;
      }
      if (result.signedOut) {
        return false;
      }
      const onField =
        result.error.code in fieldErrors
          ? fieldErrors[result.error.code as ApiErrorCode]
          : undefined;
      if (onField !== undefined) {
        setErrors({ [onField.field]: onField.message });
      } else {
        const fromApi = apiFieldErrors(result.error);
        setErrors(fromApi);
        if (Object.keys(fromApi).length === 0) {
          setFormError(errorMessage(result.error));
        }
      }
      return false;
    } finally {
      setPending(false);
    }
  }

  return {
    errors,
    formError,
    pending,
    handleSubmit,
    reset: () => {
      setErrors({});
      setFormError(null);
    },
  };
}

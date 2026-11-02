'use client';

// A workspace page failed to render (task 05B). The workspace shell around it stays usable.
import { RouteError } from '@/components/feedback/route-error';

export default function WorkspaceError({
  error,
  retry,
}: {
  readonly error: unknown;
  readonly retry: () => void;
}) {
  return <RouteError error={error} retry={retry} />;
}

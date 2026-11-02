'use client';

// An admin page failed to render (task 05B). The admin shell around it stays usable.
import { RouteError } from '@/components/feedback/route-error';

export default function AdminError({
  error,
  retry,
}: {
  readonly error: unknown;
  readonly retry: () => void;
}) {
  return <RouteError error={error} retry={retry} />;
}

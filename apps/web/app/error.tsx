'use client';

// A page outside the workspace and admin areas failed to render (task 05B).
import { RouteError } from '@/components/feedback/route-error';

export default function ErrorPage({
  error,
  retry,
}: {
  readonly error: unknown;
  readonly retry: () => void;
}) {
  return <RouteError error={error} retry={retry} asMain />;
}

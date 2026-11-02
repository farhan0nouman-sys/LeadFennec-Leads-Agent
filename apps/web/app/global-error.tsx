'use client';

// The root layout itself failed (task 05B). It replaces the whole document, so it brings its
// own <html>, <body> and styles.
import { RouteError } from '@/components/feedback/route-error';
import './globals.css';

export default function GlobalError({
  error,
  retry,
}: {
  readonly error: unknown;
  readonly retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-svh">
        <title>Something went wrong · Lead Fennec AI</title>
        <RouteError error={error} retry={retry} asMain />
      </body>
    </html>
  );
}

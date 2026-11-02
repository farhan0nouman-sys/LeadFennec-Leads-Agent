import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';

/** The centered card of the signed-out pages. The page title is the h1. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 outline-none"
    >
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Lead Fennec AI
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl font-semibold">{title}</h1>
          {description === undefined ? null : (
            <CardDescription>{description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer === undefined ? null : (
          <CardFooter className="flex-col items-start gap-2 text-sm">
            {footer}
          </CardFooter>
        )}
      </Card>
    </main>
  );
}

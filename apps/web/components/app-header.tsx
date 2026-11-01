'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';

/** Header of signed-in pages: the app, optional workspace controls, the user and sign-out. */
export function AppHeader({ children }: { readonly children?: ReactNode }) {
  const { state, signOut } = useSession();
  const user = state.status === 'signed_in' ? state.session.user : null;
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-3">
        <Link href="/workspaces" className="font-semibold tracking-tight">
          Lead Fennec AI
        </Link>
        <div className="flex flex-1 flex-wrap items-center gap-4">
          {children}
        </div>
        {user === null ? null : (
          <div className="flex items-center gap-3 text-sm">
            <span
              className="text-muted-foreground"
              data-testid="signed-in-user"
            >
              {user.displayName ?? user.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}

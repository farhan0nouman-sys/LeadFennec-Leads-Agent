'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { ADMIN_PATH } from '@lead-fennec-ai/shared';
import { useSession } from '@/lib/session';
import type { ShellUser } from '@/lib/shell-user';

/** The signed-in user, the admin area (platform admins only) and sign-out. */
export function UserMenu({ user }: { readonly user: ShellUser }) {
  const { signOut } = useSession();
  return (
    <div className="flex shrink-0 items-center gap-2 text-sm">
      {user.platformAdmin ? (
        <Link
          href={ADMIN_PATH}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <ShieldCheck aria-hidden="true" />
          <span className="max-sm:sr-only">Admin</span>
        </Link>
      ) : null}
      <span
        className="hidden max-w-48 truncate text-muted-foreground md:inline"
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
        <LogOut aria-hidden="true" />
        <span className="max-sm:sr-only">Sign out</span>
      </Button>
    </div>
  );
}

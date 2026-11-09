import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/** Unknown pages, unknown workspaces and workspaces the user isn't a member of look the same. */
export default function WorkspaceNotFound() {
  return (
    <div className="mx-auto grid max-w-lg justify-items-start gap-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">
        This page doesn&apos;t exist, or you are not an active member of this
        workspace. Ask one of its admins for an invitation.
      </p>
      <Link
        href="/workspaces"
        className={buttonVariants({ variant: 'outline' })}
      >
        Go to your workspaces
      </Link>
    </div>
  );
}

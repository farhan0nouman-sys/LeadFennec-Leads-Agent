import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function Page() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 p-6">
      <h1 className="text-4xl font-semibold tracking-tight">Lead Fennec AI</h1>
      <p className="text-lg text-muted-foreground">
        Find, research and reach the right leads, together with your team.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/login" className={buttonVariants()}>
          Sign in
        </Link>
        <Link
          href="/register"
          className={buttonVariants({ variant: 'outline' })}
        >
          Create an account
        </Link>
      </div>
    </main>
  );
}

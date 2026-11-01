import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-lg gap-4 p-6 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        Go to the start page
      </Link>
    </main>
  );
}

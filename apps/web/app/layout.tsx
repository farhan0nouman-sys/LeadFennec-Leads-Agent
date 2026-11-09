import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ApiCacheProvider } from '@/lib/query';
import { SessionProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lead Fennec AI',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-svh">
        {/* First focusable element: jumps past the navigation to the page (#main). */}
        <a
          href="#main"
          className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Skip to content
        </a>
        <SessionProvider>
          <ApiCacheProvider>{children}</ApiCacheProvider>
        </SessionProvider>
      </body>
    </html>
  );
}

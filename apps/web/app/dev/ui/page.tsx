// The component demo (task 05B, docs/decisions.md D-05B-05): every shared list, form, dialog
// and state component, on fixture data. Development and test only (404 elsewhere); it needs no
// sign-in because it shows nothing real and calls no API.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { loadWebEnv } from '@/env';
import { demosAllowed } from '@/lib/demos';
import { UiDemo } from './ui-demo';

export const metadata: Metadata = {
  title: 'Component demo · Lead Fennec AI',
  robots: { index: false, follow: false },
};

export default async function UiDemoPage() {
  // Decided per request from the running environment, never at build time.
  await connection();
  if (!demosAllowed(loadWebEnv(process.env).APP_ENV)) {
    notFound();
  }
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto grid max-w-5xl gap-10 px-4 py-8 outline-none"
    >
      <UiDemo />
    </main>
  );
}

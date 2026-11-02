import { adminSectionByPath, adminSectionHref } from '@lead-fennec-ai/shared';
import { notFound } from 'next/navigation';
import { UnavailableSection } from '@/components/section-states';
import { AdminPage } from '../admin-page';

/** Admin pages that aren't built yet: the admin check, then a shell that says so. */
export default async function AdminUnavailablePage({
  params,
}: {
  readonly params: Promise<{ section: string }>;
}) {
  const { section: path } = await params;
  const section = adminSectionByPath(path);
  if (section?.status !== 'unavailable') {
    notFound();
  }
  return (
    <AdminPage path={adminSectionHref(section)}>
      <UnavailableSection
        title={section.label}
        description={section.description}
      />
    </AdminPage>
  );
}

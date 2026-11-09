import { ADMIN_PATH } from '@lead-fennec-ai/shared';
import { PlatformConsole } from '@/components/platform-console';
import { AdminPage } from './admin-page';

export default function AdminWorkspacesPage() {
  return (
    <AdminPage path={ADMIN_PATH}>
      <PlatformConsole />
    </AdminPage>
  );
}

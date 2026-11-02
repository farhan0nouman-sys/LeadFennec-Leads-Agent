import { ADMIN_PATH } from '@lead-fennec-ai/shared';
import { permanentRedirect } from 'next/navigation';

/** The 04C console moved into the admin area (task 05A). */
export default function PlatformRedirect(): never {
  permanentRedirect(ADMIN_PATH);
}

import type { SessionResponse } from '@lead-fennec-ai/shared';

/** The signed-in user as the shell shows it. Server pages pass this, never the session itself. */
export interface ShellUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly platformAdmin: boolean;
}

/** Keeps only what the shell shows: the CSRF token and session times stay out of page props. */
export function shellUser(session: SessionResponse): ShellUser {
  const { id, email, displayName, platformAdmin } = session.user;
  return { id, email, displayName, platformAdmin };
}

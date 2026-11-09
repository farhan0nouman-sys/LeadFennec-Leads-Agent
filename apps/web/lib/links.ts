// Safe redirects after sign-in. Pure: used by client components and by server pages.

export const DEFAULT_SIGNED_IN_PATH = '/workspaces';

const unsafeCharacter = (character: string) => {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f || character === '\\';
};

/**
 * A path inside this app to continue to after sign-in. Anything else (absolute URLs,
 * protocol-relative `//host`, backslashes, control characters) falls back to the default, so
 * the parameter can't send the user to another site.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (
    raw === null ||
    raw === undefined ||
    raw.length > 512 ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    Array.from(raw).some(unsafeCharacter)
  ) {
    return DEFAULT_SIGNED_IN_PATH;
  }
  return raw;
}

/** The sign-in page, returning to `path` afterwards. */
export function loginPath(path: string, reason?: 'expired'): string {
  const params = new URLSearchParams({ next: safeNextPath(path) });
  if (reason !== undefined) {
    params.set('reason', reason);
  }
  return `/login?${params.toString()}`;
}

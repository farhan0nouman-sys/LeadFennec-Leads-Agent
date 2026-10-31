// Matches the password part of URL credentials, e.g. "postgres://user:secret@host".
// Quotes are excluded so a match never spans two JSON strings when applied to log lines.
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"]*:)[^\s@/"]+@/gi;

/** Masks credentials embedded in URLs so the text is safe to log. */
export function redactSecrets(text: string): string {
  return text.replace(URL_PASSWORD, '$1***@');
}

/** A log-safe one-line description of an unknown error. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code =
      'code' in error && typeof error.code === 'string'
        ? ` (${error.code})`
        : '';
    return redactSecrets(`${error.name}${code}: ${error.message}`);
  }
  return redactSecrets(String(error));
}

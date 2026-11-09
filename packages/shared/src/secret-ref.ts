// References to credentials held in a secret store. The database keeps only these references,
// never the credentials themselves; is_secret_ref() in
// packages/database/prisma/migrations/*_outreach_integrity_checks enforces the same format.

export class SecretReferenceError extends Error {
  override readonly name = 'SecretReferenceError';
}

export interface SecretRef {
  /** The whole reference, e.g. "vault://kv/lead-fennec/mailboxes/42". */
  readonly ref: string;
  /** The secret store, e.g. "vault", or "fake" in development and tests. */
  readonly store: string;
  /** The secret's path inside the store. */
  readonly path: string;
}

const SECRET_REF =
  /^([a-z][a-z0-9-]{1,31}):\/\/([A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63})*)$/;

/**
 * Parses a secret reference, `<store>://<path>`, of at most 255 characters. Path segments are
 * 1–64 characters of [A-Za-z0-9._-], so token-shaped values (JWTs, OAuth access or refresh
 * tokens, long API keys) are rejected: put the credential in the secret store and keep only
 * its reference. Error messages never include the rejected value, which may be a secret.
 */
export function parseSecretRef(value: string): SecretRef {
  const match = value.length <= 255 ? SECRET_REF.exec(value) : null;
  const store = match?.[1];
  const path = match?.[2];
  if (store === undefined || path === undefined) {
    throw new SecretReferenceError(
      'Not a secret reference ("<store>://<path>"). Keep credentials in the secret store and store only their reference.',
    );
  }
  return { ref: value, store, path };
}

export function isSecretRef(value: string): boolean {
  return value.length <= 255 && SECRET_REF.test(value);
}

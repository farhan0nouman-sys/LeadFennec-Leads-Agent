import { createHash } from 'node:crypto';

/** JSON with object keys sorted recursively, so equal data always hashes equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }
    return item;
  });
}

/** SHA-256 (hex) of the canonical JSON of a source-record payload. */
export function payloadSha256(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

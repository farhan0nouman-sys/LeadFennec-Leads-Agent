// A list's search, filters and page size in the address bar (task 05B), so a filtered view can
// be shared and survives reloads. The address is untrusted input: each value is validated with
// its field's schema, and an invalid one falls back to that field's default. Pure functions.
import type { z } from 'zod';

interface SearchSource {
  get(name: string): string | null;
}

/** The list's values from the address; each field falls back to its default when invalid. */
export function parseListParams<S extends z.ZodObject>(
  schema: S,
  search: SearchSource,
): z.output<S> {
  const values: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape) as [
    string,
    z.ZodType,
  ][]) {
    const given = field.safeParse(search.get(key) ?? undefined);
    values[key] = given.success ? given.data : field.safeParse(undefined).data;
  }
  return values as z.output<S>;
}

/**
 * The query string for `values`: only fields that differ from `defaults` and aren't empty, in
 * sorted order, so equal views have equal addresses.
 */
export function listParamsQuery(
  values: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(values).sort()) {
    const value = values[key];
    if (
      value === undefined ||
      value === null ||
      value === '' ||
      value === defaults[key]
    ) {
      continue;
    }
    search.set(
      key,
      typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value),
    );
  }
  return search.toString();
}

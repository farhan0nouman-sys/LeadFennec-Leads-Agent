// IANA time zone names for scheduling. Timestamps are stored as UTC instants; wherever local
// time matters (send windows, schedules, planned send times) the zone name is stored next to
// them. The database enforces the same rules with is_iana_time_zone()
// (packages/database/prisma/migrations/*_outreach_integrity_checks). Inputs are untrusted.

export class TimeZoneError extends Error {
  override readonly name = 'TimeZoneError';
}

/** Area/Location in any letter case, before validation. */
const AREA_LOCATION = /^[A-Za-z]+(?:\/[A-Za-z][A-Za-z0-9_+-]*)+$/;
/** The stored spelling, as the database CHECK constraint requires. */
const IANA_NAME = /^[A-Z][A-Za-z]*(?:\/[A-Z][A-Za-z0-9_+-]*)+$/;

/**
 * Normalizes a time zone to the IANA name that is stored: `america/new_york` →
 * `America/New_York`, `Etc/UTC` → `UTC`.
 *
 * - Only "UTC" and Area/Location names are accepted. Abbreviations ("EST"), legacy one-word
 *   names ("EST5EDT", "Japan") and fixed offsets ("+05:00") are rejected: they do not follow a
 *   place's daylight-saving rules.
 * - The zone must be known to the runtime's time zone data (ICU). An alias may resolve to
 *   ICU's name for the same zone (e.g. "US/Eastern" → "America/New_York"); either way the
 *   result is a valid IANA name.
 */
export function normalizeTimeZone(input: string): string {
  const raw = input.trim();
  if (raw.toUpperCase() === 'UTC') {
    return 'UTC';
  }
  if (raw.length > 64 || !AREA_LOCATION.test(raw)) {
    throw new TimeZoneError(
      'Time zone must be an IANA name such as "America/New_York" or "UTC".',
    );
  }
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', {
      timeZone: raw,
    }).resolvedOptions().timeZone;
  } catch {
    throw new TimeZoneError('Unknown time zone.');
  }
  if (resolved !== 'UTC' && !IANA_NAME.test(resolved)) {
    throw new TimeZoneError('Unknown time zone.');
  }
  return resolved;
}

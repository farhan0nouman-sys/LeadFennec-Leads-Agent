// Formatting for dashboard numbers and times (task 05C). Times are relative to the server's
// `generatedAt`, so they read the same whatever the viewer's clock says.

const numbers = new Intl.NumberFormat('en');
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatCount(value: number): string {
  return numbers.format(value);
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "just now", "5 minutes ago", "yesterday", "3 days ago": how long before `now` `at` was. */
export function formatRelativeTime(at: string | Date, now: string | Date) {
  const seconds = Math.round(
    (new Date(now).getTime() - new Date(at).getTime()) / 1000,
  );
  if (seconds < 45) {
    return 'just now';
  }
  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      return relative.format(-Math.floor(seconds / size), unit);
    }
  }
  return relative.format(-1, 'minute');
}

/** Date and time in the viewer's locale and time zone, e.g. for a tooltip. */
export function formatDateTime(at: string | Date): string {
  return new Date(at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Time of day in the viewer's locale and time zone, e.g. "9:05 AM". */
export function formatTime(at: string | Date): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

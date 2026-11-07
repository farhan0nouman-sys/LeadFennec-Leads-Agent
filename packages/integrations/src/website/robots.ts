// robots.txt (RFC 9309, checked 2026-11-06; task 09A, docs/decisions.md D-09A-04). The file is
// untrusted data: it is parsed line by line into rules and never followed as instructions
// beyond allow and disallow. Unparseable lines are skipped, as the RFC requires.

/** RFC 9309 asks crawlers to parse at least 500 KiB; we read up to 512 KiB and parse that. */
export const ROBOTS_MAX_BYTES = 512 * 1024;

export interface RobotsRule {
  readonly allow: boolean;
  /** Normalized: percent-encoded consistently, so it compares with normalized paths. */
  readonly pattern: string;
}

export interface RobotsGroup {
  /** Lower-cased user-agent values of the group's lines. */
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
}

export interface RobotsTxt {
  readonly groups: readonly RobotsGroup[];
}

const LINE = /^([A-Za-z-]+)[ \t]*:[ \t]*(.*)$/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/**
 * Percent-encodes everything outside printable ASCII, upper-cases escapes and decodes escaped
 * unreserved characters, so a pattern and a path written differently compare equal.
 */
export function normalizeRobotsPath(value: string): string {
  const encoded = value.replace(/[^\x21-\x7e]/gu, (character) => {
    try {
      return encodeURIComponent(character);
    } catch {
      return '';
    }
  });
  return encoded.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => {
    const character = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(character) ? character : `%${hex.toUpperCase()}`;
  });
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const hash = rawLine.indexOf('#');
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
    const match = LINE.exec(line);
    if (match === null) {
      continue;
    }
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (key === 'user-agent') {
      if (current === null || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      // Rules before any user-agent line belong to no group.
      current?.rules.push({
        allow: key === 'allow',
        pattern: normalizeRobotsPath(value),
      });
    }
    // Other records (sitemap, crawl-delay ...) neither start nor end a group.
  }
  return { groups };
}

/** "*" matches any characters; a final "$" anchors the end. Matching is case-sensitive. */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  const first = parts[0] ?? '';
  if (!path.startsWith(first)) {
    return false;
  }
  if (parts.length === 1) {
    return !anchored || path.length === first.length;
  }
  let position = first.length;
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    if (index === parts.length - 1 && anchored) {
      return path.length - part.length >= position && path.endsWith(part);
    }
    const found = path.indexOf(part, position);
    if (found === -1) {
      return false;
    }
    position = found + part.length;
  }
  return true;
}

/** The token of a user-agent line: "LeadFennecBot/1.0" and "leadfennecbot" are one crawler. */
const agentToken = (agent: string) => agent.split(/[/\s]/)[0] ?? '';

/**
 * RFC 9309: the groups naming our product token (case-insensitive, merged), else the "*"
 * groups, else no rules. The longest matching rule wins; on a tie, allow wins; no match
 * allows. /robots.txt itself is always allowed.
 */
export function robotsAllows(
  robots: RobotsTxt,
  productToken: string,
  pathAndQuery: string,
): boolean {
  if (pathAndQuery === '/robots.txt') {
    return true;
  }
  const token = productToken.toLowerCase();
  let groups = robots.groups.filter((group) =>
    group.agents.some((agent) => agentToken(agent) === token),
  );
  if (groups.length === 0) {
    groups = robots.groups.filter((group) => group.agents.includes('*'));
  }
  const path = normalizeRobotsPath(pathAndQuery);
  let best: { readonly length: number; readonly allow: boolean } | null = null;
  for (const rule of groups.flatMap((group) => group.rules)) {
    if (rule.pattern === '' || !robotsPatternMatches(rule.pattern, path)) {
      continue;
    }
    const length = rule.pattern.length;
    if (
      best === null ||
      length > best.length ||
      (length === best.length && rule.allow && !best.allow)
    ) {
      best = { length, allow: rule.allow };
    }
  }
  return best?.allow ?? true;
}

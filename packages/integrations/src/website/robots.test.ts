import { describe, expect, it } from 'vitest';
import {
  normalizeRobotsPath,
  parseRobotsTxt,
  robotsAllows,
  robotsPatternMatches,
} from './robots.js';

// Task 09A, docs/decisions.md D-09A-04: robots.txt as RFC 9309 describes it.

const TOKEN = 'LeadFennecBot';
const allows = (text: string, path: string) =>
  robotsAllows(parseRobotsTxt(text), TOKEN, path);

describe('robots.txt groups', () => {
  const file = [
    '# synthetic robots.txt',
    'User-agent: *',
    'Disallow: /private',
    '',
    'User-agent: OtherBot',
    'User-agent: leadfennecbot',
    'Disallow: /no-bots',
    'Allow: /no-bots/ok',
  ].join('\n');

  it('uses the group naming our product token (case-insensitive), not "*"', () => {
    expect(allows(file, '/no-bots/page')).toBe(false);
    expect(allows(file, '/no-bots/ok/page')).toBe(true);
    // The "*" group does not apply once ours exists.
    expect(allows(file, '/private/page')).toBe(true);
  });

  it('falls back to "*" when no group names us', () => {
    const star = 'User-agent: *\nDisallow: /private\n';
    expect(allows(star, '/private/x')).toBe(false);
    expect(allows(star, '/public')).toBe(true);
  });

  it('merges every group that names us and matches a versioned token', () => {
    const text = [
      'User-agent: LeadFennecBot/1.0',
      'Disallow: /a',
      'User-agent: other',
      'Disallow: /',
      'User-agent: LEADFENNECBOT',
      'Disallow: /b',
    ].join('\r\n');
    expect(allows(text, '/a/1')).toBe(false);
    expect(allows(text, '/b/1')).toBe(false);
    expect(allows(text, '/c')).toBe(true);
  });

  it('allows everything without a matching group, and with no rules at all', () => {
    expect(allows('User-agent: OtherBot\nDisallow: /\n', '/x')).toBe(true);
    expect(allows('', '/x')).toBe(true);
    expect(allows('<html>not a robots file</html>', '/x')).toBe(true);
  });

  it('ignores rules before any user-agent, comments, unknown records and garbage', () => {
    const text = [
      'Disallow: /orphan',
      'garbage line without colon',
      'User-agent: * # everyone',
      'Sitemap: https://acme.example/sitemap.xml',
      'Crawl-delay: 10',
      'Disallow: /x # not this part',
    ].join('\n');
    expect(allows(text, '/orphan')).toBe(true);
    expect(allows(text, '/x/y')).toBe(false);
    expect(allows(text, '/x%20#')).toBe(false);
  });

  it('always allows /robots.txt itself', () => {
    expect(allows('User-agent: *\nDisallow: /\n', '/robots.txt')).toBe(true);
    expect(allows('User-agent: *\nDisallow: /\n', '/anything')).toBe(false);
  });
});

describe('robots.txt rule precedence', () => {
  it('lets the longest match win, and allow win a tie', () => {
    const text = [
      'User-agent: *',
      'Disallow: /shop',
      'Allow: /shop/public',
      'Disallow: /shop/public/secret',
      'Allow: /tie',
      'Disallow: /tie',
    ].join('\n');
    expect(allows(text, '/shop/cart')).toBe(false);
    expect(allows(text, '/shop/public/item')).toBe(true);
    expect(allows(text, '/shop/public/secret/1')).toBe(false);
    expect(allows(text, '/tie')).toBe(true);
  });

  it('treats an empty Disallow as no rule', () => {
    expect(allows('User-agent: *\nDisallow:\n', '/anything')).toBe(true);
  });

  it('matches paths case-sensitively, with the query', () => {
    const text = 'User-agent: *\nDisallow: /Admin\nDisallow: /*?session=\n';
    expect(allows(text, '/Admin/x')).toBe(false);
    expect(allows(text, '/admin/x')).toBe(true);
    expect(allows(text, '/page?session=1')).toBe(false);
    expect(allows(text, '/page?lang=en')).toBe(true);
  });
});

describe('robots.txt patterns', () => {
  it.each([
    ['/fish', '/fish', true],
    ['/fish', '/fish.html', true],
    ['/fish', '/Fish', false],
    ['/fish$', '/fish', true],
    ['/fish$', '/fish/', false],
    ['/*.php', '/index.php', true],
    ['/*.php', '/folder/index.php?x=1', true],
    ['/*.php$', '/index.php', true],
    ['/*.php$', '/index.php?x=1', false],
    ['/a*b*c', '/a-x-b-y-c', true],
    ['/a*b*c', '/a-x-c-y-b', false],
    ['/*', '/anything', true],
    ['*$', '/anything', true],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(robotsPatternMatches(pattern, path)).toBe(expected);
  });

  it('compares percent-encoding consistently', () => {
    expect(normalizeRobotsPath('/%7euser')).toBe('/~user');
    expect(normalizeRobotsPath('/a%2fb')).toBe('/a%2Fb');
    const accented = `/caf${String.fromCharCode(0xe9)}`;
    expect(normalizeRobotsPath(accented)).toBe('/caf%C3%A9');
    const text = `User-agent: *\nDisallow: ${accented}\nDisallow: /%7Ehome\n`;
    expect(allows(text, '/caf%c3%a9/menu')).toBe(false);
    expect(allows(text, '/~home/x')).toBe(false);
  });
});

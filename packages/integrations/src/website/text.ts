// Page text extraction (task 09A, docs/decisions.md D-09A-05). HTML is parsed with parse5 (the
// WHATWG parsing algorithm browsers use) into a tree that is only read: no script runs, no
// style or resource loads, and nothing in the page is followed as an instruction. The result
// is plain text, still untrusted: escape it when rendering, validate it before use.

import { TextDecoder } from 'node:util';
import {
  defaultTreeAdapter,
  parse,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes,
  type TreeAdapter,
} from 'parse5';
import { WebsiteFetchError } from './errors.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

export interface PageLink {
  /** Absolute http(s) URL without fragment. Untrusted: fetch it only through the fetcher. */
  readonly url: string;
  readonly text: string;
  /** The same host as the page, ignoring a leading "www.". */
  readonly sameSite: boolean;
}

export interface ExtractedPage {
  readonly title: string | null;
  readonly description: string | null;
  readonly language: string | null;
  readonly text: string;
  readonly textTruncated: boolean;
  readonly links: readonly PageLink[];
}

export interface ExtractOptions {
  readonly baseUrl: URL;
  readonly maxTextChars: number;
  readonly maxLinks: number;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * parse5's work grows with the square of the open-element depth (each start tag scans the
 * stack), and misnested formatting tags can make it create many more elements than the page
 * has tags. Both are capped while parsing, so a hostile page costs linear time: 512 open
 * elements (Chromium's tree-depth limit) and 100,000 elements.
 */
export const MAX_OPEN_ELEMENTS = 512;
export const MAX_ELEMENTS = 100_000;

function boundedTreeAdapter(): TreeAdapter<DefaultTreeAdapterMap> {
  let open = 0;
  let created = 0;
  return {
    ...defaultTreeAdapter,
    createElement(tagName, namespaceURI, attrs) {
      created += 1;
      if (created > MAX_ELEMENTS) {
        throw new WebsiteFetchError('too_complex', { reason: 'elements' });
      }
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
    },
    onItemPush() {
      open += 1;
      if (open > MAX_OPEN_ELEMENTS) {
        throw new WebsiteFetchError('too_complex', { reason: 'nesting' });
      }
    },
    onItemPop() {
      open -= 1;
    },
  };
}

// ─── Decoding ────────────────────────────────────────────────────────────────

function decoderFor(label: string | null): TextDecoder {
  if (label !== null) {
    try {
      return new TextDecoder(label.trim().toLowerCase());
    } catch {
      // An unknown label: fall back to UTF-8 below.
    }
  }
  return new TextDecoder('utf-8');
}

const META_CHARSET =
  /<meta[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9_:.+-]{1,40})/i;

/**
 * Bytes to text: a byte-order mark first, then the Content-Type charset, then (HTML only) a
 * <meta> charset in the first 1024 bytes, else UTF-8. Invalid bytes become U+FFFD.
 */
export function decodeBody(
  bytes: Uint8Array,
  declared: string | null,
  html: boolean,
): { readonly text: string; readonly charset: string } {
  let label: string | null = null;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    label = 'utf-8';
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    label = 'utf-16be';
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    label = 'utf-16le';
  }
  label ??= declared;
  if (label === null && html) {
    const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
    const sniffed = META_CHARSET.exec(head)?.[1] ?? null;
    // A page can't declare UTF-16 in itself (WHATWG encoding sniffing): that means UTF-8.
    label = sniffed?.toLowerCase().startsWith('utf-16') ? 'utf-8' : sniffed;
  }
  const decoder = decoderFor(label);
  return { text: decoder.decode(bytes), charset: decoder.encoding };
}

// ─── Text clean-up ───────────────────────────────────────────────────────────

// C0/C1 controls (except tab and newline), bidirectional overrides and isolates, the zero-width
// space and the BOM: they hide or reorder text when it is shown later.
const UNSAFE_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function cleanText(value: string): string {
  return value.normalize('NFC').replace(UNSAFE_CHARACTERS, '');
}

/** Collapses whitespace inside lines, trims lines and drops empty ones. */
function tidyLines(value: string): string {
  return cleanText(value)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const inline = (value: string) => cleanText(value).replace(/\s+/g, ' ').trim();

function truncate(
  value: string,
  max: number,
): { readonly text: string; readonly truncated: boolean } {
  if (value.length <= max) {
    return { text: value, truncated: false };
  }
  let cut = value.slice(0, max);
  const lastSpace = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  if (lastSpace > max * 0.8) {
    cut = cut.slice(0, lastSpace);
  }
  // Never end on half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(cut)) {
    cut = cut.slice(0, -1);
  }
  return { text: cut.trimEnd(), truncated: true };
}

// ─── Tree helpers ────────────────────────────────────────────────────────────

const isElement = (node: Node): node is Element => 'tagName' in node;

const attribute = (element: Element, name: string): string | null =>
  element.attrs.find((attr) => attr.name === name)?.value ?? null;

const childrenOf = (node: Node): readonly Node[] =>
  'childNodes' in node ? node.childNodes : [];

/** Depth-first, iterative (a deeply nested page must not overflow the stack). */
function findElement(
  root: Node,
  predicate: (element: Element) => boolean,
): Element | null {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    if (isElement(node) && predicate(node)) {
      return node;
    }
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
  return null;
}

function textContent(root: Node, limit: number): string {
  let out = '';
  const stack: Node[] = [root];
  while (stack.length > 0 && out.length < limit) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    if (node.nodeName === '#text' && 'value' in node) {
      out += `${node.value} `;
      continue;
    }
    if (node !== root && isElement(node) && NEVER_TEXT.has(node.tagName)) {
      continue;
    }
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
  return out;
}

// ─── What counts as content ──────────────────────────────────────────────────

/** Never text: code, styles, embedded documents and media, form controls, metadata. */
const NEVER_TEXT = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'math',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'canvas',
  'video',
  'audio',
  'map',
  'head',
  'title',
  'link',
  'meta',
  'base',
  'button',
  'select',
  'option',
  'optgroup',
  'datalist',
  'input',
  'textarea',
  'output',
  'progress',
  'meter',
]);

/** Navigation noise: menus, sidebars, dialogs. */
const NOISE_TAGS = new Set(['nav', 'aside', 'dialog', 'menu']);

const NOISE_ROLES = new Set([
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'menu',
  'menubar',
  'search',
  'dialog',
  'alertdialog',
  'toolbar',
  'tablist',
  'tooltip',
]);

/** Cookie banners, breadcrumbs, skip links and screen-reader-only labels, by id or class. */
const NOISE_NAMES =
  /(^|[\s_-])(cookies?|consent|gdpr|breadcrumbs?|skip-?link|sr-only|visually-hidden|screen-reader-text)($|[\s_-])/i;

const HIDDEN_STYLE = /(display\s*:\s*none|visibility\s*:\s*hidden)/i;

const SECTIONING = new Set(['article', 'main', 'section']);

const BLOCK = new Set([
  'address',
  'article',
  'blockquote',
  'body',
  'caption',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'legend',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
  'ul',
]);

function isNoise(element: Element, sectioningDepth: number): boolean {
  const tag = element.tagName;
  if (NEVER_TEXT.has(tag) || NOISE_TAGS.has(tag)) {
    return true;
  }
  // A page-level header or footer is the site's banner or footer (HTML-AAM); inside an
  // article, main or section it belongs to that content.
  if ((tag === 'header' || tag === 'footer') && sectioningDepth === 0) {
    return true;
  }
  if (
    attribute(element, 'hidden') !== null ||
    attribute(element, 'aria-hidden') === 'true'
  ) {
    return true;
  }
  const role = attribute(element, 'role')?.trim().toLowerCase();
  if (role !== undefined && NOISE_ROLES.has(role)) {
    return true;
  }
  const style = attribute(element, 'style');
  if (style !== null && HIDDEN_STYLE.test(style)) {
    return true;
  }
  const names = `${attribute(element, 'id') ?? ''} ${attribute(element, 'class') ?? ''}`;
  return NOISE_NAMES.test(names);
}

/** One line break at most: empty blocks don't use up the text budget. */
const newline = (out: string) => (out.endsWith('\n') ? out : out + '\n');

/** The text, and whether content was left over when the limit was reached. */
function contentText(
  root: Element,
  rootIsMain: boolean,
  limit: number,
): { readonly text: string; readonly stopped: boolean } {
  let out = '';
  type Frame =
    | { readonly kind: 'node'; readonly node: Node; readonly depth: number }
    | { readonly kind: 'close' };
  const stack: Frame[] = [
    { kind: 'node', node: root, depth: rootIsMain ? 1 : 0 },
  ];
  while (stack.length > 0 && out.length < limit) {
    const frame = stack.pop();
    if (frame === undefined) {
      break;
    }
    if (frame.kind === 'close') {
      out = newline(out);
      continue;
    }
    const { node, depth } = frame;
    if (node.nodeName === '#text' && 'value' in node) {
      out += node.value.replace(/\s+/g, ' ');
      continue;
    }
    if (!isElement(node)) {
      continue;
    }
    if (node !== root && isNoise(node, depth)) {
      continue;
    }
    const tag = node.tagName;
    if (tag === 'br') {
      out = newline(out);
      continue;
    }
    if (tag === 'td' || tag === 'th') {
      out += ' ';
    }
    const block = BLOCK.has(tag);
    if (block) {
      out = newline(out);
      stack.push({ kind: 'close' });
    }
    const childDepth = SECTIONING.has(tag) ? depth + 1 : depth;
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        stack.push({ kind: 'node', node: child, depth: childDepth });
      }
    }
  }
  return {
    text: out,
    stopped: stack.some((frame) => frame.kind === 'node'),
  };
}

const hostKey = (host: string) =>
  host.startsWith('www.') ? host.slice('www.'.length) : host;

function collectLinks(root: Node, base: URL, max: number): PageLink[] {
  const links: PageLink[] = [];
  const seen = new Set<string>();
  const baseHost = hostKey(base.hostname);
  const stack: Node[] = [root];
  while (stack.length > 0 && links.length < max) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    if (isElement(node)) {
      if (NEVER_TEXT.has(node.tagName)) {
        continue;
      }
      const href = node.tagName === 'a' ? attribute(node, 'href') : null;
      if (href !== null) {
        const link = toLink(href, node, base, baseHost);
        if (link !== null && !seen.has(link.url)) {
          seen.add(link.url);
          links.push(link);
        }
      }
    }
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
  return links;
}

function toLink(
  href: string,
  anchor: Element,
  base: URL,
  baseHost: string,
): PageLink | null {
  const value = href.trim();
  // A fragment-only link points back into the same page.
  if (value === '' || value.startsWith('#')) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return null;
  }
  url.hash = '';
  if (url.href.length > 2048) {
    return null;
  }
  return {
    url: url.href,
    text: truncate(inline(textContent(anchor, 400)), 200).text,
    sameSite: hostKey(url.hostname) === baseHost,
  };
}

const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/;

// ─── Entry points ────────────────────────────────────────────────────────────

/**
 * The page's readable content: the <main> element if there is one, else <body>, without
 * scripts, styles, form controls, hidden elements, navigation, sidebars, page-level header
 * and footer, dialogs, cookie banners, breadcrumbs and skip links. Links are collected from
 * the whole body (navigation included: that is where they are), resolved against the page URL.
 */
export function extractHtml(
  html: string,
  options: ExtractOptions,
): ExtractedPage {
  const document = parse(html, { treeAdapter: boundedTreeAdapter() });
  const htmlElement = findElement(
    document,
    (element) => element.tagName === 'html',
  );
  const titleElement = findElement(
    document,
    (element) => element.tagName === 'title',
  );
  const meta = (key: 'name' | 'property', value: string) => {
    const element = findElement(
      document,
      (candidate) =>
        candidate.tagName === 'meta' &&
        attribute(candidate, key)?.trim().toLowerCase() === value,
    );
    return element === null ? null : attribute(element, 'content');
  };
  const descriptionRaw =
    meta('name', 'description') ?? meta('property', 'og:description');
  const lang =
    htmlElement === null ? null : attribute(htmlElement, 'lang')?.trim();
  const body = findElement(document, (element) => element.tagName === 'body');
  const main =
    body === null
      ? null
      : findElement(
          body,
          (element) =>
            element.tagName === 'main' ||
            attribute(element, 'role')?.trim().toLowerCase() === 'main',
        );
  const root = main ?? body;
  const limit = options.maxTextChars + 1024;
  const raw =
    root === null
      ? { text: '', stopped: false }
      : contentText(root, main !== null, limit);
  const text = truncate(tidyLines(raw.text), options.maxTextChars);
  const titleText =
    titleElement === null ? '' : inline(textContent(titleElement, 1000));
  const description = descriptionRaw === null ? '' : inline(descriptionRaw);
  return {
    title: titleText === '' ? null : truncate(titleText, 300).text,
    description: description === '' ? null : truncate(description, 500).text,
    language:
      lang !== undefined && lang !== null && LANGUAGE.test(lang) ? lang : null,
    text: text.text,
    textTruncated: text.truncated || raw.stopped,
    links:
      body === null || options.maxLinks === 0
        ? []
        : collectLinks(body, options.baseUrl, options.maxLinks),
  };
}

/** A text/plain page: cleaned and bounded, with no title, description or links. */
export function extractPlainText(
  value: string,
  options: Pick<ExtractOptions, 'maxTextChars'>,
): ExtractedPage {
  const limit = options.maxTextChars + 1024;
  const text = truncate(tidyLines(value.slice(0, limit)), options.maxTextChars);
  return {
    title: null,
    description: null,
    language: null,
    text: text.text,
    textTruncated: text.truncated || value.length > limit,
    links: [],
  };
}

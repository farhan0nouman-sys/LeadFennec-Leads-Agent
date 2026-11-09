import { describe, expect, it } from 'vitest';
import { WebsiteFetchError } from './errors.js';
import {
  cleanText,
  decodeBody,
  extractHtml,
  extractPlainText,
  MAX_OPEN_ELEMENTS,
} from './text.js';

// Task 09A, docs/decisions.md D-09A-05: readable text without scripts or navigation noise.

const base = new URL('https://www.acme-widgets.com/products/');
const options = { baseUrl: base, maxTextChars: 10_000, maxLinks: 50 };

const PAGE = `<!doctype html>
<html lang="en-GB">
<head>
  <title>  Acme   Widgets | Products </title>
  <meta name="Description" content=" Synthetic widgets for testing. ">
  <style>body { color: red }</style>
  <script>window.secret = "never text";</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header><nav><a href="/">Home</a> <a href="/about">About us</a></nav><p>Site banner</p></header>
  <div id="cookie-banner">We use cookies. <button>Accept</button></div>
  <div role="navigation"><a href="/menu">Menu link</a></div>
  <nav aria-label="breadcrumb"><a href="/products/">Products</a></nav>
  <main id="main">
    <article>
      <header><h1>Widget catalogue</h1></header>
      <p>We make   synthetic
        widgets.</p>
      <p>Contact <a href="mailto:sales@acme-widgets.example">sales</a> or
        <a href="https://partner.example/page#frag">our partner</a>.</p>
      <ul><li>Small widget</li><li>Large widget</li></ul>
      <table><tr><th>Size</th><th>Price</th></tr><tr><td>S</td><td>10</td></tr></table>
      <p hidden>Hidden paragraph</p>
      <p aria-hidden="true">Decorative text</p>
      <p style="display: none">Invisible text</p>
      <span class="sr-only">Screen reader label</span>
      <noscript>Enable JavaScript</noscript>
      <template><p>Template text</p></template>
      <svg><text>SVG text</text></svg>
      <iframe src="https://ads.example/"></iframe>
      <form><label>Email</label><input value="typed value"><select><option>Option text</option></select></form>
      <script>document.write("injected")</script>
      <a href="javascript:alert(1)">Bad link</a>
      <a href="/about">About again</a>
      <aside>Related sidebar</aside>
      <footer><p>Article footer note</p></footer>
    </article>
  </main>
  <footer><p>Page footer, copyright</p><a href="/privacy">Privacy</a></footer>
  <dialog open>Newsletter popup</dialog>
</body>
</html>`;

describe('extractHtml', () => {
  const page = extractHtml(PAGE, options);

  it('keeps the main content as lines of text', () => {
    expect(page.text.split('\n')).toEqual([
      'Widget catalogue',
      'We make synthetic widgets.',
      'Contact sales or our partner.',
      'Small widget',
      'Large widget',
      'Size Price',
      'S 10',
      'Email',
      'Bad link About again',
      'Article footer note',
    ]);
    expect(page.textTruncated).toBe(false);
  });

  it('drops scripts, styles, hidden elements, controls and navigation noise', () => {
    for (const noise of [
      'never text',
      'injected',
      'color: red',
      'Skip to content',
      'Site banner',
      'cookies',
      'Menu link',
      'Hidden paragraph',
      'Decorative text',
      'Invisible text',
      'Screen reader label',
      'Enable JavaScript',
      'Template text',
      'SVG text',
      'typed value',
      'Option text',
      'Related sidebar',
      'Page footer',
      'Newsletter popup',
    ]) {
      expect(page.text).not.toContain(noise);
    }
  });

  it('reads the title, description and language', () => {
    expect(page.title).toBe('Acme Widgets | Products');
    expect(page.description).toBe('Synthetic widgets for testing.');
    expect(page.language).toBe('en-GB');
  });

  it('collects absolute http(s) links once, without fragments or scripts', () => {
    expect(page.links).toEqual([
      { url: 'https://www.acme-widgets.com/', text: 'Home', sameSite: true },
      {
        url: 'https://www.acme-widgets.com/about',
        text: 'About us',
        sameSite: true,
      },
      {
        url: 'https://www.acme-widgets.com/menu',
        text: 'Menu link',
        sameSite: true,
      },
      {
        url: 'https://www.acme-widgets.com/products/',
        text: 'Products',
        sameSite: true,
      },
      {
        url: 'https://partner.example/page',
        text: 'our partner',
        sameSite: false,
      },
      {
        url: 'https://www.acme-widgets.com/privacy',
        text: 'Privacy',
        sameSite: true,
      },
    ]);
    expect(extractHtml(PAGE, { ...options, maxLinks: 2 }).links).toHaveLength(
      2,
    );
    expect(extractHtml(PAGE, { ...options, maxLinks: 0 }).links).toEqual([]);
  });

  it('uses the body when there is no main element, without page header and footer', () => {
    const result = extractHtml(
      '<header>Logo</header><section><header>Section title</header><p>Body text</p></section><footer>Footer</footer>',
      options,
    );
    expect(result.text).toBe('Section title\nBody text');
    expect(result.title).toBeNull();
    expect(result.language).toBeNull();
  });

  it('bounds the text and says when it was cut', () => {
    const long = `<main><p>${'word '.repeat(5000)}</p></main>`;
    const result = extractHtml(long, { ...options, maxTextChars: 1000 });
    expect(result.text.length).toBeLessThanOrEqual(1000);
    expect(result.textTruncated).toBe(true);
    expect(result.text.endsWith('word')).toBe(true);
  });

  it('reads nesting up to the limit and malformed markup', () => {
    const depth = MAX_OPEN_ELEMENTS - 10;
    const nested = `${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}`;
    expect(extractHtml(nested, options).text).toBe('deep');
    expect(
      extractHtml('<p>unclosed <b>bold <i>italic</p><p>next', options).text,
    ).toBe('unclosed bold italic\nnext');
  });

  it('refuses hostile markup quickly instead of parsing it for minutes', () => {
    const cases: [string, string][] = [
      // 20,000 nested elements: parse5 alone needs about 6 s (quadratic in depth).
      [`${'<div>'.repeat(20_000)}deep${'</div>'.repeat(20_000)}`, 'nesting'],
      // Distinct formatting elements reconstructed in every paragraph: 150,000 elements.
      [
        `<p>${Array.from({ length: 50 }, (_, index) => `<b id="${String(index)}">`).join('')}</p>${'<p>x</p>'.repeat(3000)}`,
        'elements',
      ],
    ];
    for (const [html, reason] of cases) {
      const started = performance.now();
      try {
        extractHtml(html, options);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(WebsiteFetchError);
        expect(error).toMatchObject({
          code: 'too_complex',
          reason,
          retryable: false,
        });
      }
      expect(performance.now() - started).toBeLessThan(2000);
    }
  });

  it('refuses a malformed language tag', () => {
    expect(
      extractHtml('<html lang="en; DROP TABLE"><p>x</p></html>', options)
        .language,
    ).toBeNull();
  });
});

describe('cleanText', () => {
  it('removes control, bidirectional and zero-width characters', () => {
    const value = [
      'a',
      0x0,
      'b',
      0x1b,
      'c',
      0x202e,
      'd',
      0x2066,
      'e',
      0x200b,
      'f',
      0xfeff,
      'g',
    ]
      .map((part) =>
        typeof part === 'number' ? String.fromCharCode(part) : part,
      )
      .join('');
    expect(cleanText(value)).toBe('abcdefg');
    expect(cleanText('line\nnext\ttab')).toBe('line\nnext\ttab');
  });

  it('strips them from page text too', () => {
    const rlo = String.fromCharCode(0x202e);
    expect(extractHtml(`<p>pay${rlo}evil</p>`, options).text).toBe('payevil');
  });
});

describe('decodeBody', () => {
  it('uses the Content-Type charset', () => {
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    expect(decodeBody(bytes, 'windows-1252', true)).toEqual({
      text: `caf${String.fromCharCode(0xe9)}`,
      charset: 'windows-1252',
    });
  });

  it('finds a <meta> charset in the first bytes of HTML', () => {
    const bytes = Buffer.concat([
      Buffer.from('<meta charset="iso-8859-1"><p>caf'),
      Buffer.from([0xe9]),
    ]);
    const decoded = decodeBody(bytes, null, true);
    expect(decoded.text.endsWith(`caf${String.fromCharCode(0xe9)}`)).toBe(true);
    expect(decoded.charset).toBe('windows-1252');
  });

  it('lets a byte-order mark win, and falls back to UTF-8', () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('hi', 'utf16le'),
    ]);
    expect(decodeBody(utf16, 'iso-8859-1', true)).toEqual({
      text: 'hi',
      charset: 'utf-16le',
    });
    expect(decodeBody(Buffer.from('plain'), 'no-such-charset', false)).toEqual({
      text: 'plain',
      charset: 'utf-8',
    });
    expect(decodeBody(Buffer.from([0xff, 0x41]), null, false).text).toBe(
      `${String.fromCharCode(0xfffd)}A`,
    );
  });
});

describe('extractPlainText', () => {
  it('cleans and bounds plain text', () => {
    const result = extractPlainText('  first line  \r\n\r\n second\tline ', {
      maxTextChars: 100,
    });
    expect(result).toEqual({
      title: null,
      description: null,
      language: null,
      text: 'first line\nsecond line',
      textTruncated: false,
      links: [],
    });
    expect(
      extractPlainText('x'.repeat(5000), { maxTextChars: 100 }).textTruncated,
    ).toBe(true);
  });
});

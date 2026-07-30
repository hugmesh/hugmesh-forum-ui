import { renderMarkdown, sanitizeContentHtml } from './markdown';

describe('renderMarkdown', () => {
  it('renders a paragraph with bold and italic', () => {
    const html = renderMarkdown('Hello **bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders headings as h2..h4 (h1 reserved for the page title)', () => {
    expect(renderMarkdown('# Top')).toContain('<h2>Top</h2>');
    expect(renderMarkdown('## Sub')).toContain('<h3>Sub</h3>');
  });

  it('renders a bullet list', () => {
    const html = renderMarkdown('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });

  /** Parse the rendered HTML into a detached DOM and assert what it actually
   *  produces — the real security property, not a substring match. */
  function dom(src: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown(src);
    return host;
  }

  it('keeps http(s) links and renders no javascript:-scheme anchor', () => {
    expect(renderMarkdown('[ok](https://example.com)')).toContain('href="https://example.com"');
    const host = dom('[x](javascript:alert(1))');
    // No actionable anchor is produced for a non-http(s) target.
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('[href^="javascript:"]')).toBeNull();
  });

  it('produces no <script> element and no event-handler attributes (inert)', () => {
    const host = dom('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('img')).toBeNull(); // raw HTML is escaped, not parsed as an element
    // No element carries an inline event handler.
    for (const el of Array.from(host.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.startsWith('on')).withContext(`attr ${attr.name}`).toBeFalse();
      }
    }
  });

  it('escapes inline html so it cannot inject markup', () => {
    const host = dom('a <b>raw</b> tag');
    expect(host.querySelector('b')).toBeNull();
  });
});

describe('sanitizeContentHtml', () => {
  /** Parse the sanitized HTML into a detached DOM and assert what it actually
   *  produces — the real security property, not a substring match. */
  function dom(html: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = sanitizeContentHtml(html);
    return host;
  }

  it('strips <script> elements (and their text is not executed as markup)', () => {
    const host = dom('<p>hello</p><script>alert(1)</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('p')?.textContent).toBe('hello');
  });

  it('strips inline event-handler attributes such as onerror', () => {
    const host = dom('<img src="x" onerror="alert(1)">ok');
    // img is not in the allow-list, so it is removed entirely…
    expect(host.querySelector('img')).toBeNull();
    // …and absolutely no element retains an on* handler.
    for (const el of Array.from(host.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.startsWith('on')).withContext(`attr ${attr.name}`).toBeFalse();
      }
    }
  });

  it('strips event handlers even on allow-listed tags', () => {
    const host = dom('<a href="https://ok.test" onclick="alert(1)">link</a>');
    const a = host.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('onclick')).toBeNull();
    expect(a?.getAttribute('href')).toBe('https://ok.test');
  });

  it('drops javascript:-scheme hrefs while keeping the link text inert', () => {
    const host = dom('<a href="javascript:alert(1)">x</a>');
    expect(host.querySelector('[href^="javascript:"]')).toBeNull();
  });

  it('removes iframe, svg and object elements', () => {
    const host = dom(
      '<iframe src="https://evil.test"></iframe>' +
      '<svg><script>alert(1)</script></svg>' +
      '<object data="x"></object><p>kept</p>',
    );
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('object')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('p')?.textContent).toBe('kept');
  });

  it('preserves benign rich markup (headings, lists, tables, links)', () => {
    const html = sanitizeContentHtml(
      '<h2>Title</h2><p>body <strong>bold</strong></p>' +
      '<ul><li>one</li></ul><ol><li>a</li></ol>' +
      '<table><tbody><tr><td>cell</td></tr></tbody></table>' +
      '<a href="https://ok.test" rel="noopener" target="_blank">go</a>',
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelector('h2')?.textContent).toBe('Title');
    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('ul li')?.textContent).toBe('one');
    expect(host.querySelector('ol li')?.textContent).toBe('a');
    expect(host.querySelector('table td')?.textContent).toBe('cell');
    const a = host.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://ok.test');
  });

  it('treats null/undefined input as empty', () => {
    expect(sanitizeContentHtml(null as unknown as string)).toBe('');
    expect(sanitizeContentHtml(undefined as unknown as string)).toBe('');
  });
});

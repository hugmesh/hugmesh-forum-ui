import DOMPurify from 'dompurify';

/**
 * Minimal, safe Markdown → sanitized-HTML helper for the forum composer preview
 * and reply preview. This is CLIENT-SIDE convenience ONLY: the authoritative
 * sanitization happens server-side in the phpBB extension (phpBB's own post
 * parser) — the BFF returns already-sanitized body_html. We never trust this
 * output as the stored representation.
 *
 * The renderer covers the common subset (headings, bold/italic/code, links,
 * lists, blockquote, paragraphs) and then passes everything through DOMPurify
 * with a conservative allow-list so a preview can never execute script.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  let t = escapeHtml(text);
  // code spans first so their contents aren't further transformed
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // [text](http(s)://url) — only http/https targets become links.
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    return `<a href="${url}" rel="noopener noreferrer nofollow" target="_blank">${label}</a>`;
  });
  // A markdown link whose target is NOT http(s) (e.g. javascript:/data:) is
  // left as inert plain text by the rule above — but neutralize the dangerous
  // SCHEME token so even the literal text can't read as an actionable URL.
  t = t.replace(/\[[^\]]*\]\(\s*(javascript|data|vbscript|file)\s*:[^)]*\)/gi, '[link removed]');
  return t;
}

/** Render a small Markdown subset to a SANITIZED HTML string. */
export function renderMarkdown(src: string): string {
  const lines = (src ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let listOpen = false;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1; // h2..h4 (h1 is the page title)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      flushParagraph();
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();

  const html = out.join('\n');
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['h2', 'h3', 'h4', 'p', 'strong', 'em', 'code', 'a', 'ul', 'li', 'blockquote', 'br'],
    ALLOWED_ATTR: ['href', 'rel', 'target'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}

/** Sanitize SERVER-RENDERED post HTML before it is bound into the page view.
 *  The phpBB extension / forum-bff already sanitizes on the way in; we still
 *  re-sanitize at the browser boundary (defence-in-depth) so a compromised or
 *  misbehaving upstream can never inject script into the reader's DOM. The
 *  allow-list is a superset of the composer preview (the stored body may carry
 *  more structure such as ordered lists, tables and pre blocks) but still
 *  forbids script/iframe/svg/object, all on* event-handler attributes, and any
 *  non-http(s) URI scheme. */
export function sanitizeContentHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'code', 'pre',
      'a', 'ul', 'ol', 'li', 'blockquote', 'br', 'hr', 'table', 'thead',
      'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['href', 'rel', 'target'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}

import {
  MAX_STICKERS_PER_POST,
  insertAtCursor,
  stickerBodyUrl,
  stickerToken,
  transformStickerTokens,
} from './stickers';

/** Build a container the way the app does: sanitized HTML already inserted. */
function container(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html; // test fixture only — the app inserts DOMPurify output
  return div;
}

describe('transformStickerTokens', () => {
  it('replaces a token in a text node with a DOM-created img (correct src/alt/class)', () => {
    const el = container('<p>hello :snap-sticker:wave: world</p>');
    const made = transformStickerTokens(el);
    expect(made).toBe(1);
    const img = el.querySelector('img.forum-sticker')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/bff/user/character/stickers/wave/body');
    expect(img.getAttribute('alt')).toBe('sticker wave');
    expect(img.getAttribute('loading')).toBe('lazy');
    // Surrounding text is preserved on both sides.
    expect(el.textContent).toContain('hello ');
    expect(el.textContent).toContain(' world');
    expect(el.textContent).not.toContain(':snap-sticker:');
  });

  it('handles multiple tokens across multiple elements', () => {
    const el = container('<p>:snap-sticker:a: and :snap-sticker:b-2_x:</p><ul><li>:snap-sticker:c:</li></ul>');
    expect(transformStickerTokens(el)).toBe(3);
    const srcs = Array.from(el.querySelectorAll('img.forum-sticker')).map((i) => i.getAttribute('src'));
    expect(srcs).toEqual([
      '/bff/user/character/stickers/a/body',
      '/bff/user/character/stickers/b-2_x/body',
      '/bff/user/character/stickers/c/body',
    ]);
  });

  it('leaves malformed slugs as inert text (uppercase, empty, >64 chars, bad charset)', () => {
    const long = 'a'.repeat(65);
    const el = container(`<p>:snap-sticker:WAVE: :snap-sticker:: :snap-sticker:${long}: :snap-sticker:a b:</p>`);
    expect(transformStickerTokens(el)).toBe(0);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(':snap-sticker:WAVE:');
  });

  it('a hostile "slug" cannot inject markup — the img is DOM-created, never innerHTML', () => {
    const el = container('<p>:snap-sticker:&lt;img src=x onerror=alert(1)&gt;:</p>');
    const before = el.textContent;
    expect(transformStickerTokens(el)).toBe(0);
    // Nothing was created and the text is untouched (the payload stays inert text).
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe(before);
  });

  it('a token inside <code> still transforms safely as a DOM img', () => {
    const el = container('<p><code>:snap-sticker:wave:</code></p>');
    expect(transformStickerTokens(el)).toBe(1);
    const img = el.querySelector('code img.forum-sticker')!;
    expect(img.getAttribute('src')).toBe('/bff/user/character/stickers/wave/body');
  });

  it(`caps rendering at ${MAX_STICKERS_PER_POST} stickers per post; extras stay as text`, () => {
    const tokens = Array.from({ length: 12 }, (_, i) => `:snap-sticker:s${i}:`).join(' ');
    const el = container(`<p>${tokens}</p>`);
    expect(transformStickerTokens(el)).toBe(MAX_STICKERS_PER_POST);
    expect(el.querySelectorAll('img.forum-sticker').length).toBe(MAX_STICKERS_PER_POST);
    expect(el.textContent).toContain(':snap-sticker:s8:');
  });

  it('is idempotent: re-running never exceeds the cap (already-rendered stickers count)', () => {
    const tokens = Array.from({ length: 12 }, (_, i) => `:snap-sticker:s${i}:`).join(' ');
    const el = container(`<p>${tokens}</p>`);
    transformStickerTokens(el);
    expect(transformStickerTokens(el)).toBe(0);
    expect(el.querySelectorAll('img.forum-sticker').length).toBe(MAX_STICKERS_PER_POST);
  });

  it('no-ops on a body with no tokens', () => {
    const el = container('<p>plain <strong>post</strong></p>');
    const html = el.innerHTML;
    expect(transformStickerTokens(el)).toBe(0);
    expect(el.innerHTML).toBe(html);
  });
});

describe('stickerBodyUrl / stickerToken', () => {
  it('builds the same-origin body URL for a valid slug only', () => {
    expect(stickerBodyUrl('wave')).toBe('/bff/user/character/stickers/wave/body');
    expect(stickerBodyUrl('../../etc')).toBeNull();
    expect(stickerBodyUrl('UPPER')).toBeNull();
    expect(stickerBodyUrl('')).toBeNull();
  });

  // CROSS-REPO CONTRACT REGRESSION: hugmesh-user-bff-api's
  // StickerController.serveBody serves the pixels at
  //   GET /bff/user/character/stickers/{slug}/body
  // where {slug} is the sticker row id (a lowercase UUID, 36 chars of
  // [a-z0-9-]). This URL builder MUST stay byte-for-byte identical to that
  // route, so a real backend id resolves and a slug the server's SLUG_SHAPE
  // (mirror of STICKER_SLUG_RE) would reject never mints an <img> that 404s.
  it('matches the real user-bff serve route for a backend UUID slug', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(stickerBodyUrl(id)).toBe(`/bff/user/character/stickers/${id}/body`);
    // The server mirror is [a-z0-9_-]{1,64}: an uppercase-hex id (never minted
    // by gen_random_uuid, but proving the shared charset) is rejected on both
    // sides identically rather than producing a guaranteed-404 <img>.
    expect(stickerBodyUrl('3F2504E0')).toBeNull();
    expect(stickerBodyUrl('a'.repeat(65))).toBeNull();
  });

  it('builds the composer token for a valid slug only', () => {
    expect(stickerToken('wave')).toBe(':snap-sticker:wave:');
    expect(stickerToken('<script>')).toBeNull();
  });
});

describe('insertAtCursor', () => {
  it('inserts at the caret, replaces a selection, and reports the new value', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    try {
      area.value = 'hello world';
      area.setSelectionRange(5, 5);
      expect(insertAtCursor(area, ' :snap-sticker:wave:')).toBe('hello :snap-sticker:wave: world');
      expect(area.selectionStart).toBe(25);
      area.value = 'abcdef';
      area.setSelectionRange(1, 5); // replace "bcde"
      expect(insertAtCursor(area, 'X')).toBe('aXf');
    } finally {
      area.remove();
    }
  });
});

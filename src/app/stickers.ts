/**
 * Sticker-token helpers for forum posts and composer previews.
 *
 * Authors insert `:snap-sticker:<slug>:` tokens into their Markdown; the token
 * survives both the server-side phpBB parser and the client DOMPurify pass as
 * plain TEXT (the charset is inert). Rendering happens strictly AFTER the
 * sanitized bodyHtml has been inserted into the DOM: {@link
 * transformStickerTokens} walks the TEXT nodes, matches the token grammar and
 * replaces each match with a DOM-created `<img>` whose `src` is a CONSTRUCTED
 * same-origin sticker-body URL. No innerHTML is ever involved and the slug
 * charset is validated by construction, so a malicious "slug" can neither
 * escape into markup nor point the image off-origin — XSS-safe by design.
 *
 * The sticker assets are served by the platform user-bff
 * (`/bff/user/character/stickers/{slug}/body`); auth rides the same-origin
 * HttpOnly `bff_` cookie exactly like every other asset request.
 */

/** Server contract mirror: a sticker slug is 1..64 chars of [a-z0-9_-]. */
export const STICKER_SLUG_RE = /^[a-z0-9_-]{1,64}$/;

/** Abuse cap: at most this many stickers are rendered per post body. */
export const MAX_STICKERS_PER_POST = 8;

/** List cap: at most this many owned stickers are surfaced to the picker /
 *  editor grids. Rationale: the list endpoint is upstream-controlled — a
 *  runaway (or hostile) response of thousands of items would mint thousands
 *  of same-origin <img> thumbnails in one panel; 64 fills several scroll
 *  pages while keeping the DOM and request fan-out bounded. */
export const MAX_STICKER_LIST = 64;

/** Same-origin base for the user-bff character/sticker asset endpoints. */
export const STICKER_API_BASE = '/bff/user/character/stickers';

/**
 * Build the same-origin sticker-body URL for a slug.
 *
 * WIRED: `hugmesh-user-bff-api`'s `StickerController` now serves the sticker
 * pixels at exactly this route — `GET /bff/user/character/stickers/{slug}/body`
 * (see `StickerController.serveBody` / `StickerService.serveBody`). The `slug`
 * here IS the sticker row id the list endpoint returns as `slug`; the server
 * mirrors this file's {@link STICKER_SLUG_RE} (`[a-z0-9_-]{1,64}`) and returns a
 * uniform 404 for any miss (unknown / malformed slug, foreign PENDING, REJECTED,
 * no stored pixels). ACTIVE stickers serve to any reader in the sticker's domain
 * so an embedded sticker renders inside other users' posts; PENDING serves only
 * to its owner (composer preview). The URL contract below must stay byte-for-byte
 * identical to that route — see stickers.spec.ts for the pinned regression test.
 *
 * @param slug - The sticker slug (the sticker row id) to link.
 * @returns The `/bff/user/character/stickers/{slug}/body` path, or `null`
 *   when the slug fails the charset validation (never trust a caller).
 */
export function stickerBodyUrl(slug: string): string | null {
  return STICKER_SLUG_RE.test(slug) ? `${STICKER_API_BASE}/${slug}/body` : null;
}

/**
 * Build the composer token for a sticker slug.
 *
 * @param slug - The sticker slug to tokenize.
 * @returns `:snap-sticker:<slug>:`, or `null` for an invalid slug.
 */
export function stickerToken(slug: string): string | null {
  return STICKER_SLUG_RE.test(slug) ? `:snap-sticker:${slug}:` : null;
}

/**
 * Replace `:snap-sticker:<slug>:` tokens in `container`'s TEXT nodes with
 * DOM-created `<img class="forum-sticker">` elements.
 *
 * Must run AFTER the sanitized bodyHtml has been inserted (it operates on the
 * live DOM). Idempotent: already-rendered stickers count against the cap, so
 * re-running on the same container never exceeds {@link MAX_STICKERS_PER_POST}.
 * Tokens beyond the cap and malformed tokens are left as inert text.
 *
 * @param container - The element holding the sanitized post/preview HTML.
 * @param cap - Maximum stickers rendered in this container (default 8).
 * @returns The number of sticker images created by THIS call.
 */
export function transformStickerTokens(container: HTMLElement, cap: number = MAX_STICKERS_PER_POST): number {
  // Already-rendered stickers (from a previous pass) consume the budget first.
  let budget = cap - container.querySelectorAll('img.forum-sticker').length;
  if (budget <= 0) return 0;

  const doc = container.ownerDocument;
  // Snapshot the text nodes BEFORE mutating (the walker would be invalidated).
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    textNodes.push(n as Text);
  }

  let created = 0;
  for (const node of textNodes) {
    if (budget <= 0) break;
    const made = replaceTokensInTextNode(node, budget);
    created += made;
    budget -= made;
  }
  return created;
}

/**
 * Replace up to `budget` tokens inside one text node with `<img>` elements.
 *
 * @param node - The text node to scan.
 * @param budget - Remaining sticker budget for the container.
 * @returns How many images were created for this node.
 */
function replaceTokensInTextNode(node: Text, budget: number): number {
  const text = node.data;
  // Fresh regex per node: a shared global regex would leak lastIndex state.
  const re = /:snap-sticker:([a-z0-9_-]{1,64}):/g;
  const doc = node.ownerDocument;
  const frag = doc.createDocumentFragment();
  let last = 0;
  let created = 0;
  for (let m = re.exec(text); m !== null && created < budget; m = re.exec(text)) {
    const slug = m[1];
    // The capture group already enforces the charset; the URL builder re-checks
    // (defence-in-depth) — a null here would mean the regexes diverged.
    const src = stickerBodyUrl(slug);
    if (!src) continue;
    if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
    const img = doc.createElement('img');
    img.className = 'forum-sticker';
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    img.alt = `sticker ${slug}`;
    img.src = src;
    frag.appendChild(img);
    last = m.index + m[0].length;
    created += 1;
  }
  if (created === 0) return 0;
  if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
  node.replaceWith(frag);
  return created;
}

/**
 * Insert `text` at the caret position of a textarea (replacing any selection)
 * and restore focus with the caret placed after the insertion.
 *
 * @param area - The composer textarea.
 * @param text - The text (e.g. a sticker token) to insert.
 * @returns The textarea's new full value, for syncing back into a signal.
 */
export function insertAtCursor(area: HTMLTextAreaElement, text: string): string {
  const start = area.selectionStart ?? area.value.length;
  const end = area.selectionEnd ?? start;
  const next = area.value.slice(0, start) + text + area.value.slice(end);
  area.value = next;
  const caret = start + text.length;
  area.setSelectionRange(caret, caret);
  area.focus();
  return next;
}

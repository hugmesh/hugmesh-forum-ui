import { Injectable } from '@angular/core';

import { MAX_STICKER_LIST, STICKER_API_BASE, STICKER_SLUG_RE } from './stickers';

/** A sticker the caller owns, normalized for the picker/editor UIs. */
export interface StickerMeta {
  slug: string;
  label: string;
}

/** Indirected so unit tests can stub the network without touching native fetch
 *  (the same pattern as forumAnnouncementsFetcher). */
export const stickerFetcher = {
  fetch(): Promise<Response> {
    // credentials:'include' sends the HttpOnly bff_ session cookie — the
    // fe-gateway swaps it into a server-side Bearer for the user-bff.
    return fetch(STICKER_API_BASE, { credentials: 'include', headers: { Accept: 'application/json' } });
  },
};

/**
 * Lists the caller's own character stickers from the platform user-bff
 * (GET /bff/user/character/stickers). FAIL-SOFT + feature-detecting: any
 * non-200 or network error resolves `null`, which the sticker UIs treat as
 * "endpoint unavailable — hide the sticker surface entirely". The result is
 * memoized for the session (one probe per page load).
 */
@Injectable({ providedIn: 'root' })
export class StickerService {
  private listPromise: Promise<readonly StickerMeta[] | null> | null = null;

  /**
   * The caller's own stickers, memoized per session.
   *
   * @returns The normalized sticker list, or `null` when the endpoint is
   *   unavailable (feature-detect: hide the sticker UI).
   */
  listOwn(): Promise<readonly StickerMeta[] | null> {
    this.listPromise ??= this.load();
    return this.listPromise;
  }

  /**
   * Probe + normalize the sticker list. Accepts either a bare JSON array or
   * a `{stickers:[...]}` wrapper; items may be slug strings or objects with a
   * `slug` (+ optional `name`/`label`). Entries whose slug fails the charset
   * validation are dropped — only allowlisted slugs ever reach a URL.
   *
   * @returns The normalized list, or `null` on any error / unexpected shape.
   */
  private async load(): Promise<readonly StickerMeta[] | null> {
    try {
      const r = await stickerFetcher.fetch();
      if (!r.ok) return null;
      const json: unknown = await r.json();
      const items = Array.isArray(json)
        ? json
        : json && typeof json === 'object' && Array.isArray((json as { stickers?: unknown }).stickers)
          ? ((json as { stickers: unknown[] }).stickers)
          : null;
      if (!items) return null;
      const out: StickerMeta[] = [];
      for (const item of items) {
        // Render cap (MAX_STICKER_LIST): never surface more than 64 stickers
        // to the picker/editor grids, however large the wire list is.
        if (out.length >= MAX_STICKER_LIST) break;
        const slug = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as Record<string, unknown>)['slug'] : null;
        if (typeof slug !== 'string' || !STICKER_SLUG_RE.test(slug)) continue;
        const meta = (item ?? {}) as Record<string, unknown>;
        const label = typeof meta['name'] === 'string' ? meta['name'] : typeof meta['label'] === 'string' ? meta['label'] : slug;
        out.push({ slug, label: label as string });
      }
      return out;
    } catch {
      return null;
    }
  }
}

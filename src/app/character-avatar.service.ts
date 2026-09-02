import { Injectable } from '@angular/core';

import { CHARACTER_AVATAR_HANDLE_PATH, characterAvatarBodyUrl } from './character-avatar';

/** Indirected so unit tests can stub the network without touching native fetch
 *  (the same pattern as `stickerFetcher` / `forumAnnouncementsFetcher`). */
export const characterAvatarFetcher = {
  fetch(): Promise<Response> {
    // credentials:'include' sends the HttpOnly bff_ session cookie — the
    // fe-gateway swaps it into a server-side Bearer for the user-bff.
    return fetch(CHARACTER_AVATAR_HANDLE_PATH, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  },
};

/**
 * Resolves the CALLER's own VN character-avatar image URL from the platform
 * user-bff (`GET /bff/user/character/avatar`).
 *
 * FAIL-SOFT + feature-detecting, exactly like {@link StickerService}: a 404
 * (I have no stored profile picture), a route that is not deployed, an
 * unexpected body shape or a network error all resolve `null`, which the VN
 * editor treats as "hide the use-my-avatar option". The result is memoized for
 * the session (one probe per page load).
 *
 * The returned URL is CONSTRUCTED from the charset-validated handle, not copied
 * from the response's own `url` field: the value goes into a stored
 * `characterImgRef` and then into an `<img src>` in other users' browsers, so a
 * compromised upstream must not be able to choose that string.
 */
@Injectable({ providedIn: 'root' })
export class CharacterAvatarService {
  private urlPromise: Promise<string | null> | null = null;

  /**
   * The caller's own character-avatar image URL, memoized per session.
   *
   * @returns The `/bff/user/character/avatar/{ref}/body` path, or `null` when
   *   the caller has no avatar / the endpoint is unavailable.
   */
  myImageUrl(): Promise<string | null> {
    this.urlPromise ??= this.load();
    return this.urlPromise;
  }

  /**
   * Probe the handle endpoint and rebuild the body URL from its handle.
   *
   * @returns The constructed body URL, or `null` on any non-200 / bad shape /
   *   error.
   */
  private async load(): Promise<string | null> {
    try {
      const r = await characterAvatarFetcher.fetch();
      if (!r.ok) return null;
      const json: unknown = await r.json();
      const ref = json && typeof json === 'object' ? (json as Record<string, unknown>)['ref'] : null;
      return typeof ref === 'string' ? characterAvatarBodyUrl(ref) : null;
    } catch {
      return null;
    }
  }
}

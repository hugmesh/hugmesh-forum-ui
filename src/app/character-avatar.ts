/**
 * VN character-avatar URL contract — the client mirror of
 * `hugmesh-user-bff-api`'s `CharacterAvatarController`.
 *
 * A VN profile's `characterImgRef` is rendered as an `<img src>` inside OTHER
 * users' posts, so it has to name WHOSE avatar. The platform user-bff mints an
 * opaque, stable handle per avatar slot and serves the pixels at
 * `GET /bff/user/character/avatar/{ref}/body`; `GET /bff/user/character/avatar`
 * (JSON) hands the CALLER their own handle. This module owns both spellings and
 * the handle charset, so the whole UI has exactly one copy of the contract.
 *
 * Nothing here trusts a wire value: a body URL is always CONSTRUCTED from a
 * charset-validated handle, never taken verbatim from a response — the same
 * discipline `stickers.ts` applies to sticker slugs.
 */

/**
 * The handle endpoint. Returns JSON (`{ref, url}`), never image bytes — this
 * is also the LEGACY literal the pre-fix VN editor stored as a
 * `characterImgRef`, which is why {@link isLegacyCharacterAvatarRef} exists.
 */
export const CHARACTER_AVATAR_HANDLE_PATH = '/bff/user/character/avatar';

/** Server contract mirror: a serve handle is a lowercase-hex UUID (36 chars). */
export const CHARACTER_AVATAR_REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A body URL is the handle path + a handle + `/body`. Pinned so a reader can
 *  recognise an avatar sprite ref without re-deriving the route. */
export const CHARACTER_AVATAR_BODY_RE =
  /^\/bff\/user\/character\/avatar\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/body$/;

/**
 * Build the same-origin body URL for a serve handle.
 *
 * WIRED: `hugmesh-user-bff-api` serves the avatar pixels at exactly this route
 * (`CharacterAvatarController.serveBody`). The bytes are readable by the owner
 * and by any reader in the same brand — that is what makes the sprite render
 * inside other people's posts — and every miss is a uniform 404. Keep this
 * spelling byte-for-byte identical to the server route; `character-avatar.spec.ts`
 * pins it.
 *
 * @param ref - The opaque serve handle.
 * @returns The `/bff/user/character/avatar/{ref}/body` path, or `null` when the
 *   handle fails the charset validation (never trust a caller).
 */
export function characterAvatarBodyUrl(ref: string): string | null {
  return typeof ref === 'string' && CHARACTER_AVATAR_REF_RE.test(ref)
    ? `${CHARACTER_AVATAR_HANDLE_PATH}/${ref}/body`
    : null;
}

/**
 * Whether `ref` is a well-formed character-avatar BODY url (an image route).
 *
 * @param ref - The candidate characterImgRef.
 * @returns `true` only for the pinned body-route shape.
 */
export function isCharacterAvatarBodyUrl(ref: string | null | undefined): boolean {
  return typeof ref === 'string' && CHARACTER_AVATAR_BODY_RE.test(ref);
}

/**
 * Whether `ref` is the LEGACY pre-fix avatar ref — the bare handle path a VN
 * profile saved before this route existed.
 *
 * It must never reach an `<img src>`: that path now resolves, but to JSON, so
 * rendering it produces a broken image for every reader of the post. It is also
 * unresolvable BY DESIGN for a reader — it names no owner — so the only correct
 * handling is to ignore it on the read side and rewrite it on the next save.
 *
 * Narrower than {@link isOwnerBlindImgRef} on purpose: this one means "the owner
 * meant to use their avatar", which is what the EDITOR re-ticks from. Use
 * {@link isOwnerBlindImgRef} for the render decision.
 *
 * @param ref - The candidate characterImgRef.
 * @returns `true` for exactly the legacy literal.
 */
export function isLegacyCharacterAvatarRef(ref: string | null | undefined): boolean {
  return ref === CHARACTER_AVATAR_HANDLE_PATH;
}

/**
 * The owner-scoped SELF avatar serve in hugmesh-user-bff-api
 * (`ProfileController`). It resolves its owner from `jwt.getSubject()`, so it
 * always returns the CALLER's own picture.
 */
export const SELF_AVATAR_BODY_PATH = '/bff/user/profile/avatar/body';

/**
 * The `/bff/user/**` spellings that resolve their owner from the CALLER rather
 * than from the path. Client mirror of hugmesh-forum-bff-api's
 * `VnProfileDto.OWNER_BLIND_IMG_REFS` — keep the two in step.
 */
export const OWNER_BLIND_IMG_REFS: readonly string[] = [
  CHARACTER_AVATAR_HANDLE_PATH,
  SELF_AVATAR_BODY_PATH,
];

/**
 * Whether `ref` is OWNER-BLIND: a same-origin path whose owner comes from
 * whoever fetches it, so it can never name the post's AUTHOR.
 *
 * A sprite is rendered next to another user's name, which makes the two cases
 * different kinds of wrong:
 * - the handle path is a JSON endpoint, so it is a broken image (issue #3);
 * - the self-avatar serve returns a 200 IMAGE — the READER's own picture,
 *   painted onto every post that stores it. That is worse than broken: it
 *   misattributes a face to an author.
 *
 * The server clears these on write and suppresses them on the reader-facing
 * lookup; this is the client's own guard, the same defence-in-depth
 * `isSafeCharacterImgRef` applies to the origin allowlist. Trailing slashes are
 * trimmed before comparing so the one-character variants cannot slip past.
 *
 * @param ref - The candidate characterImgRef.
 * @returns `true` when the ref must not be rendered as this author's sprite.
 */
export function isOwnerBlindImgRef(ref: string | null | undefined): boolean {
  if (typeof ref !== 'string') return false;
  return OWNER_BLIND_IMG_REFS.includes(ref.replace(/\/+$/, ''));
}

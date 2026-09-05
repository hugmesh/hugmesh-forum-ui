import {
  CHARACTER_AVATAR_HANDLE_PATH,
  OWNER_BLIND_IMG_REFS,
  SELF_AVATAR_BODY_PATH,
  characterAvatarBodyUrl,
  isCharacterAvatarBodyUrl,
  isLegacyCharacterAvatarRef,
  isOwnerBlindImgRef,
  wirePath,
} from './character-avatar';
import { isSafeCharacterImgRef, VN_CHARACTER_IMG_MAX_LENGTH } from './vn-profile.service';

describe('characterAvatarBodyUrl', () => {
  const REF = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  // CROSS-REPO CONTRACT REGRESSION — this is the assertion that fails when the
  // serving route is absent or re-spelled. hugmesh-user-bff-api's
  // CharacterAvatarController serves the avatar pixels at
  //   GET /bff/user/character/avatar/{ref}/body
  // where {ref} is the opaque handle (a lowercase-hex UUID) that
  //   GET /bff/user/character/avatar
  // hands its owner. Before that controller existed the VN editor stored the
  // bare handle path as a characterImgRef and nothing served it, so every
  // avatar sprite rendered broken (hugmesh-forum-bff-api issue #3). Keep this
  // builder byte-for-byte identical to the server route.
  it('matches the real user-bff serve route for a backend handle', () => {
    expect(characterAvatarBodyUrl(REF)).toBe(`/bff/user/character/avatar/${REF}/body`);
  });

  it('rejects anything that is not a lowercase-hex UUID handle', () => {
    expect(characterAvatarBodyUrl('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBeNull();
    expect(characterAvatarBodyUrl('../../etc/passwd')).toBeNull();
    expect(characterAvatarBodyUrl('')).toBeNull();
    expect(characterAvatarBodyUrl('not-a-uuid')).toBeNull();
  });

  // The built URL is STORED as a forum VN profile characterImgRef, so it has to
  // survive both the forum-bff allowlist and this UI's own <img src> guard.
  it('produces a value the characterImgRef allowlist accepts', () => {
    const url = characterAvatarBodyUrl(REF)!;
    expect(isSafeCharacterImgRef(url)).toBeTrue();
    expect(url.startsWith('/bff/user/')).toBeTrue();
    expect(url.length).toBeLessThanOrEqual(VN_CHARACTER_IMG_MAX_LENGTH);
    // The forum-bff server allowlist charset is [A-Za-z0-9._/-] with no '..'.
    expect(/^\/bff\/user\/[A-Za-z0-9._/-]{1,246}$/.test(url)).toBeTrue();
    expect(url.includes('..')).toBeFalse();
  });

  it('recognises its own body URLs and nothing else', () => {
    expect(isCharacterAvatarBodyUrl(characterAvatarBodyUrl(REF))).toBeTrue();
    expect(isCharacterAvatarBodyUrl(CHARACTER_AVATAR_HANDLE_PATH)).toBeFalse();
    expect(isCharacterAvatarBodyUrl(`/bff/user/character/avatar/${REF}`)).toBeFalse();
    expect(isCharacterAvatarBodyUrl('/bff/user/character/stickers/wave/body')).toBeFalse();
    expect(isCharacterAvatarBodyUrl(null)).toBeFalse();
  });

  it('identifies the LEGACY bare handle path stored before the route existed', () => {
    expect(isLegacyCharacterAvatarRef('/bff/user/character/avatar')).toBeTrue();
    expect(isLegacyCharacterAvatarRef(CHARACTER_AVATAR_HANDLE_PATH)).toBeTrue();
    expect(isLegacyCharacterAvatarRef(characterAvatarBodyUrl(REF))).toBeFalse();
    expect(isLegacyCharacterAvatarRef(null)).toBeFalse();
    // …in EVERY spelling of it. The editor re-ticks "use my avatar" from this
    // predicate, and the server deliberately keeps storing the literal for that
    // purpose, so a raw-string compare would silently drop the repair signal for a
    // row spelled with a trailing slash or a dot segment.
    expect(isLegacyCharacterAvatarRef('/bff/user/character/./avatar')).toBeTrue();
    expect(isLegacyCharacterAvatarRef(`${CHARACTER_AVATAR_HANDLE_PATH}/`)).toBeTrue();
  });
});

describe('isOwnerBlindImgRef', () => {
  const REF = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  // Client mirror of hugmesh-forum-bff-api VnProfileDto.OWNER_BLIND_IMG_REFS.
  it('declares exactly the two subject-implicit /bff/user routes', () => {
    expect(OWNER_BLIND_IMG_REFS).toEqual([CHARACTER_AVATAR_HANDLE_PATH, SELF_AVATAR_BODY_PATH]);
    expect(SELF_AVATAR_BODY_PATH).toBe('/bff/user/profile/avatar/body');
  });

  // BOTH are same-origin and pass the <img src> origin allowlist, so that guard
  // cannot see this defect — which is the whole reason this predicate exists.
  it('catches refs the origin allowlist happily admits', () => {
    for (const ref of OWNER_BLIND_IMG_REFS) {
      expect(isSafeCharacterImgRef(ref)).toBeTrue();
      expect(isOwnerBlindImgRef(ref)).toBeTrue();
    }
  });

  it('trims trailing slashes before deciding', () => {
    expect(isOwnerBlindImgRef(`${CHARACTER_AVATAR_HANDLE_PATH}/`)).toBeTrue();
    expect(isOwnerBlindImgRef(`${SELF_AVATAR_BODY_PATH}//`)).toBeTrue();
  });

  // THE BYPASS (round-2 refutation, HIGH). A membership test compares STRINGS; the
  // browser compares PARSED paths. Measured in Chromium against a wire-logging
  // server: <img src="/bff/user/profile/avatar/./body"> requests
  // /bff/user/profile/avatar/body, and is de-duplicated against an <img> spelled
  // with the plain path — i.e. the two URLs are identical after parsing. So a
  // raw-string guard renders the READER's own face beside the AUTHOR's name, with a
  // real 200, no broken-image glyph and no (error) event to notice.
  it('sees through every spelling a URL parser rewrites', () => {
    expect(isOwnerBlindImgRef('/bff/user/profile/avatar/./body')).toBeTrue();
    expect(isOwnerBlindImgRef('/bff/user/character/./avatar')).toBeTrue();
    expect(isOwnerBlindImgRef('/bff/user//profile/avatar/body')).toBeTrue();
    expect(isOwnerBlindImgRef('/bff/user/profile/avatar/body/.')).toBeTrue();
    expect(isOwnerBlindImgRef('/bff/user/character/../profile/avatar/body')).toBeTrue();
    expect(isOwnerBlindImgRef('/bff/user/profile/avatar/body?v=2')).toBeTrue();
  });

  // Surgical: a rule one segment too wide would blank every real avatar sprite
  // on the platform and look exactly like the bug it was written to fix.
  it('never touches a real serve URL', () => {
    expect(isOwnerBlindImgRef(characterAvatarBodyUrl(REF))).toBeFalse();
    expect(isOwnerBlindImgRef('/bff/user/character/stickers/wave/body')).toBeFalse();
    expect(isOwnerBlindImgRef(null)).toBeFalse();
    expect(isOwnerBlindImgRef(undefined)).toBeFalse();
  });

  // …and a dot INSIDE a segment is an ordinary character no parser rewrites, so a
  // filename-shaped ref must keep rendering. This is the assertion that fails if the
  // dot-segment rule is ever written as "reject any '.'".
  it('leaves a dot inside a segment alone', () => {
    expect(isOwnerBlindImgRef('/bff/user/character/portrait.v2.png')).toBeFalse();
    expect(isSafeCharacterImgRef('/bff/user/character/portrait.v2.png')).toBeTrue();
    expect(isSafeCharacterImgRef('/bff/user/character/.hidden/body')).toBeTrue();
  });

  // The origin allowlist is the OTHER half of the same fix: the spellings above are
  // now refused outright, so a compromised upstream cannot even hand one to the DOM.
  it('is backed by an origin allowlist that refuses the same spellings', () => {
    for (const smuggled of [
      '/bff/user/profile/avatar/./body',
      '/bff/user/character/./avatar',
      '/bff/user//profile/avatar/body',
      '/bff/user/profile/avatar/body/.',
      '/bff/user/character/../profile/avatar/body',
    ]) {
      expect(isSafeCharacterImgRef(smuggled)).withContext(smuggled).toBeFalse();
    }
  });
});

describe('wirePath', () => {
  const SELF = '/bff/user/profile/avatar/body';

  it('collapses every spelling a browser rewrites', () => {
    expect(wirePath('/bff/user/profile/avatar/./body')).toBe(SELF);
    expect(wirePath('/bff/user//profile/avatar/body')).toBe(SELF);
    expect(wirePath(`${SELF}/`)).toBe(SELF);
    expect(wirePath('/bff/user/character/../profile/avatar/body')).toBe(SELF);
    expect(wirePath(`${SELF}?v=2#x`)).toBe(SELF);
  });

  it('leaves a canonical path exactly as it is', () => {
    const real = characterAvatarBodyUrl('3f2504e0-4f89-41d3-9a0c-0305e82c3301')!;
    expect(wirePath(real)).toBe(real);
    expect(wirePath('/bff/user/character/portrait.v2.png')).toBe('/bff/user/character/portrait.v2.png');
  });
});

import {
  CHARACTER_AVATAR_HANDLE_PATH,
  characterAvatarBodyUrl,
  isCharacterAvatarBodyUrl,
  isLegacyCharacterAvatarRef,
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
  });
});

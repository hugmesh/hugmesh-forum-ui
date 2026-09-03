import { TestBed } from '@angular/core/testing';

import { CharacterAvatarService, characterAvatarFetcher } from './character-avatar.service';
import { CHARACTER_AVATAR_HANDLE_PATH } from './character-avatar';

const REF = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const BODY_URL = `/bff/user/character/avatar/${REF}/body`;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('CharacterAvatarService', () => {
  let service: CharacterAvatarService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CharacterAvatarService);
  });

  it('probes the handle endpoint with the session cookie', async () => {
    const spy = spyOn(characterAvatarFetcher, 'fetch').and.resolveTo(jsonResponse({ ref: REF, url: BODY_URL }));
    await service.myImageUrl();
    expect(spy).toHaveBeenCalled();
    expect(CHARACTER_AVATAR_HANDLE_PATH).toBe('/bff/user/character/avatar');
  });

  it('builds the image URL from the handle', async () => {
    spyOn(characterAvatarFetcher, 'fetch').and.resolveTo(jsonResponse({ ref: REF, url: BODY_URL }));
    expect(await service.myImageUrl()).toBe(BODY_URL);
  });

  // Never trust a wire-supplied URL into an <img src> / a stored characterImgRef:
  // the value is REBUILT from the validated handle, so a hostile `url` field is
  // ignored entirely.
  it('ignores the server-sent url field and rebuilds from the handle', async () => {
    spyOn(characterAvatarFetcher, 'fetch').and.resolveTo(
      jsonResponse({ ref: REF, url: 'https://evil.example/steal.png' }),
    );
    expect(await service.myImageUrl()).toBe(BODY_URL);
  });

  // FEATURE-DETECT / ROUTE-ABSENCE: a 404 is both "I have no picture" and "this
  // BFF has no such route". Either way the editor must not offer the option,
  // because ticking it could only store a ref that never resolves.
  it('resolves null on 404 (no picture, or route not deployed)', async () => {
    spyOn(characterAvatarFetcher, 'fetch').and.resolveTo(jsonResponse({}, false, 404));
    expect(await service.myImageUrl()).toBeNull();
  });

  it('resolves null for a malformed handle', async () => {
    spyOn(characterAvatarFetcher, 'fetch').and.resolveTo(jsonResponse({ ref: '../../etc/passwd' }));
    expect(await service.myImageUrl()).toBeNull();
  });

  it('resolves null for an unexpected body shape', async () => {
    spyOn(characterAvatarFetcher, 'fetch').and.resolveTo(jsonResponse('nope'));
    expect(await service.myImageUrl()).toBeNull();
  });

  it('resolves null on a network error (fail-soft)', async () => {
    spyOn(characterAvatarFetcher, 'fetch').and.rejectWith(new Error('offline'));
    expect(await service.myImageUrl()).toBeNull();
  });

  it('memoizes one probe per session', async () => {
    const spy = spyOn(characterAvatarFetcher, 'fetch').and.resolveTo(jsonResponse({ ref: REF }));
    await Promise.all([service.myImageUrl(), service.myImageUrl()]);
    await service.myImageUrl();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

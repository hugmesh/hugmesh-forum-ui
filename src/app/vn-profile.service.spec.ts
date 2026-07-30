import { TestBed } from '@angular/core/testing';

import { FORUM_BASE_URL } from './forum.service';
import {
  VnProfile,
  VnProfileService,
  applyVoicebox,
  isSafeCharacterImgRef,
  normalizeVnProfile,
  vnProfileFetcher,
} from './vn-profile.service';

/** Build a Response-shaped stub without hitting the network. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function wireProfile(over: Partial<VnProfile> = {}): Record<string, unknown> {
  return {
    stickerSlug: 'wave',
    characterImgRef: '/bff/user/character/avatar',
    voiceboxStyle: 'glass',
    voiceboxAccent: '#ff00aa',
    voiceStyle: 'deep',
    ...over,
  };
}

describe('VnProfileService', () => {
  let service: VnProfileService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [VnProfileService, { provide: FORUM_BASE_URL, useValue: '' }],
    });
    service = TestBed.inject(VnProfileService);
    fetchSpy = spyOn(vnProfileFetcher, 'fetch');
  });

  // ── lookup: coalescing + cache + fail-soft ─────────────────────────────────

  it('coalesces concurrent lookups into ONE POST with the union of subjects', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ profiles: { a: wireProfile(), b: wireProfile({ voiceboxStyle: 'neon' }) } }));
    const [r1, r2] = await Promise.all([service.lookup(['a']), service.lookup(['b', 'a'])]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/forum/vn-profiles/lookup');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ subjects: ['a', 'b'] });
    expect(r1['a'].voiceboxStyle).toBe('glass');
    expect(r2['b'].voiceboxStyle).toBe('neon');
    expect(r2['a'].voiceboxStyle).toBe('glass');
  });

  it('dedupes repeated subjects within one call (a topic page asks once per author)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ profiles: { a: wireProfile() } }));
    await service.lookup(['a', 'a', 'a', '']);
    const [, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ subjects: ['a'] });
  });

  it('serves later lookups from the in-memory cache (no second POST)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ profiles: { a: wireProfile() } }));
    await service.lookup(['a']);
    const again = await service.lookup(['a']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(again['a'].stickerSlug).toBe('wave');
  });

  it('caches misses as null: a subject with no row is never re-asked this session', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ profiles: {} }));
    const first = await service.lookup(['ghost']);
    expect(first).toEqual({});
    await service.lookup(['ghost']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fail-soft on network error: resolves empty AND does not poison the cache (retries later)', async () => {
    fetchSpy.and.rejectWith(new Error('offline'));
    const first = await service.lookup(['a']);
    expect(first).toEqual({});
    // Second page load retries (the error was not cached as a miss)…
    fetchSpy.and.resolveTo(jsonResponse({ profiles: { a: wireProfile() } }));
    const second = await service.lookup(['a']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second['a'].voiceboxStyle).toBe('glass');
  });

  it('fail-soft on a non-200: resolves empty without caching', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'nope' }, 503));
    expect(await service.lookup(['a'])).toEqual({});
    fetchSpy.and.resolveTo(jsonResponse({ profiles: {} }));
    await service.lookup(['a']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('chunks lookups above the 50-subject contract cap into multiple POSTs', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ profiles: {} }));
    const subjects = Array.from({ length: 60 }, (_, i) => `s${i}`);
    await service.lookup(subjects);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchSpy.calls.argsFor(0)[1].body as string) as { subjects: string[] };
    const second = JSON.parse(fetchSpy.calls.argsFor(1)[1].body as string) as { subjects: string[] };
    expect(first.subjects.length).toBe(50);
    expect(second.subjects.length).toBe(10);
  });

  it('re-validates every wire field: hostile values degrade to safe defaults', async () => {
    fetchSpy.and.resolveTo(
      jsonResponse({
        profiles: {
          a: {
            stickerSlug: '../../etc/passwd',
            characterImgRef: 'https://evil.example/x.png',
            voiceboxStyle: 'sparkle',
            voiceboxAccent: 'url(javascript:alert(1))',
            voiceStyle: 'scream',
          },
        },
      }),
    );
    const out = await service.lookup(['a']);
    expect(out['a']).toEqual({
      subject: 'a',
      stickerSlug: null,
      characterImgRef: null,
      voiceboxStyle: 'classic',
      voiceboxAccent: null,
      voiceStyle: null,
    });
  });

  // ── getMe / saveMe ─────────────────────────────────────────────────────────

  it('getMe GETs /bff/forum/vn-profiles/me and normalizes the profile', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ subject: 'google:me@x', ...wireProfile() }));
    const me = await service.getMe();
    expect(fetchSpy.calls.mostRecent().args[0]).toBe('/bff/forum/vn-profiles/me');
    expect(me!.subject).toBe('google:me@x');
    expect(me!.voiceboxStyle).toBe('glass');
  });

  it('getMe is fail-soft: null on error / non-200', async () => {
    fetchSpy.and.resolveTo(jsonResponse({}, 500));
    expect(await service.getMe()).toBeNull();
    fetchSpy.and.rejectWith(new Error('offline'));
    expect(await service.getMe()).toBeNull();
  });

  it('saveMe PUTs the profile (subject NEVER in the body) and refreshes the cache', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ subject: 'google:me@x', ...wireProfile() }));
    const saved = await service.saveMe({
      stickerSlug: 'wave',
      characterImgRef: '/bff/user/character/avatar',
      voiceboxStyle: 'glass',
      voiceboxAccent: '#ff00aa',
      voiceStyle: 'deep',
    });
    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toBe('/bff/forum/vn-profiles/me');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)['subject']).toBeUndefined();
    expect(saved.subject).toBe('google:me@x');
    // The author's own posts restyle without another lookup POST.
    const cached = await service.lookup(['google:me@x']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cached['google:me@x'].voiceboxAccent).toBe('#ff00aa');
  });

  it('saveMe mirrors server validation client-side (bad accent/skin/slug/ref rejected pre-network)', async () => {
    await expectAsync(service.saveMe({ voiceboxStyle: 'glass', voiceboxAccent: '#FF00AA' })).toBeRejected(); // uppercase
    await expectAsync(service.saveMe({ voiceboxStyle: 'sparkle' as never })).toBeRejected();
    await expectAsync(service.saveMe({ voiceboxStyle: 'glass', stickerSlug: 'Bad Slug!' })).toBeRejected();
    await expectAsync(service.saveMe({ voiceboxStyle: 'glass', characterImgRef: 'https://evil.example/a' })).toBeRejected();
    await expectAsync(service.saveMe({ voiceboxStyle: 'glass', voiceStyle: 'scream' as never })).toBeRejected();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saveMe throws on a server rejection (the editor surfaces it)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'bad' }, 400));
    await expectAsync(service.saveMe({ voiceboxStyle: 'glass' })).toBeRejected();
  });
});

// ── pure helpers ─────────────────────────────────────────────────────────────

describe('applyVoicebox', () => {
  function el(): HTMLElement {
    return document.createElement('article');
  }

  it('sets the allowlisted skin attribute and the validated accent var', () => {
    const a = el();
    applyVoicebox(a, 'neon', '#00ff99');
    expect(a.getAttribute('data-vnskin')).toBe('neon');
    expect(a.style.getPropertyValue('--forum-vnbox-accent')).toBe('#00ff99');
  });

  it('rejects a non-allowlisted skin (no data-vnskin attribute)', () => {
    const a = el();
    applyVoicebox(a, 'sparkle" onmouseover="alert(1)', '#00ff99');
    expect(a.hasAttribute('data-vnskin')).toBeFalse();
  });

  it('rejects bad hex before setProperty (uppercase, shorthand, names, css payloads)', () => {
    for (const bad of ['#FF00AA', '#fff', 'red', '#12345', '#1234567', 'url(x)', 'var(--x)', '#ff00aa;background:red']) {
      const a = el();
      applyVoicebox(a, 'glass', bad);
      expect(a.style.getPropertyValue('--forum-vnbox-accent')).withContext(bad).toBe('');
    }
  });

  it('clears a previously applied skin/accent when the profile goes away', () => {
    const a = el();
    applyVoicebox(a, 'retro', '#ff00aa');
    applyVoicebox(a, null, null);
    expect(a.hasAttribute('data-vnskin')).toBeFalse();
    expect(a.style.getPropertyValue('--forum-vnbox-accent')).toBe('');
  });
});

describe('isSafeCharacterImgRef', () => {
  it('accepts only same-origin /bff/user/ paths', () => {
    expect(isSafeCharacterImgRef('/bff/user/character/avatar')).toBeTrue();
    expect(isSafeCharacterImgRef('/bff/user/character/stickers/wave/body')).toBeTrue();
  });

  it('rejects off-origin, traversal, oversize and attribute-breaking values', () => {
    expect(isSafeCharacterImgRef('https://evil.example/a.png')).toBeFalse();
    expect(isSafeCharacterImgRef('//evil.example/a.png')).toBeFalse();
    expect(isSafeCharacterImgRef('/bff/admin/secret.png')).toBeFalse();
    expect(isSafeCharacterImgRef('/bff/user/../admin/x')).toBeFalse();
    expect(isSafeCharacterImgRef('/bff/user/a"onerror="alert(1)')).toBeFalse();
    expect(isSafeCharacterImgRef('/bff/user/' + 'a'.repeat(300))).toBeFalse();
  });
});

describe('normalizeVnProfile', () => {
  it('returns null for a non-object and defaults every invalid field', () => {
    expect(normalizeVnProfile('s', undefined)).toBeNull();
    expect(normalizeVnProfile('s', 'nope')).toBeNull();
    const p = normalizeVnProfile('s', { voiceboxStyle: 'paper' })!;
    expect(p).toEqual({
      subject: 's',
      stickerSlug: null,
      characterImgRef: null,
      voiceboxStyle: 'paper',
      voiceboxAccent: null,
      voiceStyle: null,
    });
  });
});

import { TestBed } from '@angular/core/testing';

import { StickerService, stickerFetcher } from './sticker.service';
import { MAX_STICKER_LIST } from './stickers';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('StickerService', () => {
  let service: StickerService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [StickerService] });
    service = TestBed.inject(StickerService);
    fetchSpy = spyOn(stickerFetcher, 'fetch');
  });

  it('normalizes object entries and drops invalid slugs (only allowlisted slugs reach URLs)', async () => {
    fetchSpy.and.resolveTo(
      jsonResponse([
        { slug: 'wave', name: 'Wave' },
        { slug: 'BAD SLUG' },
        { slug: '../../etc' },
        { noslug: true },
        { slug: 'grin' },
      ]),
    );
    expect(await service.listOwn()).toEqual([
      { slug: 'wave', label: 'Wave' },
      { slug: 'grin', label: 'grin' },
    ]);
  });

  it('accepts a bare array of slug strings', async () => {
    fetchSpy.and.resolveTo(jsonResponse(['wave', 'INVALID']));
    expect(await service.listOwn()).toEqual([{ slug: 'wave', label: 'wave' }]);
  });

  it('accepts a {stickers:[...]} wrapper', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ stickers: [{ slug: 'wave' }] }));
    expect(await service.listOwn()).toEqual([{ slug: 'wave', label: 'wave' }]);
  });

  it('feature-detects: null on a non-200 (sticker UI hides entirely)', async () => {
    fetchSpy.and.resolveTo(jsonResponse({ error: 'not deployed' }, 404));
    expect(await service.listOwn()).toBeNull();
  });

  it('feature-detects: null on a network error', async () => {
    fetchSpy.and.rejectWith(new Error('offline'));
    expect(await service.listOwn()).toBeNull();
  });

  it('memoizes the probe: one fetch per session however many surfaces ask', async () => {
    fetchSpy.and.resolveTo(jsonResponse(['wave']));
    await service.listOwn();
    await service.listOwn();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it(`caps the surfaced list at ${MAX_STICKER_LIST} however large the wire response is`, async () => {
    fetchSpy.and.resolveTo(jsonResponse(Array.from({ length: 500 }, (_, i) => `s${i}`)));
    const list = (await service.listOwn())!;
    expect(list.length).toBe(MAX_STICKER_LIST);
    expect(list[0]).toEqual({ slug: 's0', label: 's0' });
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StickerPickerComponent } from './sticker-picker.component';
import { StickerMeta, StickerService } from './sticker.service';

describe('StickerPickerComponent', () => {
  let fixture: ComponentFixture<StickerPickerComponent>;
  let stickers: jasmine.SpyObj<StickerService>;

  beforeEach(async () => {
    stickers = jasmine.createSpyObj<StickerService>('StickerService', ['listOwn']);
    await TestBed.configureTestingModule({
      imports: [StickerPickerComponent],
      providers: [{ provide: StickerService, useValue: stickers }],
    }).compileComponents();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  async function render(list: readonly StickerMeta[] | null) {
    stickers.listOwn.and.resolveTo(list);
    fixture = TestBed.createComponent(StickerPickerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('hides ENTIRELY when the sticker endpoint is unavailable (feature-detect)', async () => {
    await render(null);
    expect(el().querySelector('[data-testid="sticker-toggle"]')).toBeNull();
  });

  it('hides when the caller owns no stickers', async () => {
    await render([]);
    expect(el().querySelector('[data-testid="sticker-toggle"]')).toBeNull();
  });

  it('toggle opens the panel of own stickers with same-origin thumbnails', async () => {
    await render([{ slug: 'wave', label: 'Wave' }]);
    const toggle = el().querySelector<HTMLButtonElement>('[data-testid="sticker-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const thumb = el().querySelector<HTMLImageElement>('[data-testid="sticker-insert-wave"] img')!;
    expect(thumb.getAttribute('src')).toBe('/bff/user/character/stickers/wave/body');
  });

  it('hides a thumbnail that fails to load (deleted/rejected sticker 404) — no broken glyph', async () => {
    await render([{ slug: 'wave', label: 'Wave' }]);
    el().querySelector<HTMLButtonElement>('[data-testid="sticker-toggle"]')!.click();
    fixture.detectChanges();
    const thumb = el().querySelector<HTMLImageElement>('[data-testid="sticker-insert-wave"] img')!;
    expect(thumb.hasAttribute('hidden')).toBeFalse();
    thumb.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(thumb.hasAttribute('hidden')).toBeTrue();
  });

  it('is keyboard operable: arrows rove between stickers, Escape closes and refocuses the toggle', async () => {
    await render([
      { slug: 'wave', label: 'Wave' },
      { slug: 'hug', label: 'Hug' },
    ]);
    const toggle = el().querySelector<HTMLButtonElement>('[data-testid="sticker-toggle"]')!;
    toggle.click();
    fixture.detectChanges();
    const panel = el().querySelector<HTMLElement>('[data-testid="sticker-panel"]')!;
    const first = el().querySelector<HTMLButtonElement>('[data-testid="sticker-insert-wave"]')!;
    const second = el().querySelector<HTMLButtonElement>('[data-testid="sticker-insert-hug"]')!;

    first.focus();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(second);
    // Wraps forward past the end…
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(first);
    // …and backward from the start.
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(second);

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="sticker-panel"]')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('emits the picked slug and closes the panel', async () => {
    await render([{ slug: 'wave', label: 'Wave' }]);
    const picked: string[] = [];
    fixture.componentInstance.insert.subscribe((s) => picked.push(s));
    el().querySelector<HTMLButtonElement>('[data-testid="sticker-toggle"]')!.click();
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('[data-testid="sticker-insert-wave"]')!.click();
    fixture.detectChanges();
    expect(picked).toEqual(['wave']);
    expect(el().querySelector('[data-testid="sticker-panel"]')).toBeNull();
  });
});

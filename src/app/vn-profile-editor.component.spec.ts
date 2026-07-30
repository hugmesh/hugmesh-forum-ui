import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VN_AVATAR_REF, VnProfileEditorComponent } from './vn-profile-editor.component';
import { VnProfile, VnProfileService } from './vn-profile.service';
import { StickerService } from './sticker.service';

function profile(over: Partial<VnProfile> = {}): VnProfile {
  return {
    subject: 'google:me@x',
    stickerSlug: null,
    characterImgRef: null,
    voiceboxStyle: 'classic',
    voiceboxAccent: null,
    voiceStyle: null,
    ...over,
  };
}

describe('VnProfileEditorComponent', () => {
  let fixture: ComponentFixture<VnProfileEditorComponent>;
  let component: VnProfileEditorComponent;
  let vn: jasmine.SpyObj<VnProfileService>;
  let stickers: jasmine.SpyObj<StickerService>;

  beforeEach(async () => {
    vn = jasmine.createSpyObj<VnProfileService>('VnProfileService', ['getMe', 'saveMe']);
    stickers = jasmine.createSpyObj<StickerService>('StickerService', ['listOwn']);
    vn.getMe.and.resolveTo(profile());
    stickers.listOwn.and.resolveTo([{ slug: 'wave', label: 'Wave' }]);

    await TestBed.configureTestingModule({
      imports: [VnProfileEditorComponent],
      providers: [
        { provide: VnProfileService, useValue: vn },
        { provide: StickerService, useValue: stickers },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VnProfileEditorComponent);
    component = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  // Two stability rounds: the editor's ngOnInit resolves a Promise.all chain
  // whose deeper continuations land after the first whenStable().
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders the 5 skin radio swatches with mini previews and a voice select', async () => {
    await render();
    for (const s of ['classic', 'glass', 'retro', 'neon', 'paper']) {
      expect(el().querySelector(`[data-testid="vn-editor-skin-${s}"]`)).withContext(s).not.toBeNull();
      expect(el().querySelector(`.vnbox-preview[data-vnskin="${s}"]`)).withContext(s).not.toBeNull();
    }
    expect(el().querySelector('[data-testid="vn-editor-voice"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="vn-editor-save"]')).not.toBeNull();
  });

  it('offers the caller their own stickers plus "none"', async () => {
    await render();
    expect(el().querySelector('[data-testid="vn-editor-sticker-none"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="vn-editor-sticker-wave"]')).not.toBeNull();
  });

  it('hides the sticker chooser when the endpoint is unavailable (fail-soft)', async () => {
    stickers.listOwn.and.resolveTo(null);
    await render();
    expect(el().querySelector('[data-testid="vn-editor-sticker-none"]')).toBeNull();
    // …but the rest of the editor still works.
    expect(el().querySelector('[data-testid="vn-editor-skin-glass"]')).not.toBeNull();
  });

  it('seeds the controls from the saved profile (GET /vn-profiles/me)', async () => {
    vn.getMe.and.resolveTo(
      profile({ stickerSlug: 'wave', characterImgRef: VN_AVATAR_REF, voiceboxStyle: 'neon', voiceboxAccent: '#00ff99', voiceStyle: 'soft' }),
    );
    await render();
    expect(component.skin()).toBe('neon');
    expect(component.stickerSlug()).toBe('wave');
    expect(component.useAvatar()).toBeTrue();
    expect(component.accentEnabled()).toBeTrue();
    expect(component.accent()).toBe('#00ff99');
    expect(component.voiceStyle()).toBe('soft');
    expect(el().querySelector<HTMLInputElement>('[data-testid="vn-editor-skin-neon"]')!.checked).toBeTrue();
  });

  it('PUTs the picked values on save and emits saved', async () => {
    const saved = profile({ voiceboxStyle: 'glass' });
    vn.saveMe.and.resolveTo(saved);
    await render();
    const emitted: VnProfile[] = [];
    component.saved.subscribe((p) => emitted.push(p));

    el().querySelector<HTMLInputElement>('[data-testid="vn-editor-skin-glass"]')!.click();
    el().querySelector<HTMLInputElement>('[data-testid="vn-editor-sticker-wave"]')!.click();
    fixture.detectChanges();
    component.accentEnabled.set(true);
    component.accent.set('#FF00AA'); // color inputs report lowercase; prove we normalize anyway
    component.voiceStyle.set('deep');
    await component.save();

    expect(vn.saveMe).toHaveBeenCalledWith({
      stickerSlug: 'wave',
      characterImgRef: null,
      voiceboxStyle: 'glass',
      voiceboxAccent: '#ff00aa',
      voiceStyle: 'deep',
    });
    expect(emitted).toEqual([saved]);
    await render();
    expect(el().querySelector('.vn-editor__outcome')!.textContent).toContain('VN profile saved.');
  });

  it('sends the avatar ref when "use my character avatar" is checked', async () => {
    vn.saveMe.and.resolveTo(profile());
    await render();
    component.useAvatar.set(true);
    await component.save();
    expect(vn.saveMe).toHaveBeenCalledWith(jasmine.objectContaining({ characterImgRef: VN_AVATAR_REF }));
  });

  it('blocks save on an invalid accent (client mirror of ^#[0-9a-f]{6}$)', async () => {
    await render();
    component.accentEnabled.set(true);
    component.accent.set('not-a-colour');
    await component.save();
    expect(vn.saveMe).not.toHaveBeenCalled();
    expect(component.error()).toContain('#rrggbb');
  });

  it('surfaces a server rejection in the alert region', async () => {
    vn.saveMe.and.rejectWith(new Error('400'));
    await render();
    await component.save();
    await render();
    expect(el().querySelector('[role="alert"]')!.textContent).toContain('Could not save');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { ForumIndexComponent } from './forum-index.component';
import { ForumService, ForumCategory } from './forum.service';
import { ForumAnnouncementsService } from './forum-announcements.service';
import { SessionService, HugSession } from './session.service';
import { VnProfileService } from './vn-profile.service';
import { StickerService } from './sticker.service';
import { CharacterAvatarService } from './character-avatar.service';

function cat(over: Partial<ForumCategory> = {}): ForumCategory {
  return { id: 1, name: 'General', description: 'Talk', topicCount: 3, postCount: 9, ...over };
}

function session(over: Partial<HugSession> = {}): HugSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice',
    provider: 'google',
    roles: ['user'],
    registrationComplete: true,
    ...over,
  };
}

describe('ForumIndexComponent', () => {
  let fixture: ComponentFixture<ForumIndexComponent>;
  let component: ForumIndexComponent;
  let forum: jasmine.SpyObj<ForumService>;
  const canPost = signal(false);

  beforeEach(async () => {
    localStorage.clear();
    forum = jasmine.createSpyObj<ForumService>('ForumService', ['listCategories']);
    (forum as unknown as { canPost: typeof canPost }).canPost = canPost;
    forum.listCategories.and.resolveTo([cat({ id: 1, name: 'General' }), cat({ id: 2, name: 'Off-topic' })]);

    const annService = jasmine.createSpyObj<ForumAnnouncementsService>('ForumAnnouncementsService', ['load']);
    (annService as unknown as { visible: ReturnType<typeof signal> }).visible = signal([]);
    annService.load.and.resolveTo();

    // The VN editor panel (opened from the header) probes these — keep the spec
    // network-free by stubbing ALL THREE fail-soft services. CharacterAvatarService
    // is the third: unstubbed it fetches /bff/user/character/avatar for real, which
    // karma answers 404, so the spec still passed while making a live request.
    const vn = jasmine.createSpyObj<VnProfileService>('VnProfileService', ['getMe', 'saveMe']);
    vn.getMe.and.resolveTo(null);
    const stickers = jasmine.createSpyObj<StickerService>('StickerService', ['listOwn']);
    stickers.listOwn.and.resolveTo(null);
    const avatars = jasmine.createSpyObj<CharacterAvatarService>('CharacterAvatarService', ['myImageUrl']);
    avatars.myImageUrl.and.resolveTo(null);

    await TestBed.configureTestingModule({
      imports: [ForumIndexComponent],
      providers: [
        provideRouter([]),
        { provide: ForumService, useValue: forum },
        { provide: ForumAnnouncementsService, useValue: annService },
        { provide: VnProfileService, useValue: vn },
        { provide: StickerService, useValue: stickers },
        { provide: CharacterAvatarService, useValue: avatars },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ForumIndexComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    localStorage.clear();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('has a single h1 forum title and an h2 categories heading (heading hierarchy)', async () => {
    canPost.set(false);
    await render();
    expect(el().querySelectorAll('h1').length).toBe(1);
    const region = el().querySelector('[aria-labelledby="forum-categories-heading"]')!;
    expect(region.getAttribute('role')).toBe('region');
  });

  it('lists the categories with links to each category', async () => {
    await render();
    const links = el().querySelectorAll('.forum-category__link');
    expect(links.length).toBe(2);
    expect(links[0].textContent).toContain('General');
  });

  it('hides "New topic" when the caller cannot post (no forum role)', async () => {
    canPost.set(false);
    await render();
    expect(el().querySelector('[data-testid="forum-new-topic"]')).toBeNull();
  });

  it('shows "New topic" when the caller holds the forum role (role-responsive)', async () => {
    canPost.set(true);
    await render();
    expect(el().querySelector('[data-testid="forum-new-topic"]')).not.toBeNull();
  });

  it('surfaces a load error in a role=alert', async () => {
    forum.listCategories.and.rejectWith(new Error('down'));
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Could not load');
    expect(component.categories().length).toBe(0);
  });

  // ── VN profile entry point (header gear) ───────────────────────────────────

  it('hides the VN profile toggle for a logged-out visitor', async () => {
    await render();
    expect(el().querySelector('[data-testid="vn-profile-toggle"]')).toBeNull();
  });

  it('shows the VN profile toggle for a logged-in caller and opens the editor panel', async () => {
    TestBed.inject(SessionService).set(session());
    await render();
    const toggle = el().querySelector<HTMLButtonElement>('[data-testid="vn-profile-toggle"]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el().querySelector('[data-testid="vn-editor"]')).toBeNull();
    toggle.click();
    await render();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('[data-testid="vn-editor"]')).not.toBeNull();
  });

  it('Escape closes the editor panel and returns focus to the toggle (a11y focus management)', async () => {
    TestBed.inject(SessionService).set(session());
    await render();
    const toggle = el().querySelector<HTMLButtonElement>('[data-testid="vn-profile-toggle"]')!;
    toggle.click();
    await render();
    const panel = el().querySelector<HTMLElement>('#vn-editor-panel')!;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(el().querySelector('[data-testid="vn-editor"]')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});

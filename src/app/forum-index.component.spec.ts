import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signal } from '@angular/core';

import { ForumIndexComponent } from './forum-index.component';
import { FORUM_ROUTES } from './forum.routes';
import { routes as STANDALONE_ROUTES } from './app.routes';
import { ForumService, ForumCategory } from './forum.service';
import { ForumAnnouncementsService } from './forum-announcements.service';
import { SessionService, sessionFetcher, HugSession } from './session.service';
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
  const canModerate = signal(false);

  beforeEach(async () => {
    localStorage.clear();
    forum = jasmine.createSpyObj<ForumService>('ForumService', ['listCategories']);
    (forum as unknown as { canPost: typeof canPost }).canPost = canPost;
    (forum as unknown as { canModerate: typeof canModerate }).canModerate = canModerate;
    canModerate.set(false);
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

    // The real SessionService (root-provided) probes GET /bff/session when a spec
    // injects it; no BFF here, so it falls back to the mirror set() writes.
    spyOn(sessionFetcher, 'fetch').and.rejectWith(new Error('offline'));
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

  it('hides the moderation queue link unless the caller is a forum moderator', async () => {
    canModerate.set(false);
    await render();
    expect(el().querySelector('[data-testid="forum-moderation-link"]')).toBeNull();
  });

  it('shows the moderation queue link to a forum moderator', async () => {
    canModerate.set(true);
    await render();
    const link = el().querySelector<HTMLAnchorElement>('[data-testid="forum-moderation-link"]')!;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('Moderation queue');
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

/**
 * FEDERATION GUARD for the index page's links (GUI-09).
 *
 * The index is the EMPTY-PATH route of FORUM_ROUTES. A template `routerLink`
 * resolves against the component's own ActivatedRoute, and an empty-path route
 * consumes no URL segment, so `..` climbs into the PARENT's segments. Under the
 * host shell (FORUM_ROUTES mounted at 'social/forum') `../moderation` therefore
 * replaced the `forum` segment and produced /social/moderation, which the
 * shell's '**' route bounced to the home page. The same happened to "New topic"
 * and every category link. Standalone (dev shell at the origin root) there is
 * no parent segment to strip, and the same links threw NG04005 ("Invalid
 * number of '../'") while rendering.
 *
 * Only a REAL router with the remote mounted under a non-empty parent can tell
 * the two spellings apart: with `provideRouter([])` (the block above) both
 * produce the same href, which is why that suite stayed green.
 */
describe('ForumIndexComponent links resolve inside the forum mount', () => {
  async function renderAt(routes: Routes, url: string): Promise<HTMLElement> {
    const forum = jasmine.createSpyObj<ForumService>('ForumService', ['listCategories']);
    (forum as unknown as { canPost: unknown }).canPost = signal(true);
    (forum as unknown as { canModerate: unknown }).canModerate = signal(true);
    forum.listCategories.and.resolveTo([cat({ id: 1, name: 'General' }), cat({ id: 42, name: 'Off-topic' })]);
    const annService = jasmine.createSpyObj<ForumAnnouncementsService>('ForumAnnouncementsService', ['load']);
    (annService as unknown as { visible: ReturnType<typeof signal> }).visible = signal([]);
    annService.load.and.resolveTo();
    spyOn(sessionFetcher, 'fetch').and.rejectWith(new Error('offline'));

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: ForumService, useValue: forum },
        { provide: ForumAnnouncementsService, useValue: annService },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, ForumIndexComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  function hrefs(root: HTMLElement) {
    const href = (sel: string) => root.querySelector<HTMLAnchorElement>(sel)?.getAttribute('href');
    return {
      moderation: href('[data-testid="forum-moderation-link"]'),
      newTopic: href('[data-testid="forum-new-topic"]'),
      categories: [...root.querySelectorAll<HTMLAnchorElement>('.forum-category__link')].map((a) =>
        a.getAttribute('href'),
      ),
    };
  }

  it('under the shell mount (/social/forum) every index link stays under /social/forum', async () => {
    // Mounted exactly where the host shell mounts it (host app.routes.ts:
    // path 'social/forum' -> FORUM_ROUTES), plus the shell's catch-all.
    const root = await renderAt(
      [
        { path: 'social/forum', children: FORUM_ROUTES },
        { path: '**', redirectTo: '' },
      ],
      '/social/forum',
    );
    expect(hrefs(root)).toEqual({
      moderation: '/social/forum/moderation',
      newTopic: '/social/forum/create-topic',
      categories: ['/social/forum/categories/1', '/social/forum/categories/42'],
    });
  });

  it('standalone (dev shell at the origin root) the same links resolve at the root', async () => {
    const root = await renderAt(STANDALONE_ROUTES, '/');
    expect(hrefs(root)).toEqual({
      moderation: '/moderation',
      newTopic: '/create-topic',
      categories: ['/categories/1', '/categories/42'],
    });
  });
});

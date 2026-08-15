import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { MAX_SPEECH_CHARS, TopicDetailComponent, speechAccess } from './topic-detail.component';
import { ForumService, ForumPost, TopicDetail } from './forum.service';
import { VnProfile, VnProfileService } from './vn-profile.service';
import { StickerService } from './sticker.service';

function post(over: Partial<ForumPost> = {}): ForumPost {
  return {
    id: 100,
    topicId: 10,
    authorSubject: 'google:alice@gmail.com',
    authorLabel: 'alice',
    bodyHtml: '<p>first post</p>',
    createdAt: '2026-06-11',
    editedAt: null,
    ...over,
  };
}

function detail(over: Partial<TopicDetail> = {}): TopicDetail {
  return {
    topic: {
      id: 10,
      categoryId: 1,
      title: 'A topic',
      authorSubject: 'google:alice@gmail.com',
      authorLabel: 'alice',
      replyCount: 0,
      viewCount: 1,
      locked: false,
      createdAt: '',
      lastPostAt: '',
    },
    posts: [post()],
    ...over,
  };
}

function vnProfile(over: Partial<VnProfile> = {}): VnProfile {
  return {
    subject: 'google:alice@gmail.com',
    stickerSlug: null,
    characterImgRef: null,
    voiceboxStyle: 'classic',
    voiceboxAccent: null,
    voiceStyle: null,
    ...over,
  };
}

describe('TopicDetailComponent', () => {
  let fixture: ComponentFixture<TopicDetailComponent>;
  let component: TopicDetailComponent;
  let forum: jasmine.SpyObj<ForumService>;
  let vn: jasmine.SpyObj<VnProfileService>;
  let stickers: jasmine.SpyObj<StickerService>;
  const canPost = signal(true);
  const canModerate = signal(false);
  const route = { paramMap: of({ get: (_: string) => '10' }) } as unknown as ActivatedRoute;

  beforeEach(async () => {
    forum = jasmine.createSpyObj<ForumService>('ForumService', [
      'getTopic',
      'createReply',
      'editPost',
      'deletePost',
      'ownsPost',
      'moderateTopic',
    ]);
    (forum as unknown as { canPost: typeof canPost }).canPost = canPost;
    (forum as unknown as { canModerate: typeof canModerate }).canModerate = canModerate;
    // BOTH role signals are describe-scoped (the spy service holds a reference
    // to them), so both must be reset here: a spec that leaves canPost=false
    // otherwise leaks a different view tree — and therefore a different
    // change-detection schedule — into whichever spec Jasmine's random order
    // runs next.
    canPost.set(true);
    canModerate.set(false);
    forum.getTopic.and.resolveTo(detail());
    forum.ownsPost.and.returnValue(false);

    // VN layer: default = nobody has a profile (posts render exactly as today).
    vn = jasmine.createSpyObj<VnProfileService>('VnProfileService', ['lookup']);
    vn.lookup.and.resolveTo({});
    // Sticker picker probe: default = endpoint unavailable (picker hidden).
    stickers = jasmine.createSpyObj<StickerService>('StickerService', ['listOwn']);
    stickers.listOwn.and.resolveTo(null);

    await TestBed.configureTestingModule({
      imports: [TopicDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ForumService, useValue: forum },
        { provide: ActivatedRoute, useValue: route },
        { provide: VnProfileService, useValue: vn },
        { provide: StickerService, useValue: stickers },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TopicDetailComponent);
    component = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  // Two stability rounds: the VN profile lookup resolves one microtask level
  // below getTopic (load → loadProfiles → lookup), which the first
  // whenStable() does not always settle.
  //
  // The 1-in-3 flake logged here on 2026-07-16 was NOT a missing round — it
  // was diagnosed on 2026-08-14 and fixed in the component. The rounds settle
  // the promises fine (profiles() is populated before the last
  // detectChanges); what was missing was a reason for Angular to check THIS
  // component's view afterwards. `profiles` is read by ngAfterViewChecked and
  // by the @for block, never by the component's own template, so a late set()
  // refreshed only the embedded view and the skin/sticker DOM pass never ran.
  // Whether that mattered depended on the view tree: with the reply composer
  // present, the sticker picker's own async init happened to force the extra
  // check — so a leaked canPost=false (see beforeEach) flipped these specs to
  // red. topic-detail.component.ts now calls markForCheck() on those async
  // writes; see 'applies a VN profile that arrives AFTER the posts rendered'.
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders the topic h1 and each post as an article with an author h3', async () => {
    await render();
    expect(el().querySelector('h1')!.textContent).toContain('A topic');
    expect(el().querySelectorAll('article.forum-post').length).toBe(1);
    expect(el().querySelector('.forum-post__author')!.tagName).toBe('H3');
  });

  it('shows the reply form when the caller can post', async () => {
    canPost.set(true);
    await render();
    expect(el().querySelector('[data-testid="reply-body"]')).not.toBeNull();
  });

  it('hides the reply form and shows a gated note when the caller cannot post', async () => {
    canPost.set(false);
    await render();
    expect(el().querySelector('[data-testid="reply-body"]')).toBeNull();
    expect(el().querySelector('[data-testid="reply-gated"]')).not.toBeNull();
  });

  it('hides the reply form when the topic is locked', async () => {
    canPost.set(true);
    forum.getTopic.and.resolveTo(detail({ topic: { ...detail().topic, locked: true } }));
    await render();
    expect(el().querySelector('[data-testid="reply-body"]')).toBeNull();
  });

  it('posts a reply and appends it to the thread', async () => {
    canPost.set(true);
    await render();
    forum.createReply.and.resolveTo(post({ id: 200, bodyHtml: '<p>my reply</p>' }));
    component.replyBody.set('my reply');
    await component.submitReply();
    fixture.detectChanges();
    expect(forum.createReply).toHaveBeenCalledWith(jasmine.objectContaining({ topicId: 10, body: 'my reply' }));
    expect(component.detail()!.posts.length).toBe(2);
  });

  it('shows edit/delete only for a post the caller owns (or admin)', async () => {
    forum.ownsPost.and.returnValue(true);
    await render();
    expect(el().querySelector('[data-testid="post-edit"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="post-delete"]')).not.toBeNull();
  });

  it('deletes an owned post from the thread', async () => {
    forum.ownsPost.and.returnValue(true);
    forum.deletePost.and.resolveTo();
    await render();
    await component.deletePost(detail().posts[0]);
    fixture.detectChanges();
    expect(forum.deletePost).toHaveBeenCalledWith(100);
    expect(component.detail()!.posts.length).toBe(0);
  });

  // ── moderation: canModerate wires edit/delete on OTHERS' posts + the lock ──
  it('shows edit/delete on a non-owned post for a forum moderator (canModerate)', async () => {
    forum.ownsPost.and.returnValue(false); // NOT the author
    canModerate.set(true); // mod+forum / admin
    await render();
    expect(el().querySelector('[data-testid="post-edit"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="post-delete"]')).not.toBeNull();
  });

  it('hides edit/delete on a non-owned post for a non-moderator', async () => {
    forum.ownsPost.and.returnValue(false);
    canModerate.set(false);
    await render();
    expect(el().querySelector('[data-testid="post-edit"]')).toBeNull();
    expect(el().querySelector('[data-testid="post-delete"]')).toBeNull();
  });

  it('shows the Lock topic control only for a moderator', async () => {
    canModerate.set(false);
    await render();
    expect(el().querySelector('[data-testid="mod-lock-toggle"]')).toBeNull();
    canModerate.set(true);
    fixture.detectChanges();
    const btn = el().querySelector<HTMLButtonElement>('[data-testid="mod-lock-toggle"]')!;
    expect(btn).not.toBeNull();
    expect(btn.textContent!.trim()).toBe('Lock topic');
  });

  it('toggleLock locks the topic, flips it locally, and suppresses the reply form', async () => {
    canModerate.set(true);
    canPost.set(true);
    forum.moderateTopic.and.resolveTo();
    await render();
    // The unlocked topic shows the reply form to a poster.
    expect(el().querySelector('[data-testid="reply-body"]')).not.toBeNull();
    await component.toggleLock();
    fixture.detectChanges();
    expect(forum.moderateTopic).toHaveBeenCalledWith(10, 'lock');
    expect(component.detail()!.topic.locked).toBeTrue();
    // Real consequence: the reply form is gone, the button now offers Unlock.
    expect(el().querySelector('[data-testid="reply-body"]')).toBeNull();
    expect(el().querySelector('[data-testid="mod-lock-toggle"]')!.textContent!.trim()).toBe('Unlock topic');
  });

  it('toggleLock announces an alert when the moderation call fails', async () => {
    canModerate.set(true);
    forum.moderateTopic.and.rejectWith(new Error('boom'));
    await render();
    await component.toggleLock();
    expect(component.outcome()?.kind).toBe('alert');
    expect(component.detail()!.topic.locked).toBeFalse();
  });

  // ── stored DOM-XSS regression ──────────────────────────────────────────────
  // A malicious post bodyHtml must be re-sanitized (DOMPurify allow-list) before
  // it is bound via [innerHTML]="safeBody(p)" — so attacker markup never
  // reaches the reader's live DOM, while benign formatting is preserved. This
  // exercises the real binding path end-to-end, not the helper in isolation.
  it('strips script/onerror/javascript: from a rendered post body but keeps benign markup', async () => {
    forum.getTopic.and.resolveTo(
      detail({
        posts: [
          post({
            bodyHtml:
              '<p>hi <strong>there</strong></p>' +
              '<script>alert(1)</script>' +
              '<img src="x" onerror="alert(2)">' +
              '<a href="javascript:alert(3)">x</a>' +
              '<ul><li>one</li></ul>' +
              '<a href="https://ok.test" rel="noopener" target="_blank">link</a>',
          }),
        ],
      }),
    );
    await render();

    const body = el().querySelector('.forum-post__body')!;
    // attacker markup is gone from the actually-rendered DOM…
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('[href^="javascript:"]')).toBeNull();
    for (const node of Array.from(body.querySelectorAll('*'))) {
      for (const attr of Array.from(node.attributes)) {
        expect(attr.name.startsWith('on')).withContext(`attr ${attr.name}`).toBeFalse();
      }
    }
    // …and legitimate formatting/links survive. (Query a[href]: DOMPurify keeps
    // the javascript: anchor as an inert, href-less <a> — pre-existing baseline
    // behaviour since dompurify 3.4.x — so the first <a> may be the neutered one.)
    expect(body.querySelector('strong')?.textContent).toBe('there');
    expect(body.querySelector('ul li')?.textContent).toBe('one');
    const ok = body.querySelector('a[href]');
    expect(ok?.getAttribute('href')).toBe('https://ok.test');
  });

  // ── VN layer: skins, accent, sprite ─────────────────────────────────────────

  it('asks the VN service ONCE for the page authors (coalesced lookup input)', async () => {
    forum.getTopic.and.resolveTo(
      detail({ posts: [post(), post({ id: 101 }), post({ id: 102, authorSubject: 'google:bob@x', authorLabel: 'bob' })] }),
    );
    await render();
    expect(vn.lookup).toHaveBeenCalledTimes(1);
    expect(vn.lookup).toHaveBeenCalledWith(['google:alice@gmail.com', 'google:alice@gmail.com', 'google:bob@x']);
  });

  it('applies the author skin + accent to the post article and renders the sprite', async () => {
    vn.lookup.and.resolveTo({
      'google:alice@gmail.com': vnProfile({
        voiceboxStyle: 'glass',
        voiceboxAccent: '#ff00aa',
        characterImgRef: '/bff/user/character/avatar',
      }),
    });
    await render();
    const article = el().querySelector<HTMLElement>('article.forum-post')!;
    expect(article.getAttribute('data-vnskin')).toBe('glass');
    expect(article.style.getPropertyValue('--forum-vnbox-accent')).toBe('#ff00aa');
    const sprite = article.querySelector<HTMLImageElement>('[data-testid="post-sprite"]')!;
    expect(sprite.getAttribute('src')).toBe('/bff/user/character/avatar');
    // a11y: the sprite names its author instead of being decorative.
    expect(sprite.getAttribute('alt')).toBe('alice character');
  });

  // Regression for the flake root cause: the lookup is FAIL-SOFT and resolves
  // after the posts are already on screen. `profiles` is consumed by
  // ngAfterViewChecked (applyVoicebox) and by the @for block, but never by the
  // component's own template — so unless the component asks for a re-check,
  // Angular refreshes only the embedded view and the skin/accent is never
  // written. One change-detection pass after the profile lands must apply it.
  it('applies a VN profile that arrives AFTER the posts rendered', async () => {
    let release!: (found: Record<string, VnProfile>) => void;
    const pending = new Promise<Record<string, VnProfile>>((resolve) => (release = resolve));
    vn.lookup.and.returnValue(pending);

    await render();
    const article = el().querySelector<HTMLElement>('article.forum-post')!;
    // Nothing resolved yet: the post renders exactly as an unprofiled one.
    expect(article.hasAttribute('data-vnskin')).toBeFalse();

    release({ 'google:alice@gmail.com': vnProfile({ voiceboxStyle: 'glass', voiceboxAccent: '#ff00aa' }) });
    await pending;
    await fixture.whenStable();
    fixture.detectChanges();

    // Same <article> element (trackBy kept it) — now skinned.
    expect(article.getAttribute('data-vnskin')).toBe('glass');
    expect(article.style.getPropertyValue('--forum-vnbox-accent')).toBe('#ff00aa');
  });

  it('hides a sprite whose image fails to load (no broken-image glyph)', async () => {
    vn.lookup.and.resolveTo({
      'google:alice@gmail.com': vnProfile({ characterImgRef: '/bff/user/character/avatar' }),
    });
    await render();
    const sprite = el().querySelector<HTMLImageElement>('[data-testid="post-sprite"]')!;
    expect(sprite.hidden).toBeFalse();
    sprite.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(sprite.hidden).toBeTrue();
  });

  it('leaves a profile-less author EXACTLY as today (no skin attr, no var, no sprite)', async () => {
    await render();
    const article = el().querySelector<HTMLElement>('article.forum-post')!;
    expect(article.hasAttribute('data-vnskin')).toBeFalse();
    expect(article.style.getPropertyValue('--forum-vnbox-accent')).toBe('');
    expect(article.querySelector('[data-testid="post-sprite"]')).toBeNull();
  });

  it('client-guards the sprite: an off-origin characterImgRef never renders; falls back to the sticker', async () => {
    vn.lookup.and.resolveTo({
      'google:alice@gmail.com': vnProfile({ characterImgRef: 'https://evil.example/x.png', stickerSlug: 'wave' }),
    });
    await render();
    const sprite = el().querySelector<HTMLImageElement>('[data-testid="post-sprite"]')!;
    expect(sprite.getAttribute('src')).toBe('/bff/user/character/stickers/wave/body');
  });

  it('rejects a bad accent hex at the article boundary (attr set, var NOT set)', async () => {
    vn.lookup.and.resolveTo({
      'google:alice@gmail.com': vnProfile({ voiceboxStyle: 'neon', voiceboxAccent: '#FF00AA;background:url(x)' }),
    });
    await render();
    const article = el().querySelector<HTMLElement>('article.forum-post')!;
    expect(article.getAttribute('data-vnskin')).toBe('neon');
    expect(article.style.getPropertyValue('--forum-vnbox-accent')).toBe('');
  });

  it('never sets a non-allowlisted data-vnskin value', async () => {
    vn.lookup.and.resolveTo({
      'google:alice@gmail.com': vnProfile({ voiceboxStyle: 'sparkle' as never }),
    });
    await render();
    expect(el().querySelector<HTMLElement>('article.forum-post')!.hasAttribute('data-vnskin')).toBeFalse();
  });

  // ── stickers in posts ────────────────────────────────────────────────────

  it('renders :snap-sticker:<slug>: tokens in a post body as same-origin imgs (after sanitization)', async () => {
    forum.getTopic.and.resolveTo(detail({ posts: [post({ bodyHtml: '<p>gg :snap-sticker:wave: wp</p>' })] }));
    await render();
    const img = el().querySelector<HTMLImageElement>('.forum-post__body img.forum-sticker')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/bff/user/character/stickers/wave/body');
    expect(el().querySelector('.forum-post__body')!.textContent).not.toContain(':snap-sticker:');
  });

  it('sticker imgs survive unrelated change-detection passes (memoized innerHTML binding)', async () => {
    forum.getTopic.and.resolveTo(detail({ posts: [post({ bodyHtml: '<p>:snap-sticker:wave:</p>' })] }));
    await render();
    fixture.detectChanges();
    fixture.detectChanges();
    expect(el().querySelectorAll('.forum-post__body img.forum-sticker').length).toBe(1);
  });

  // Fail-soft, and the second half of the same regression: the post-render
  // sticker pass is driven by the TOPIC load, so it must not depend on the
  // (independent, best-effort) VN lookup ever settling. Read by a gated
  // reader, which is also the leanest view tree there is — no composer, no
  // sticker picker, so the topic load itself is the only thing that can
  // schedule the check that renders the stickers.
  it('renders sticker tokens for a gated reader while the VN lookup hangs', async () => {
    canPost.set(false);
    forum.getTopic.and.resolveTo(detail({ posts: [post({ bodyHtml: '<p>gg :snap-sticker:wave: wp</p>' })] }));
    vn.lookup.and.returnValue(new Promise<Record<string, VnProfile>>(() => {}));
    await render();
    expect(el().querySelector('[data-testid="reply-body"]')).toBeNull();
    expect(el().querySelector<HTMLImageElement>('.forum-post__body img.forum-sticker')).not.toBeNull();
  });

  it('hides the sticker picker in the reply composer when the endpoint is unavailable', async () => {
    canPost.set(true);
    await render();
    expect(el().querySelector('[data-testid="sticker-toggle"]')).toBeNull();
  });

  it('inserts the picked sticker token into the reply draft (and previews it as an img)', async () => {
    canPost.set(true);
    stickers.listOwn.and.resolveTo([{ slug: 'wave', label: 'Wave' }]);
    await render();
    component.replyBody.set('gg ');
    await render();
    const area = el().querySelector<HTMLTextAreaElement>('#reply-body')!;
    area.setSelectionRange(3, 3);
    component.insertSticker('wave');
    await render();
    expect(component.replyBody()).toBe('gg :snap-sticker:wave:');
    const previewImg = el().querySelector<HTMLImageElement>('.topic__preview img.forum-sticker')!;
    expect(previewImg).not.toBeNull();
    expect(previewImg.getAttribute('src')).toBe('/bff/user/character/stickers/wave/body');
  });

  it('rejects a hostile slug at insertion time', async () => {
    canPost.set(true);
    await render();
    component.insertSticker('<img onerror=alert(1)>');
    expect(component.replyBody()).toBe('');
  });

  // ── read aloud (voicebox = also audible) ─────────────────────────────────

  function fakeSynth(): jasmine.SpyObj<SpeechSynthesis> {
    return jasmine.createSpyObj<SpeechSynthesis>('SpeechSynthesis', ['speak', 'cancel']);
  }

  it('hides the read-aloud control when speechSynthesis is unavailable (feature-detect)', async () => {
    spyOn(speechAccess, 'synth').and.returnValue(null);
    await render();
    expect(el().querySelector('[data-testid="post-read-aloud"]')).toBeNull();
  });

  it("reads the post text with the AUTHOR's voiceStyle pitch/rate and toggles aria-pressed", async () => {
    const synth = fakeSynth();
    spyOn(speechAccess, 'synth').and.returnValue(synth);
    vn.lookup.and.resolveTo({ 'google:alice@gmail.com': vnProfile({ voiceStyle: 'deep' }) });
    await render();

    const btn = el().querySelector<HTMLButtonElement>('[data-testid="post-read-aloud"]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    // a11y: the accessible name identifies WHOSE post the button reads.
    expect(btn.getAttribute('aria-label')).toContain('alice');
    btn.click();
    fixture.detectChanges();

    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = synth.speak.calls.mostRecent().args[0];
    expect(utterance.text).toContain('first post');
    expect(utterance.pitch).toBeCloseTo(0.7);
    expect(utterance.rate).toBeCloseTo(0.9);
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    // Second click cancels.
    btn.click();
    fixture.detectChanges();
    expect(synth.cancel).toHaveBeenCalled();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('uses the default voice when the author has no voiceStyle', async () => {
    const synth = fakeSynth();
    spyOn(speechAccess, 'synth').and.returnValue(synth);
    await render();
    el().querySelector<HTMLButtonElement>('[data-testid="post-read-aloud"]')!.click();
    const utterance = synth.speak.calls.mostRecent().args[0];
    expect(utterance.pitch).toBeCloseTo(1);
    expect(utterance.rate).toBeCloseTo(1);
  });

  it('cancels any in-flight speech on navigation (ngOnDestroy)', async () => {
    const synth = fakeSynth();
    spyOn(speechAccess, 'synth').and.returnValue(synth);
    await render();
    el().querySelector<HTMLButtonElement>('[data-testid="post-read-aloud"]')!.click();
    fixture.destroy();
    expect(synth.cancel).toHaveBeenCalled();
  });

  it(`caps the spoken text at ${MAX_SPEECH_CHARS} chars (huge posts cannot queue unbounded audio)`, async () => {
    const synth = fakeSynth();
    spyOn(speechAccess, 'synth').and.returnValue(synth);
    forum.getTopic.and.resolveTo(detail({ posts: [post({ bodyHtml: `<p>${'y'.repeat(MAX_SPEECH_CHARS + 500)}</p>` })] }));
    await render();
    el().querySelector<HTMLButtonElement>('[data-testid="post-read-aloud"]')!.click();
    const utterance = synth.speak.calls.mostRecent().args[0];
    expect(utterance.text.length).toBe(MAX_SPEECH_CHARS);
  });
});

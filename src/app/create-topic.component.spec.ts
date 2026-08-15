import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';

import { CreateTopicComponent } from './create-topic.component';
import { ForumService, ForumCategory } from './forum.service';
import { StickerService } from './sticker.service';

function cat(over: Partial<ForumCategory> = {}): ForumCategory {
  return { id: 1, name: 'General', description: '', topicCount: 0, postCount: 0, ...over };
}

describe('CreateTopicComponent', () => {
  let fixture: ComponentFixture<CreateTopicComponent>;
  let component: CreateTopicComponent;
  let forum: jasmine.SpyObj<ForumService>;
  let stickers: jasmine.SpyObj<StickerService>;
  const canPost = signal(true);

  beforeEach(async () => {
    forum = jasmine.createSpyObj<ForumService>('ForumService', ['listCategories', 'createTopic']);
    (forum as unknown as { canPost: typeof canPost }).canPost = canPost;
    forum.listCategories.and.resolveTo([cat({ id: 1 }), cat({ id: 2, name: 'Off-topic' })]);
    // Sticker picker probe: default = endpoint unavailable (picker hidden).
    stickers = jasmine.createSpyObj<StickerService>('StickerService', ['listOwn']);
    stickers.listOwn.and.resolveTo(null);

    await TestBed.configureTestingModule({
      imports: [CreateTopicComponent],
      providers: [
        provideRouter([]),
        { provide: ForumService, useValue: forum },
        { provide: StickerService, useValue: stickers },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateTopicComponent);
    component = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders the form (with labelled fields) when the caller can post', async () => {
    canPost.set(true);
    await render();
    expect(el().querySelector('[data-testid="create-title"]')).not.toBeNull();
    expect(el().querySelector('label[for="topic-title"]')).not.toBeNull();
    expect(el().querySelector('label[for="topic-body"]')).not.toBeNull();
  });

  it('shows a gated message instead of the form when the caller cannot post', async () => {
    canPost.set(false);
    await render();
    expect(el().querySelector('[data-testid="create-gated"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="create-title"]')).toBeNull();
  });

  it('does not submit and marks fields invalid when title/body are empty', async () => {
    canPost.set(true);
    await render();
    await component.submit();
    expect(forum.createTopic).not.toHaveBeenCalled();
    expect(component.titleInvalid()).toBeTrue();
    expect(component.bodyInvalid()).toBeTrue();
  });

  it('creates a topic and navigates to it on a valid submit', async () => {
    canPost.set(true);
    await render();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    forum.createTopic.and.resolveTo({
      id: 77,
      categoryId: 1,
      title: 'Hi',
      authorSubject: 's',
      authorLabel: 'a',
      replyCount: 0,
      viewCount: 0,
      locked: false,
      createdAt: '',
      lastPostAt: '',
    });
    component.categoryId.set(1);
    component.title.set('Hi');
    component.body.set('Some **body**');
    await component.submit();
    expect(forum.createTopic).toHaveBeenCalledWith(jasmine.objectContaining({ categoryId: 1, title: 'Hi' }));
    // ROUTE-RELATIVE: `Router.navigate` resolves against the router ROOT unless
    // `relativeTo` is given, so the bare `['../topics', id]` landed on
    // `/topics/77` — off this remote's mount under the host shell. The
    // `relativeTo` argument is the whole fix; asserting only the command list
    // is what let the defect through.
    expect(nav).toHaveBeenCalledWith(
      ['../topics', 77], jasmine.objectContaining({ relativeTo: jasmine.anything() }));
    const [, extras] = nav.calls.mostRecent().args as [unknown[], { relativeTo?: unknown }];
    expect(extras?.relativeTo).withContext('relativeTo must be the CURRENT route').toBe(
      TestBed.inject(ActivatedRoute));
  });

  // ── stickers in the composer ────────────────────────────────────────────────

  it('hides the sticker picker entirely when the endpoint is unavailable', async () => {
    canPost.set(true);
    await render();
    expect(el().querySelector('[data-testid="sticker-toggle"]')).toBeNull();
  });

  it('inserts the picked sticker token at the caret and previews it as a DOM img', async () => {
    canPost.set(true);
    stickers.listOwn.and.resolveTo([{ slug: 'wave', label: 'Wave' }]);
    await render();
    component.body.set('gg wp');
    await render();
    const area = el().querySelector<HTMLTextAreaElement>('#topic-body')!;
    area.setSelectionRange(2, 2);
    component.insertSticker('wave');
    await render();
    expect(component.body()).toBe('gg:snap-sticker:wave: wp');
    const img = el().querySelector<HTMLImageElement>('.create-preview img.forum-sticker')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/bff/user/character/stickers/wave/body');
    expect(el().querySelector('.create-preview')!.textContent).not.toContain(':snap-sticker:');
  });

  it('ignores a hostile slug at insertion time (token builder re-validates)', async () => {
    canPost.set(true);
    await render();
    component.insertSticker('"><script>alert(1)</script>');
    expect(component.body()).toBe('');
  });
});

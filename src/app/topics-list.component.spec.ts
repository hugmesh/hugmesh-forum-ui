import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { TopicsListComponent } from './topics-list.component';
import { ForumService, ForumTopic, Page } from './forum.service';

function topic(over: Partial<ForumTopic> = {}): ForumTopic {
  return {
    id: 10,
    categoryId: 1,
    title: 'Hello',
    authorSubject: 'google:alice@gmail.com',
    authorLabel: 'alice',
    replyCount: 2,
    viewCount: 5,
    locked: false,
    createdAt: '',
    lastPostAt: '',
    ...over,
  };
}

function page(over: Partial<Page<ForumTopic>> = {}): Page<ForumTopic> {
  return { items: [topic()], page: 1, pageSize: 20, total: 45, ...over };
}

describe('TopicsListComponent', () => {
  let fixture: ComponentFixture<TopicsListComponent>;
  let component: TopicsListComponent;
  let forum: jasmine.SpyObj<ForumService>;
  const canPost = signal(false);
  const route = { paramMap: of({ get: (_: string) => '1' }) } as unknown as ActivatedRoute;

  beforeEach(async () => {
    forum = jasmine.createSpyObj<ForumService>('ForumService', ['listTopics']);
    (forum as unknown as { canPost: typeof canPost }).canPost = canPost;
    forum.listTopics.and.resolveTo(page());

    await TestBed.configureTestingModule({
      imports: [TopicsListComponent],
      providers: [
        provideRouter([]),
        { provide: ForumService, useValue: forum },
        { provide: ActivatedRoute, useValue: route },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TopicsListComponent);
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

  it('loads topics for the category from the route and renders them', async () => {
    await render();
    expect(forum.listTopics).toHaveBeenCalledWith(1, jasmine.objectContaining({ page: 1 }));
    expect(el().querySelectorAll('.forum-topic-row').length).toBe(1);
  });

  it('computes total pages from total / pageSize', async () => {
    await render();
    expect(component.totalPages()).toBe(3); // ceil(45/20)
    expect(component.hasPrev()).toBeFalse();
    expect(component.hasNext()).toBeTrue();
  });

  it('paginates forward and disables Previous on page 1', async () => {
    await render();
    const prev = el().querySelector<HTMLButtonElement>('[data-testid="topics-prev"]')!;
    expect(prev.disabled).toBeTrue();
    forum.listTopics.and.resolveTo(page({ page: 2 }));
    el().querySelector<HTMLButtonElement>('[data-testid="topics-next"]')!.click();
    await fixture.whenStable();
    expect(forum.listTopics).toHaveBeenCalledWith(1, jasmine.objectContaining({ page: 2 }));
  });

  it('reloads with the chosen sort', async () => {
    await render();
    forum.listTopics.calls.reset();
    component.onSortChange('replies');
    await fixture.whenStable();
    expect(forum.listTopics).toHaveBeenCalledWith(1, jasmine.objectContaining({ sort: 'replies', page: 1 }));
  });

  it('hides "New topic" without the forum role and shows it with it', async () => {
    canPost.set(false);
    await render();
    expect(el().querySelector('[data-testid="topics-new-topic"]')).toBeNull();
    canPost.set(true);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="topics-new-topic"]')).not.toBeNull();
  });
});

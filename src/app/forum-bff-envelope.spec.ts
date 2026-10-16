import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { ForumIndexComponent } from './forum-index.component';
import { TopicsListComponent } from './topics-list.component';
import { CreateTopicComponent } from './create-topic.component';
import { ForumAnnouncementsService } from './forum-announcements.service';
import { authInterceptor } from './auth.interceptor';
import { SessionService, sessionFetcher } from './session.service';

/**
 * End-to-end through the REAL ForumService with the response bodies
 * forum-bff-api's ForumController actually sends (hugmesh-forum-ui#19): the
 * components must render what the envelopes carry. Without the envelope unwrap
 * the index threw "t[Symbol.iterator] is not a function" and listed nothing.
 */
const BFF_CATEGORIES = {
  categories: [
    { id: 2, name: 'Your first forum', description: 'Description of your first forum.', topicCount: 1 },
    { id: 3, name: 'Off-topic', description: 'Anything else.', topicCount: 0 },
  ],
};

describe('forum-bff envelopes through the real ForumService', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    spyOn(sessionFetcher, 'fetch').and.rejectWith(new Error('offline'));
    const ann = jasmine.createSpyObj<ForumAnnouncementsService>('ForumAnnouncementsService', ['load']);
    (ann as unknown as { visible: ReturnType<typeof signal> }).visible = signal([]);
    ann.load.and.resolveTo();
    await TestBed.configureTestingModule({
      imports: [ForumIndexComponent, TopicsListComponent, CreateTopicComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: ForumAnnouncementsService, useValue: ann },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => '2' }), snapshot: { paramMap: { get: () => '2' } } } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
    fixture.detectChanges();
  }

  it('the forum index lists the categories of the {categories} envelope', async () => {
    const fixture = TestBed.createComponent(ForumIndexComponent);
    fixture.detectChanges();
    http.expectOne('/bff/forum/categories').flush(BFF_CATEGORIES);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const names = Array.from(el.querySelectorAll('.forum-category__name')).map((n) => n.textContent);
    expect(names).toEqual(['Your first forum', 'Off-topic']);
    expect(el.querySelector('.forum-error')).toBeNull();
    // ForumDto.Category has no postCount: the index must not print "undefined posts".
    const stats = el.querySelector('.forum-category__stats')!.textContent ?? '';
    expect(stats).toContain('1 topics');
    expect(stats).not.toContain('posts');
    expect(stats).not.toContain('undefined');
  });

  it('the new-topic picker offers the categories of the {categories} envelope', async () => {
    TestBed.inject(SessionService).set({
      id: 'casdoor:alice', label: 'alice', provider: 'oidc', roles: ['forum'], registrationComplete: true,
    });
    const fixture = TestBed.createComponent(CreateTopicComponent);
    fixture.detectChanges();
    http.expectOne('/bff/forum/categories').flush(BFF_CATEGORIES);
    await settle(fixture);
    const options = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('select option')).map((o) => o.textContent?.trim());
    expect(options).toContain('Your first forum');
    expect(options).toContain('Off-topic');
  });

  it('the topic list renders the topics of the {topics} envelope', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo({
      ok: true,
      status: 200,
      json: async () => ({
        topics: [
          { id: 1, categoryId: 2, title: 'Welcome to phpBB3', authorSubject: 'casdoor:alice', replyCount: 4, createdAt: '2026-09-01T10:00:00Z' },
        ],
      }),
    } as Response);
    const fixture = TestBed.createComponent(TopicsListComponent);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.forum-topic-row').length).toBe(1);
    expect(el.querySelector('.forum-topic-row__title')!.textContent).toContain('Welcome to phpBB3');
    expect(el.querySelector('[data-testid="topics-page"]')!.textContent).toContain('Page 1 of 1');
  });
});

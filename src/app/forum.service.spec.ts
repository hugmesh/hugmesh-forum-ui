import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ForumService, FORUM_BASE_URL } from './forum.service';
import { authInterceptor } from './auth.interceptor';
import { SessionService, HugSession, sessionFetcher } from './session.service';
import { STEP_UP_SIGNAL_HEADER, StepUpRequiredError, isStepUpRequiredError } from './step-up';

function makeSession(over: Partial<HugSession> = {}): HugSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice',
    provider: 'google',
    roles: ['user'],
    registrationComplete: true,
    ...over,
  };
}

/** Response bodies exactly as forum-bff-api's ForumController answers them
 *  (hugmesh-forum-bff-api 7fa8ba1; the categories body is the one measured live
 *  in hugmesh-forum-ui#19). */
const BFF_CATEGORIES = {
  categories: [
    { id: 2, name: 'Your first forum', description: 'Description of your first forum.', topicCount: 1 },
    { id: 3, name: 'Off-topic', description: 'Anything else.', topicCount: 0 },
  ],
};
const BFF_TOPIC = {
  id: 1,
  categoryId: 2,
  title: 'Welcome to phpBB3',
  authorSubject: 'casdoor:alice',
  replyCount: 4,
  createdAt: '2026-09-01T10:00:00Z',
};
function bffTopics(n: number) {
  return {
    topics: Array.from({ length: n }, (_, i) => ({
      ...BFF_TOPIC,
      id: i + 1,
      title: `Topic ${i + 1}`,
      replyCount: i,
      createdAt: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
    })),
  };
}
const BFF_REPLY = {
  id: 11,
  topicId: 1,
  authorSubject: 'casdoor:bob',
  body: '<p>hello</p>',
  createdAt: '2026-09-02T10:00:00Z',
};

describe('ForumService', () => {
  let service: ForumService;
  let session: SessionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    // The real SessionService probes GET /bff/session (plain fetch, not HttpClient)
    // on construction; no BFF here, so it falls back to the mirror set() writes.
    spyOn(sessionFetcher, 'fetch').and.rejectWith(new Error('offline'));
    TestBed.configureTestingModule({
      // The spec-covered reads/writes now delegate to the generated ng-openapi-gen
      // client (Angular HttpClient), so the service is exercised through
      // HttpTestingController instead of a fetch() spy. The authInterceptor —
      // wired here exactly as it is in src/bootstrap.ts — marks each request
      // withCredentials so the HttpOnly bff_ cookie rides to the BFF (the browser
      // sends NO Authorization bearer). The wire paths and same-origin behaviour
      // are unchanged (the generated rootUrl is '').
      providers: [
        ForumService,
        SessionService,
        { provide: FORUM_BASE_URL, useValue: '' },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    session = TestBed.inject(SessionService);
    service = TestBed.inject(ForumService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('lists categories against the same-origin /bff/forum path', async () => {
    const result = service.listCategories();
    const req = httpMock.expectOne('/bff/forum/categories');
    expect(req.request.method).toBe('GET');
    req.flush(BFF_CATEGORIES);
    const cats = await result;
    expect(cats.length).toBe(2);
    expect(cats[0]).toEqual(jasmine.objectContaining({ id: 2, name: 'Your first forum', topicCount: 1 }));
    expect(Array.isArray(cats)).toBeTrue();
  });

  it('still accepts a bare category array (defensive)', async () => {
    const result = service.listCategories();
    httpMock.expectOne('/bff/forum/categories').flush([{ id: 1, name: 'General' }]);
    expect((await result).map((c) => c.id)).toEqual([1]);
  });

  it('resolves an empty list when the categories call fails', async () => {
    const result = service.listCategories();
    httpMock.expectOne('/bff/forum/categories').flush('x', { status: 500, statusText: 'Error' });
    expect(await result).toEqual([]);
  });

  it('getCategory resolves from the category list (the BFF has no /categories/{id})', async () => {
    const found = service.getCategory(3);
    httpMock.expectOne('/bff/forum/categories').flush(BFF_CATEGORIES);
    expect((await found)?.name).toBe('Off-topic');
    const missing = service.getCategory(99);
    httpMock.expectOne('/bff/forum/categories').flush(BFF_CATEGORIES);
    expect(await missing).toBeNull();
  });

  describe('fetch-backed reads (topics)', () => {
    function stubFetch(body: unknown, ok = true): jasmine.Spy {
      const res = { ok, status: ok ? 200 : 404, json: async () => body } as Response;
      const existing = globalThis.fetch as unknown as jasmine.Func;
      if (jasmine.isSpy(existing)) return (existing as unknown as jasmine.Spy).and.resolveTo(res);
      return spyOn(globalThis, 'fetch').and.resolveTo(res);
    }

    it('listTopics maps the {topics} envelope into a Page and echoes page/pageSize', async () => {
      const f = stubFetch(bffTopics(3));
      const page = await service.listTopics(2, { page: 1, pageSize: 20, sort: 'oldest' });
      expect(String(f.calls.mostRecent().args[0])).toContain('/bff/forum/topics?categoryId=2');
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(20);
      expect(page.total).toBe(3);
      expect(page.items.map((t) => t.id)).toEqual([1, 2, 3]);
      // BFF fields pass through; fields the BFF never sends get safe defaults.
      expect(page.items[0]).toEqual(jasmine.objectContaining({
        categoryId: 2, title: 'Topic 1', authorSubject: 'casdoor:alice', authorLabel: 'casdoor:alice',
        replyCount: 0, locked: false,
      }));
      expect(page.items[0].lastPostAt).toBe(page.items[0].createdAt);
    });

    it('listTopics pages and sorts client-side (the BFF only reads categoryId)', async () => {
      stubFetch(bffTopics(25));
      const latest = await service.listTopics(2, { page: 1, pageSize: 10, sort: 'latest' });
      expect(latest.total).toBe(25);
      expect(latest.items.length).toBe(10);
      expect(latest.items[0].id).toBe(25);
      stubFetch(bffTopics(25));
      const last = await service.listTopics(2, { page: 3, pageSize: 10, sort: 'oldest' });
      expect(last.items.map((t) => t.id)).toEqual([21, 22, 23, 24, 25]);
      stubFetch(bffTopics(25));
      const hot = await service.listTopics(2, { sort: 'replies' });
      expect(hot.items[0].replyCount).toBe(24);
    });

    it('listTopics resolves an empty page when the call fails', async () => {
      stubFetch({}, false);
      expect(await service.listTopics(2)).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });

    it('getTopic bridges {topic, replies} to {topic, posts}', async () => {
      stubFetch({ topic: BFF_TOPIC, replies: [BFF_REPLY] });
      const d = await service.getTopic(1);
      expect(d.topic.id).toBe(1);
      expect(d.topic.title).toBe('Welcome to phpBB3');
      expect(d.posts.length).toBe(1);
      expect(d.posts[0]).toEqual(jasmine.objectContaining({
        id: 11, topicId: 1, authorSubject: 'casdoor:bob', authorLabel: 'casdoor:bob',
        bodyHtml: '<p>hello</p>', editedAt: null,
      }));
    });

    it('getTopic rejects the dark-seam body {topic: {}, replies: []} instead of returning a topic with no id', async () => {
      stubFetch({ topic: {}, replies: [] });
      await expectAsync(service.getTopic(1)).toBeRejected();
    });
  });

  it('sends the HttpOnly bff_ cookie (withCredentials) and NO Authorization bearer', async () => {
    session.set(makeSession());
    const result = service.listCategories();
    const req = httpMock.expectOne('/bff/forum/categories');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush([]);
    await result;
  });

  it('POSTs a created topic as JSON', async () => {
    session.set(makeSession({ roles: ['user', 'forum'] }));
    const result = service.createTopic({ categoryId: 1, title: 'Hi', body: 'body' });
    const req = httpMock.expectOne('/bff/forum/topics');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ categoryId: 1, title: 'Hi', body: 'body' });
    req.flush({ topic: { ...BFF_TOPIC, id: 7 } });
    const topic = await result;
    expect(topic.id).toBe(7);
  });

  it('rejects createTopic when the BFF answers the 202 pending body (nothing was created)', async () => {
    session.set(makeSession({ roles: ['forum'] }));
    const result = service.createTopic({ categoryId: 1, title: 'Hi', body: 'body' });
    httpMock.expectOne('/bff/forum/topics').flush({ state: 'pending', note: 'dark' }, { status: 202, statusText: 'Accepted' });
    await expectAsync(result).toBeRejected();
  });

  it('createReply unwraps {reply} into a ForumPost', async () => {
    session.set(makeSession({ roles: ['forum'] }));
    const result = service.createReply({ topicId: 1, body: 'hi' });
    httpMock.expectOne('/bff/forum/topics/1/replies').flush({ reply: BFF_REPLY });
    const post = await result;
    expect(post.id).toBe(11);
    expect(post.bodyHtml).toBe('<p>hello</p>');
  });

  it('editPost unwraps {post} into a ForumPost', async () => {
    session.set(makeSession({ roles: ['forum'] }));
    const result = service.editPost(11, 'edited');
    httpMock.expectOne('/bff/forum/posts/11').flush({ post: { ...BFF_REPLY, body: 'edited' } });
    expect((await result).bodyHtml).toBe('edited');
  });

  it('moderateTopic POSTs a lock action to the moderation endpoint', async () => {
    session.set(makeSession({ roles: ['mod', 'forum'] }));
    const result = service.moderateTopic(10, 'lock');
    const req = httpMock.expectOne('/bff/forum/moderation/topics/10');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ action: 'lock' });
    req.flush({ moderated: 10, action: 'lock' });
    await expectAsync(result).toBeResolved();
  });

  it('moderateTopic carries an optional reason when given', async () => {
    session.set(makeSession({ roles: ['admin'] }));
    const result = service.moderateTopic(10, 'unlock', 'resolved');
    const req = httpMock.expectOne('/bff/forum/moderation/topics/10');
    expect(req.request.body).toEqual({ action: 'unlock', reason: 'resolved' });
    req.flush({ moderated: 10, action: 'unlock' });
    await result;
  });

  // ── step-up contract on the moderation path (issue #3 item 1) ──────────
  /** Run `call`, expect it to reject, and hand back the rejection. */
  async function rejection(call: Promise<unknown>): Promise<unknown> {
    try {
      await call;
    } catch (e) {
      return e;
    }
    throw new Error('expected the call to reject');
  }

  it('moderateTopic maps a 403 carrying X-Step-Up-Required to a StepUpRequiredError (structured signal)', async () => {
    session.set(makeSession({ roles: ['mod', 'forum'] }));
    const result = service.moderateTopic(10, 'lock');
    const req = httpMock.expectOne('/bff/forum/moderation/topics/10');
    req.flush(
      { error: 'moderation requires step-up re-authentication' },
      { status: 403, statusText: 'Forbidden', headers: { [STEP_UP_SIGNAL_HEADER]: 'X-Forum-StepUp' } },
    );
    const e = (await rejection(result)) as StepUpRequiredError;
    expect(e).toBeInstanceOf(StepUpRequiredError);
    expect(e.requirement).toEqual({ retryHeader: 'X-Forum-StepUp', via: 'signal' });
    expect(e.status).toBe(403);
  });

  it('moderateTopic maps a 403 whose body carries the legacy "requires step-up" phrase (old BFF)', async () => {
    session.set(makeSession({ roles: ['admin'] }));
    const result = service.moderateTopic(10, 'unlock');
    httpMock.expectOne('/bff/forum/moderation/topics/10')
      .flush({ error: 'unlock requires step-up re-authentication' }, { status: 403, statusText: 'Forbidden' });
    const e = (await rejection(result)) as StepUpRequiredError;
    expect(e).toBeInstanceOf(StepUpRequiredError);
    expect(e.requirement.via).toBe('legacy-phrase');
  });

  it('moderateTopic rethrows an ORDINARY 403 (a routine role DENY) untouched — no MFA prompt', async () => {
    session.set(makeSession({ roles: ['mod'] }));
    const result = service.moderateTopic(10, 'lock');
    httpMock.expectOne('/bff/forum/moderation/topics/10')
      .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    const e = await rejection(result);
    expect(e).toBeInstanceOf(HttpErrorResponse);
    expect(isStepUpRequiredError(e)).toBeFalse();
  });

  it('moderateTopic rethrows a 500 untouched even if a stray signal header is present', async () => {
    session.set(makeSession({ roles: ['admin'] }));
    const result = service.moderateTopic(10, 'lock');
    httpMock.expectOne('/bff/forum/moderation/topics/10')
      .flush({ error: 'boom' }, { status: 500, statusText: 'Error', headers: { [STEP_UP_SIGNAL_HEADER]: 'X-Forum-StepUp' } });
    const e = await rejection(result);
    expect(e).toBeInstanceOf(HttpErrorResponse);
    expect(isStepUpRequiredError(e)).toBeFalse();
  });

  // ── role-responsive gates (defence-in-depth; BFF is the real gate) ──
  it('canPost is false for a plain user without the forum role', () => {
    session.set(makeSession({ roles: ['user'] }));
    expect(service.canPost()).toBeFalse();
  });

  it('canPost is true when the user holds the forum role', () => {
    session.set(makeSession({ roles: ['user', 'forum'] }));
    expect(service.canPost()).toBeTrue();
  });

  it('canPost is true for an admin even without the forum role (gateway admin-bypass)', () => {
    session.set(makeSession({ roles: ['admin'] }));
    expect(service.canPost()).toBeTrue();
  });

  it('canModerate requires BOTH mod AND forum (a bare mod is not a forum moderator)', () => {
    session.set(makeSession({ roles: ['mod'] }));
    expect(service.canModerate()).toBeFalse();
    session.set(makeSession({ roles: ['mod', 'forum'] }));
    expect(service.canModerate()).toBeTrue();
  });

  it('ownsPost is true for the author subject and for an admin', () => {
    session.set(makeSession({ id: 'google:alice@gmail.com', roles: ['user', 'forum'] }));
    expect(service.ownsPost({ authorSubject: 'google:alice@gmail.com' })).toBeTrue();
    expect(service.ownsPost({ authorSubject: 'google:bob@gmail.com' })).toBeFalse();
    session.set(makeSession({ id: 'google:alice@gmail.com', roles: ['admin'] }));
    expect(service.ownsPost({ authorSubject: 'google:bob@gmail.com' })).toBeTrue();
  });
});

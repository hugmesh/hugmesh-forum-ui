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
    req.flush([{ id: 1, name: 'General' }]);
    const cats = await result;
    expect(cats.length).toBe(1);
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
    req.flush({ id: 7 });
    const topic = await result;
    expect(topic.id).toBe(7);
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

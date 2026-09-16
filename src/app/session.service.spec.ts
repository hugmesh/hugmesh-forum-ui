import { TestBed } from '@angular/core/testing';
import {
  HUG_SESSION_KEY,
  HugSession,
  SESSION_ENDPOINT,
  SESSION_OUT_ENDPOINT,
  SessionService,
  sessionFetcher,
} from './session.service';

function makeSession(over: Partial<HugSession> = {}): HugSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles: [],
    registrationComplete: false,
    ...over,
  };
}

/** A 200 JSON Response as the front door's user-bff /bff/session answers.
 *  ALWAYS hand the spy a FACTORY (`callFake(async () => okJson(...))`), never a
 *  single instance via `resolveTo`: every SessionService ever constructed in
 *  this file keeps its window listeners, so one broadcast fans out into several
 *  hydrate() calls, and a Response body can be read exactly once. */
function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function status(code: number): Response {
  return new Response(null, { status: code });
}

/** A few macrotask turns — enough for a fire-and-forget hydrate() that was
 *  NEVER going to fetch (the negative cases) to prove it did not. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Bounded wait for a fire-and-forget hydrate() to land: `Response.json()` on a
 *  real Response reads a stream, which can take a task, not just microtasks. */
async function until(cond: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
}

describe('SessionService', () => {
  let service: SessionService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    localStorage.clear();
    // Default transport: NO BFF reachable (the offline / mock-stack case). Every
    // pre-existing expectation below therefore exercises the mirror fallback —
    // hydrate() must be a no-op on failure.
    fetchSpy = spyOn(sessionFetcher, 'fetch').and.rejectWith(new Error('offline'));
    TestBed.configureTestingModule({ providers: [SessionService] });
    service = TestBed.inject(SessionService);
  });

  afterEach(() => localStorage.clear());

  it('starts logged-out when localStorage has no session', () => {
    expect(service.session()).toBeNull();
    expect(service.loggedIn()).toBeFalse();
    expect(service.isUser()).toBeFalse();
    expect(service.isAdmin()).toBeFalse();
    expect(service.isMod()).toBeFalse();
    expect(service.fullyRegistered()).toBeFalse();
  });

  it('isUser is true for any logged-in session (USER tier = every authed user)', () => {
    service.set(makeSession({ roles: [] }));
    expect(service.isUser()).toBeTrue();
    service.set(makeSession({ roles: ['user'] }));
    expect(service.isUser()).toBeTrue();
  });

  it('isMod is true for a "mod" role, an "admin" role, but not a plain "user"', () => {
    service.set(makeSession({ roles: ['user'] }));
    expect(service.isMod()).toBeFalse();
    service.set(makeSession({ roles: ['user', 'mod'] }));
    expect(service.isMod()).toBeTrue();
    service.set(makeSession({ roles: ['admin'] }));
    expect(service.isMod()).withContext('admin inherits the mod surface').toBeTrue();
  });

  it('enforces the tier invariant: a MOD never sees ADMIN, a USER never sees MOD/ADMIN', () => {
    // plain user
    service.set(makeSession({ roles: ['user'] }));
    expect(service.isUser()).toBeTrue();
    expect(service.isMod()).withContext('USER must not reach MOD tier').toBeFalse();
    expect(service.isAdmin()).withContext('USER must not reach ADMIN tier').toBeFalse();
    // moderator
    service.set(makeSession({ roles: ['user', 'mod'] }));
    expect(service.isMod()).toBeTrue();
    expect(service.isAdmin()).withContext('MOD must not reach ADMIN tier').toBeFalse();
    // admin
    service.set(makeSession({ roles: ['user', 'admin'] }));
    expect(service.isMod()).toBeTrue();
    expect(service.isAdmin()).toBeTrue();
  });

  it('hydrates an existing session from localStorage on construction', () => {
    localStorage.setItem('hug.session', JSON.stringify(makeSession({ roles: ['admin'] })));
    const fresh = TestBed.runInInjectionContext(() => new SessionService());
    expect(fresh.loggedIn()).toBeTrue();
    expect(fresh.isAdmin()).toBeTrue();
  });

  it('tolerates malformed JSON in localStorage and reports logged-out', () => {
    localStorage.setItem('hug.session', '{not valid json');
    const fresh = TestBed.runInInjectionContext(() => new SessionService());
    expect(fresh.session()).toBeNull();
    expect(fresh.loggedIn()).toBeFalse();
  });

  it('set() persists to localStorage and flips the derived signals', () => {
    service.set(makeSession({ roles: ['admin'], registrationComplete: true }));
    expect(service.loggedIn()).toBeTrue();
    expect(service.isAdmin()).toBeTrue();
    expect(service.fullyRegistered()).toBeTrue();
    expect(JSON.parse(localStorage.getItem('hug.session')!).roles).toEqual(['admin']);
  });

  it('never persists a Matrix/Mastodon homeserver token (browser holds only the bff_ cookie)', () => {
    service.set(makeSession({ registrationComplete: true }));
    const persisted = JSON.parse(localStorage.getItem('hug.session')!);
    expect('matrix' in persisted).withContext('no matrix token in the session').toBeFalse();
    expect('mastodon' in persisted).withContext('no mastodon token in the session').toBeFalse();
  });

  it('isAdmin only when the roles array includes "admin"', () => {
    service.set(makeSession({ roles: ['user'] }));
    expect(service.isAdmin()).toBeFalse();
    service.set(makeSession({ roles: ['user', 'admin'] }));
    expect(service.isAdmin()).toBeTrue();
  });

  it('clear() removes the session from localStorage and resets the signal', async () => {
    service.set(makeSession());
    await service.clear();
    expect(service.session()).toBeNull();
    expect(localStorage.getItem('hug.session')).toBeNull();
  });

  it('re-reads localStorage when another in-page instance broadcasts a change', () => {
    expect(service.loggedIn()).toBeFalse();
    localStorage.setItem('hug.session', JSON.stringify(makeSession({ roles: ['admin'] })));
    window.dispatchEvent(new Event('hug-session-change'));
    // Synchronous adoption of the mirror: no anonymous flash while the
    // authoritative re-read is in flight.
    expect(service.isAdmin()).toBeTrue();
  });

  // ── The cookie session (issue #3 item 2, first slice): GET /bff/session ─────

  describe('hydrate() — the authoritative GET /bff/session', () => {
    it('probes /bff/session with the cookie on construction', () => {
      expect(fetchSpy).toHaveBeenCalledWith(
        SESSION_ENDPOINT,
        jasmine.objectContaining({ credentials: 'include' }),
      );
    });

    it('a 200 updates the in-memory roles but NEVER writes the localStorage mirror', async () => {
      // A stale mirror (plain user) the server has since promoted to admin.
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['user'] })));
      fetchSpy.and.callFake(async () => 
        okJson({ id: 'google:alice@gmail.com', provider: 'google', handle: 'alice',
                 registrationComplete: true, roles: ['user', 'admin'] }),
      );

      const result = await service.hydrate();

      expect(service.isAdmin()).withContext('in-memory reflects the fresh role').toBeTrue();
      expect(result?.roles).toEqual(['user', 'admin']);
      expect(result?.registrationComplete).toBeTrue();
      // login-ui owns the mirror: this remote updates the signal ONLY.
      const mirror = JSON.parse(localStorage.getItem(HUG_SESSION_KEY)!);
      expect(mirror.roles).withContext('mirror is NOT rewritten by hydrate').toEqual(['user']);
    });

    it('a body WITHOUT id/label (admin-bff shape) keeps the last-known identity — ownsPost needs the id', async () => {
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ id: 'google:alice@gmail.com', label: 'alice', roles: ['user'] })));
      fetchSpy.and.callFake(async () => okJson({ roles: ['user', 'forum'], registrationComplete: true, mfaSatisfied: false }));

      const s = (await service.hydrate())!;

      expect(s.id).toBe('google:alice@gmail.com');
      expect(s.label).toBe('alice');
      expect(s.provider).toBe('google');
      expect(s.roles).toEqual(['user', 'forum']);
    });

    it('a body WITH id (front-door user-bff shape) makes the id authoritative and labels from handle', async () => {
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ id: 'stale:id', label: 'stale' })));
      fetchSpy.and.callFake(async () => okJson({ id: 'password:bob', provider: 'password', handle: 'bob',
                                      registrationComplete: false, roles: ['user'] }));

      const s = (await service.hydrate())!;

      expect(s.id).toBe('password:bob');
      expect(s.label).toBe('bob');
      expect(s.provider).toBe('password');
      expect(s.registrationComplete).toBeFalse();
    });

    it('a cookie-only session with NO mirror at all hydrates from the body alone', async () => {
      expect(service.loggedIn()).toBeFalse();
      fetchSpy.and.callFake(async () => okJson({ id: 'password:bob', handle: 'bob', registrationComplete: true, roles: ['user', 'forum'] }));

      await service.hydrate();

      expect(service.loggedIn()).toBeTrue();
      expect(service.session()!.id).toBe('password:bob');
      expect(localStorage.getItem(HUG_SESSION_KEY)).withContext('still no mirror write').toBeNull();
    });

    it('an EMPTY roles array is honoured as revocation; an ABSENT roles field is malformed and keeps the mirror', async () => {
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['forum'] })));
      fetchSpy.and.callFake(async () => okJson({ id: 'google:alice@gmail.com', roles: [], registrationComplete: true }));
      await service.hydrate();
      expect(service.session()!.roles).withContext('empty => revoked').toEqual([]);

      fetchSpy.and.callFake(async () => okJson({ id: 'google:alice@gmail.com', registrationComplete: true }));
      const r = await service.hydrate();
      expect(r).toBeNull();
      expect(service.session()!.roles).withContext('absent => rejected, mirror restored').toEqual(['forum']);
    });

    it('a fetch REJECTION retains the seeded localStorage session (never clobbers to anonymous)', async () => {
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['user'] })));
      fetchSpy.and.rejectWith(new Error('offline'));

      const result = await service.hydrate();

      expect(result).toBeNull();
      expect(service.loggedIn()).withContext('seeded session survives a failed probe').toBeTrue();
      expect(localStorage.getItem(HUG_SESSION_KEY)).not.toBeNull();
    });

    it('a 401 (expired cookie) and a 503 (user-bff dark) both retain the seeded session', async () => {
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['user', 'mod'] })));
      fetchSpy.and.callFake(async () => status(401));
      expect(await service.hydrate()).toBeNull();
      expect(service.isMod()).withContext('a 401 does not drop the known session').toBeTrue();

      fetchSpy.and.callFake(async () => status(503));
      expect(await service.hydrate()).toBeNull();
      expect(service.isMod()).withContext('a dark 503 does not drop the known session').toBeTrue();
    });
  });

  // ── Broadcast handling: sign-in re-hydrates, sign-out never does ────────────

  describe('hug-session-change broadcast', () => {
    it('a broadcast that leaves a mirror behind (sign-in / role change) re-hydrates from /bff/session', async () => {
      fetchSpy.calls.reset();
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['user'] })));
      fetchSpy.and.callFake(async () => okJson({ id: 'google:alice@gmail.com', roles: ['user', 'admin'], registrationComplete: true }));

      window.dispatchEvent(new Event('hug-session-change'));
      expect(service.isAdmin()).withContext('the mirror is adopted synchronously first').toBeFalse();
      await until(() => service.isAdmin());

      expect(fetchSpy).toHaveBeenCalledWith(SESSION_ENDPOINT, jasmine.anything());
      expect(service.isAdmin()).withContext('server roles win over the stale mirror').toBeTrue();
    });

    it('a broadcast with the mirror GONE (sign-out) drops to anonymous WITHOUT re-reading /bff/session', async () => {
      // The race this guards: login-ui posts /bff/sessionOut fire-and-forget,
      // removes the mirror and broadcasts. A re-read of /bff/session at that
      // instant can still see the live cookie and would restore the session.
      service.set(makeSession({ roles: ['admin'] }));
      fetchSpy.calls.reset();
      fetchSpy.and.callFake(async () => okJson({ id: 'google:alice@gmail.com', roles: ['admin'], registrationComplete: true }));

      localStorage.removeItem(HUG_SESSION_KEY);
      window.dispatchEvent(new Event('hug-session-change'));
      await settle();

      expect(service.session()).toBeNull();
      expect(fetchSpy).withContext('no /bff/session probe on a sign-out broadcast').not.toHaveBeenCalled();
    });
  });

  // ── Real logout, in the right ORDER ────────────────────────────────────────

  describe('clear() — the real logout', () => {
    it('POSTs /bff/sessionOut with the cookie BEFORE dropping the mirror, and stays signed out afterwards', async () => {
      // A STATEFUL server: /bff/session 200s while the session is alive and
      // 401s once sessionOut has landed. (A "fetch was called" assertion alone
      // would pass a fire-and-forget post that still loses the race.)
      let alive = true;
      let mirrorAtSessionOut: string | null = 'unset';
      fetchSpy.and.callFake(async (url: string, init?: RequestInit) => {
        if (url === SESSION_OUT_ENDPOINT) {
          expect(init?.method).toBe('POST');
          expect(init?.credentials).toBe('include');
          mirrorAtSessionOut = localStorage.getItem(HUG_SESSION_KEY);
          alive = false;
          return okJson({ loggedOut: true });
        }
        if (url === SESSION_ENDPOINT) {
          return alive
            ? okJson({ id: 'google:alice@gmail.com', roles: ['admin'], registrationComplete: true })
            : status(401);
        }
        throw new Error(`unexpected ${url}`);
      });
      service.set(makeSession({ roles: ['admin'] }));
      await service.hydrate();
      expect(service.isAdmin()).toBeTrue();

      await service.clear();
      await settle();

      expect(mirrorAtSessionOut).withContext('the server session is expired FIRST, while the mirror still exists').not.toBeNull();
      expect(localStorage.getItem(HUG_SESSION_KEY)).toBeNull();
      expect(service.session()).withContext('the broadcast our own clear() fires cannot restore the session').toBeNull();
    });

    it('still signs out locally when /bff/sessionOut is unreachable (best-effort on the RESULT, not the ORDER)', async () => {
      fetchSpy.and.rejectWith(new Error('offline'));
      service.set(makeSession());

      await service.clear();

      expect(fetchSpy).toHaveBeenCalledWith(SESSION_OUT_ENDPOINT, jasmine.objectContaining({ method: 'POST' }));
      expect(service.session()).toBeNull();
      expect(localStorage.getItem(HUG_SESSION_KEY)).toBeNull();
    });
  });
});

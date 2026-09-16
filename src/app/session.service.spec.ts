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

/** A hand-resolved promise: lets a spec hold a /bff/session probe IN FLIGHT
 *  while something else (a sign-out broadcast, a newer probe) changes the
 *  session underneath it, then answer the stale probe on cue. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** The front door's 200 for the signed-in admin used by the race specs. */
function aliceAdmin(): Response {
  return okJson({ id: 'google:alice@gmail.com', provider: 'oidc', handle: 'alice', registrationComplete: true, roles: ['admin'] });
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

  // ── A probe already IN FLIGHT when the session changes underneath it ────────

  describe('hydrate() supersession — a probe in flight across a session change', () => {
    it('a probe in flight when a sign-out broadcast lands is DISCARDED: its 200 must not resurrect the session', async () => {
      // The second door of the sign-out race: the broadcast guard above stops a
      // NEW probe, but a probe started at construction (or by an earlier
      // broadcast) is still pending when login-ui removes the mirror. login-ui's
      // sessionOut is fire-and-forget, so that probe is answered 200 with the
      // still-live cookie a tick later.
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['admin'] })));
      const probe = deferred<Response>();
      fetchSpy.calls.reset();
      fetchSpy.and.callFake(() => probe.promise);
      const fresh = TestBed.runInInjectionContext(() => new SessionService());
      expect(fresh.isAdmin()).withContext('seeded synchronously from the mirror').toBeTrue();
      expect(fetchSpy).withContext('construction probe is in flight').toHaveBeenCalledTimes(1);

      // login-ui signs out: mirror gone + broadcast, while our probe is pending.
      localStorage.removeItem(HUG_SESSION_KEY);
      window.dispatchEvent(new Event('hug-session-change'));
      expect(fresh.session()).toBeNull();

      // Now the stale probe is answered — with the cookie that was still alive.
      probe.resolve(aliceAdmin());
      await settle();

      expect(fresh.session()).withContext('a stale probe must not resurrect a signed-out session').toBeNull();
      expect(fetchSpy).withContext('the sign-out broadcast itself started no probe').toHaveBeenCalledTimes(1);
    });

    it('a probe superseded by a sign-in broadcast cannot overwrite the NEWER probe\'s roles with its stale 200', async () => {
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['user'] })));
      const slow = deferred<Response>();
      fetchSpy.and.callFake(() => slow.promise);
      const fresh = TestBed.runInInjectionContext(() => new SessionService()); // probe #1 pending

      // A role grant lands: login-ui rewrites the mirror and broadcasts; probe #2
      // (fast) answers with the granted role.
      fetchSpy.and.callFake(async () => okJson({ id: 'google:alice@gmail.com', roles: ['user', 'admin'], registrationComplete: true }));
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['user', 'admin'] })));
      window.dispatchEvent(new Event('hug-session-change'));
      await until(() => fresh.isAdmin());
      expect(fresh.isAdmin()).toBeTrue();

      // Probe #1 finally answers with the PRE-grant truth.
      slow.resolve(okJson({ id: 'google:alice@gmail.com', roles: ['user'], registrationComplete: true }));
      await settle();

      expect(fresh.isAdmin()).withContext('the older probe must not roll the newer roles back').toBeTrue();
    });

    it('a superseded probe that FAILS does not restore the mirror over the newer probe\'s roles', async () => {
      // The failure fallback re-reads the mirror; if the stale probe were allowed
      // to do that AFTER a newer probe landed, a mirror that lags the server
      // (login-ui wrote ['user']; the server already says admin) would win.
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['user'] })));
      const slow = deferred<Response>();
      fetchSpy.and.callFake(() => slow.promise);
      const fresh = TestBed.runInInjectionContext(() => new SessionService()); // probe #1 pending

      fetchSpy.and.callFake(async () => okJson({ id: 'google:alice@gmail.com', roles: ['user', 'admin'], registrationComplete: true }));
      window.dispatchEvent(new Event('hug-session-change')); // mirror still ['user']; probe #2 says admin
      await until(() => fresh.isAdmin());
      expect(fresh.isAdmin()).toBeTrue();

      slow.reject(new Error('network reset'));
      await settle();

      expect(fresh.isAdmin()).withContext('a stale failure must not fall back to the lagging mirror').toBeTrue();
    });

    it('a probe in flight when a CROSS-TAB sign-out (storage event) lands is discarded too', async () => {
      // Another tab's login-ui cleared the mirror; this tab adopts the sign-out
      // from the storage event (no fetch in a background tab) — and a probe it
      // already had in flight must not resurrect the session with a 200.
      localStorage.setItem(HUG_SESSION_KEY, JSON.stringify(makeSession({ roles: ['admin'] })));
      const probe = deferred<Response>();
      fetchSpy.and.callFake(() => probe.promise);
      const fresh = TestBed.runInInjectionContext(() => new SessionService());
      expect(fresh.isAdmin()).toBeTrue();

      localStorage.removeItem(HUG_SESSION_KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: HUG_SESSION_KEY, oldValue: '{}', newValue: null }));
      expect(fresh.session()).withContext('cross-tab sign-out adopted from the storage event').toBeNull();

      probe.resolve(aliceAdmin());
      await settle();

      expect(fresh.session()).withContext('a stale probe must not resurrect a cross-tab sign-out').toBeNull();
    });
  });

  // ── Real logout, in the right ORDER ────────────────────────────────────────

  describe('clear() — the real logout', () => {
    it('POSTs /bff/sessionOut and AWAITS it before dropping the mirror or broadcasting — a sibling re-reading /bff/session on the broadcast finds the cookie already dead', async () => {
      // A STATEFUL server: /bff/session 200s while the session is alive and
      // 401s once sessionOut has landed. The server takes a ROUND TRIP to expire
      // the row, so `alive` flips after a macrotask, not synchronously inside the
      // call: a fire-and-forget post has the right CALL order and still loses
      // the race, and only the missing `await` distinguishes the two.
      let alive = true;
      let mirrorAtSessionOut: string | null = 'unset';
      fetchSpy.and.callFake(async (url: string, init?: RequestInit) => {
        if (url === SESSION_OUT_ENDPOINT) {
          expect(init?.method).toBe('POST');
          expect(init?.credentials).toBe('include');
          mirrorAtSessionOut = localStorage.getItem(HUG_SESSION_KEY);
          await new Promise((r) => setTimeout(r, 0)); // the server's round trip
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

      // A sibling instance (the host shell hydrates on every broadcast) re-reads
      // /bff/session the instant our sign-out broadcast lands. It must find the
      // cookie DEAD — that is the whole point of awaiting sessionOut.
      const siblingSaw: number[] = [];
      const sibling = () => {
        void sessionFetcher.fetch(SESSION_ENDPOINT, { credentials: 'include' }).then((r) => siblingSaw.push(r.status));
      };
      window.addEventListener('hug-session-change', sibling);
      try {
        await service.clear();
        await until(() => siblingSaw.length > 0);
      } finally {
        window.removeEventListener('hug-session-change', sibling);
      }

      expect(mirrorAtSessionOut).withContext('the server session is expired FIRST, while the mirror still exists').not.toBeNull();
      expect(siblingSaw).withContext('the sibling saw a LIVE cookie on the sign-out broadcast').toEqual([401]);
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

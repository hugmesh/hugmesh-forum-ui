import { Injectable, signal, computed } from '@angular/core';

/** The canonical localStorage key for the shared HugSession MIRROR, exported so
 *  other services (ForumService, ForumAnnouncementsService) read from a
 *  single source of truth instead of hardcoding the key themselves. */
export const HUG_SESSION_KEY = 'hug.session';

/** Same-origin front-door endpoint carrying the AUTHORITATIVE session for the
 *  HttpOnly `bff_` cookie. Relative: this remote is served same-origin behind the
 *  gateway, exactly like the host shell's `SESSION_ENDPOINT`. The front door
 *  routes it to user-bff (`SsoAuthController.session`, hugmesh-generator
 *  `specs/cluster/apps/20-gateway-fe.yaml` route `hugmesh-user-bff-api-session`),
 *  whose body is `{id, provider, handle, registrationComplete, roles}`. */
export const SESSION_ENDPOINT = '/bff/session';

/** Same-origin REAL logout (admin-bff `AuthController#sessionOut`): deletes the
 *  opaque `bff_session` row, EXPIRES the cookie, revokes the homeserver
 *  localparts. CSRF-exempt server-side. The SAME endpoint login-ui and the host
 *  shell post to. */
export const SESSION_OUT_ENDPOINT = '/bff/sessionOut';

export interface HugSession {
  id: string;                 // casdoor identity, e.g. google:alice@gmail.com
  label: string;              // display (email or discord handle)
  /** How the identity signed in. The social remotes persist 'google'/'discord';
   *  the native-login flow surfaces 'password'/'oidc' on GET /bff/session, so the
   *  union carries both families (same widening as the host shell's SnapSession). */
  provider: 'google' | 'discord' | 'password' | 'oidc';
  roles: string[];
  registrationComplete: boolean;
}

/**
 * The GET /bff/session body, tolerant of BOTH shapes the platform serves:
 *  - user-bff `SsoAuthController.session` (what the front door routes to):
 *    `{id, provider, handle, registrationComplete, roles}` — no `label`.
 *  - admin-bff `AuthController.session` (only reachable behind the /bff/**
 *    catch-all, never at the front door for this path):
 *    `{roles, registrationComplete, mfaSatisfied}` — no identity at all.
 * `roles` is the one LOAD-BEARING field; everything else falls back to the
 * last-known value (see {@link SessionService.hydrate}).
 */
export interface SessionResponse {
  id?: unknown;
  label?: unknown;
  handle?: unknown;
  provider?: unknown;
  roles?: unknown;
  registrationComplete?: unknown;
}

/** Transport indirection so specs stub the session probe without touching
 *  `globalThis.fetch` (same convention as `forumAnnouncementsFetcher`). */
export const sessionFetcher = {
  fetch(input: string, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  },
};

const PROVIDERS: ReadonlyArray<HugSession['provider']> = ['google', 'discord', 'password', 'oidc'];

function isProvider(v: unknown): v is HugSession['provider'] {
  return typeof v === 'string' && (PROVIDERS as ReadonlyArray<string>).includes(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

/**
 * Holds the logged-in session and derives the Casdoor-style role flags + the
 * registration-complete gate that unlocks the Matrix/Mastodon micro-frontends.
 *
 * <h3>Where the session comes from (issue #3, item 2 — first slice)</h3>
 * Auth ALWAYS rides in the HttpOnly `bff_` cookie; this service only holds the
 * NON-SECRET display/authorization metadata. Two sources feed it:
 * <ol>
 *   <li><b>The authoritative cookie session</b> — `GET /bff/session`
 *       ({@link SESSION_ENDPOINT}), read via {@link hydrate} on construction and
 *       on every same-document sign-in / role-change broadcast. This is the
 *       platform's cookie-session contract; the host shell already consumes it
 *       the same way.</li>
 *   <li><b>The `hug.session` localStorage MIRROR</b> — the fleet-wide, legacy
 *       session source. It seeds the signal synchronously (no anonymous flash)
 *       and is the FALLBACK whenever the probe fails (offline, a mock stack
 *       with no BFF, an e2e-seeded session, an expired cookie).</li>
 * </ol>
 * This remote is a READER of the mirror only. hugmesh-login-ui is the fleet's
 * sole writer of `hug.session` (nine remotes read it); {@link hydrate} NEVER
 * writes it and NEVER broadcasts, so it cannot ping-pong with the writer. The
 * mirror is still consulted because (a) `/bff/session` can be dark (user-bff
 * 503s while `app.bff.oidc.enabled=false`) and (b) the e2e harness seeds it
 * with no live cookie — dropping it entirely is the LAST box of issue #3, not
 * this one.
 *
 * <h3>Sign-out ordering</h3>
 * A same-document broadcast whose mirror is now EMPTY is a sign-out and is
 * adopted immediately, WITHOUT a re-hydrate: the platform's login-ui
 * `clear()` posts `/bff/sessionOut` fire-and-forget before clearing the mirror,
 * so a re-read of `/bff/session` at that instant can still see a live cookie
 * and would put the session straight back (the host-shell PR #14 defect,
 * reproduced here by design if we hydrated). Only a broadcast that leaves a
 * mirror behind (sign-in, role grant/revoke) triggers the authoritative re-read.
 *
 * Roles are the lowercase Casdoor roles 'user'/'mod'/'admin'; the bff-apis
 * enforce ROLE_USER/MOD/ADMIN server-side — these signals are defence-in-depth
 * so the UI never shows an option the role can't use.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly key = HUG_SESSION_KEY;
  private readonly channel = 'hug-session-change';
  readonly session = signal<HugSession | null>(this.load());
  readonly loggedIn = computed(() => this.session() !== null);

  /** USER tier: every authenticated user (the normal social view + self-actions).
   *  Casdoor always grants 'user'; we treat any logged-in session as the USER
   *  tier to match the user-bff-api hasRole('USER') gate. */
  readonly isUser = computed(() => this.loggedIn());

  /** ADMIN tier: only a Casdoor 'admin' role. */
  readonly isAdmin = computed(() => (this.session()?.roles ?? []).includes('admin'));

  /** MOD tier: a Casdoor 'mod' OR 'admin' role unlocks it, matching the
   *  mod-bff-api's defence-in-depth hasAnyRole('MOD','ADMIN'). Because isAdmin is
   *  false for a plain mod, the additive tiers keep the invariant: a MOD never
   *  sees the ADMIN tier, a USER never sees the MOD/ADMIN tier. */
  readonly isMod = computed(() => {
    const roles = this.session()?.roles ?? [];
    return roles.includes('mod') || roles.includes('admin');
  });

  /** Matrix/Mastodon are usable only after full registration completes. */
  readonly fullyRegistered = computed(() => this.session()?.registrationComplete === true);

  constructor() {
    // The host shell and each federated remote each hold their OWN SessionService
    // instance over the same session. Stay in sync so every nav/guard reading
    // this signal sees the current session — e.g. the login remote completing
    // registration must unlock the host shell's Matrix/Mastodon nav.
    if (typeof window !== 'undefined') {
      // Same-document broadcast: adopt the mirror NOW (sign-out lands
      // synchronously), then — only if a session remains — confirm it against
      // the cookie session so a mid-session role grant/revoke is picked up.
      window.addEventListener(this.channel, () => this.onBroadcast());
      // A cross-TAB write: the sibling tab already hydrated and login-ui wrote
      // the mirror, so re-reading the mirror suffices (no fetch in a background tab).
      window.addEventListener('storage', (e) => { if (e.key === this.key) this.session.set(this.load()); });
      // Bootstrap: the signal is already seeded synchronously from the mirror
      // (field initializer above); now confirm/refresh it against /bff/session so
      // a role changed since the mirror was written — or a cookie-only session
      // with no mirror at all — renders without a re-login.
      void this.hydrate();
    }
  }

  /**
   * Refresh the in-memory session from the authoritative `GET /bff/session`.
   *
   * On 200 with a usable body it maps the body into a {@link HugSession} and
   * updates the in-memory signal ONLY — it NEVER writes the localStorage mirror
   * (login-ui owns it) and NEVER broadcasts (a broadcast re-enters this very
   * method on every sibling instance).
   *
   * `roles` is LOAD-BEARING: an absent/non-array `roles` is an UNUSABLE body
   * (rejected as malformed → fallback), while a genuinely EMPTY array is honoured
   * as revocation — that is the whole point of hydrating. Identity fields fall
   * back to the last-known values: the front door's user-bff body carries `id`
   * and `handle` (no `label`); admin-bff's carries no identity at all, so a body
   * without `id` keeps the mirror's `id` — which is what `ForumService.ownsPost`
   * compares against `post.authorSubject`.
   *
   * On ANY failure — network error, non-2xx (INCLUDING a 401 and user-bff's
   * dark 503), or an unusable body — it falls back to the mirror and returns
   * null. e2e harnesses / mock stacks seed the mirror with no live BFF, so a
   * failed probe must NEVER clobber a seeded session.
   */
  async hydrate(): Promise<HugSession | null> {
    try {
      const res = await sessionFetcher.fetch(SESSION_ENDPOINT, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`session ${res.status}`);
      const body = (await res.json()) as SessionResponse | null;
      if (!body || !Array.isArray(body.roles)) {
        throw new Error('session body missing roles');
      }
      const next = this.fromBody(body, body.roles);
      this.session.set(next);
      return next;
    } catch {
      // A failed probe (offline, dark user-bff, expired cookie, malformed body)
      // must never wipe a seeded/known session — re-read the mirror instead.
      this.session.set(this.load());
      return null;
    }
  }

  /** Map a `/bff/session` body onto HugSession: `roles` + `registrationComplete`
   *  are authoritative; identity/display fields fall back to the last-known
   *  session (in-memory, else the mirror). */
  private fromBody(body: SessionResponse, roles: unknown[]): HugSession {
    const current = this.session() ?? this.load();
    const id = nonEmptyString(body.id) ? body.id : (current?.id ?? '');
    const label = [body.label, body.handle, current?.label, id].find(nonEmptyString) ?? '';
    const provider = isProvider(body.provider) ? body.provider : (current?.provider ?? 'oidc');
    return {
      id,
      label,
      provider,
      roles: roles.filter((r): r is string => typeof r === 'string'),
      registrationComplete: body.registrationComplete === true,
    };
  }

  private onBroadcast(): void {
    const mirror = this.load();
    this.session.set(mirror);
    if (mirror) void this.hydrate();
  }

  private load(): HugSession | null {
    try { const raw = localStorage.getItem(this.key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }

  /** Write the mirror + signal and broadcast. NOT called by this remote in
   *  production (login-ui is the mirror's sole writer); kept as the unit/e2e
   *  seeding seam and for API compatibility with the sibling remotes. */
  set(s: HugSession): void { localStorage.setItem(this.key, JSON.stringify(s)); this.session.set(s); this.broadcast(); }
  patch(p: Partial<HugSession>): void { const s = this.session(); if (s) this.set({ ...s, ...p }); }

  /**
   * Sign out. EXPIRES THE SERVER SESSION FIRST, and AWAITS it.
   *
   * Dropping client state alone does not log anyone out: the HttpOnly
   * `bff_session` cookie survives, and the very broadcast below makes every
   * sibling instance (the host shell hydrates on it) re-read `/bff/session`
   * WITH that still-valid cookie, get a 200, and restore the session a tick
   * later. Best-effort on the RESULT (an already-dead cookie 401s, an offline
   * browser throws — neither may strand the user signed-in locally) but NOT on
   * the ORDER: the `await` guarantees the cookie is dead before anything can
   * re-read it. Not called by this remote's own UI today (the host owns sign-out);
   * it is correct if anything ever wires it.
   */
  async clear(): Promise<void> {
    try {
      await sessionFetcher.fetch(SESSION_OUT_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
    } catch {
      // Deliberately swallowed — local sign-out must still happen when the network is down.
    }
    localStorage.removeItem(this.key);
    this.session.set(null);
    this.broadcast();
  }

  /** Notify the other in-page SessionService instances (host + remotes) to re-read. */
  private broadcast(): void { if (typeof window !== 'undefined') window.dispatchEvent(new Event(this.channel)); }
}

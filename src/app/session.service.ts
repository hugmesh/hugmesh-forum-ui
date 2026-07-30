import { Injectable, signal, computed } from '@angular/core';

/** The canonical localStorage key for the shared HugSession, exported so
 *  other services (ForumService, ForumAnnouncementsService) read from a
 *  single source of truth instead of hardcoding the key themselves. */
export const HUG_SESSION_KEY = 'hug.session';

export interface HugSession {
  id: string;                 // casdoor identity, e.g. google:alice@gmail.com
  label: string;              // display (email or discord handle)
  provider: 'google' | 'discord';
  roles: string[];
  registrationComplete: boolean;
}

/** Holds the logged-in session (persisted to localStorage) and derives the
 *  Casdoor-style role flags + the registration-complete gate that unlocks the
 *  Matrix/Mastodon micro-frontends.
 *
 *  This is the canonical HugMesh SessionService (copied from hugmesh-mod-ui,
 *  the reference with BOTH role-tier accessors) so this remote's role-tiered
 *  action surfaces gate on the SAME JWT-derived signals as hugmesh-admin-ui /
 *  hugmesh-mod-ui. Roles are the lowercase Casdoor roles 'user'/'mod'/'admin';
 *  the bff-apis enforce ROLE_USER/MOD/ADMIN server-side — these signals are
 *  defence-in-depth so the UI never shows an option the role can't use. */
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
    // instance over the same localStorage key. Re-read on a same-document broadcast
    // (dispatched by whichever instance wrote) and on cross-tab storage events, so
    // every nav/guard reading this signal stays in sync — e.g. the login remote
    // completing registration must unlock the host shell's Matrix/Mastodon nav.
    if (typeof window !== 'undefined') {
      window.addEventListener(this.channel, () => this.session.set(this.load()));
      window.addEventListener('storage', (e) => { if (e.key === this.key) this.session.set(this.load()); });
    }
  }

  private load(): HugSession | null {
    try { const raw = localStorage.getItem(this.key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  set(s: HugSession): void { localStorage.setItem(this.key, JSON.stringify(s)); this.session.set(s); this.broadcast(); }
  patch(p: Partial<HugSession>): void { const s = this.session(); if (s) this.set({ ...s, ...p }); }
  clear(): void { localStorage.removeItem(this.key); this.session.set(null); this.broadcast(); }
  /** Notify the other in-page SessionService instances (host + remotes) to re-read. */
  private broadcast(): void { if (typeof window !== 'undefined') window.dispatchEvent(new Event(this.channel)); }
}

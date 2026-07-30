import { Injectable, computed, inject, signal } from '@angular/core';

import { SessionService } from './session.service';
import { ForumAnnouncement } from './forum-announcement.model';

/** Same-origin admin-bff endpoint for the forum MAIN-page banner. The
 *  fe-gateway routes `/bff/*` to the BFFs (authenticated via the HttpOnly `bff_`
 *  cookie the request carries), so a relative same-origin path works in dev and
 *  prod alike. This endpoint already exists on admin-bff (target_forum
 *  announcements). */
export const FORUM_ANNOUNCEMENTS_ENDPOINT = '/bff/announcements/forum';

/** localStorage key holding the set of forum-announcement ids the user has
 *  dismissed (mirrors the host's per-id dismiss-once model). */
const DISMISSED_KEY = 'hug.forum.announcements.dismissed';

/** Indirected so unit tests can stub the network without touching native fetch. */
export const forumAnnouncementsFetcher = {
  fetch: (): Promise<ForumAnnouncement[]> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    // `credentials: 'include'` sends the HttpOnly `bff_` session cookie, which
    // the fe-gateway swaps into a server-side Bearer — the browser holds no token.
    return fetch(FORUM_ANNOUNCEMENTS_ENDPOINT, { method: 'GET', credentials: 'include', headers }).then((res) => {
      if (!res.ok) throw new Error(`forum announcements ${res.status}`);
      return res.json() as Promise<ForumAnnouncement[]>;
    });
  },
};

/**
 * Loads + holds the active FORUM main-page announcements and tracks which ones
 * the user has DISMISSED (persisted to localStorage, keyed by id — "dismiss
 * once", mirroring the host home banner). Only authenticated sessions fetch.
 *
 * The BFF returns ONLY active, forum-targeted announcements, so the service
 * trusts it and merely (a) re-sorts by priority defensively, (b) drops any
 * whose window has closed, and (c) filters out the locally-dismissed ids.
 * `visible()` is the banner's render gate.
 */
@Injectable({ providedIn: 'root' })
export class ForumAnnouncementsService {
  private readonly session = inject(SessionService);

  private readonly all = signal<ForumAnnouncement[]>([]);
  private readonly dismissed = signal<ReadonlySet<string>>(this.loadDismissed());
  readonly loadError = signal('');

  readonly visible = computed<readonly ForumAnnouncement[]>(() => {
    if (!this.session.loggedIn()) return [];
    const dismissed = this.dismissed();
    const now = Date.now();
    return this.all()
      .filter((a) => !dismissed.has(a.id) && this.withinWindow(a, now))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  });

  /**
   * Fetch the active forum announcements from the BFF and populate the
   * internal signal. No-ops when the session is not logged in (clears the
   * list instead). Sets {@link loadError} on failure so the template can
   * surface a non-fatal error without crashing.
   *
   * Calls GET /bff/announcements/forum (the admin-bff endpoint).
   */
  async load(): Promise<void> {
    if (!this.session.loggedIn()) {
      // No session: clear silently (the banner renders nothing).
      this.all.set([]);
      return;
    }
    try {
      const items = await forumAnnouncementsFetcher.fetch();
      this.all.set(Array.isArray(items) ? items : []);
      this.loadError.set('');
    } catch (err) {
      // Network or BFF error: degrade to empty rather than crash.
      this.all.set([]);
      this.loadError.set(err instanceof Error ? err.message : 'forum announcements load failed');
    }
  }

  /**
   * Mark announcement `id` as dismissed for this browser session. Non-
   * dismissible announcements (where `dismissible === false`) are silently
   * ignored — the dismiss control should already be hidden in the template.
   * The dismissed id set is written to localStorage so it survives a page
   * reload.
   *
   * @param id - The stable `uuid` of the announcement to dismiss.
   */
  dismiss(id: string): void {
    const target = this.all().find((a) => a.id === id);
    // Refuse to dismiss a pinned (non-dismissible) announcement.
    if (target && !target.dismissible) return;
    const next = new Set(this.dismissed());
    next.add(id);
    this.dismissed.set(next);
    this.persistDismissed(next);
  }

  /**
   * Whether announcement `a` is currently within its active time window.
   * Both `starts_at` and `ends_at` are optional (null = no bound). This is a
   * defensive re-check; the BFF already filters by window server-side.
   *
   * @param a - The announcement to check.
   * @param now - The current epoch milliseconds (passed in to avoid repeated `Date.now()` calls).
   * @returns `true` when the current time is within the announcement's window.
   */
  private withinWindow(a: ForumAnnouncement, now: number): boolean {
    const startsOk = !a.starts_at || Date.parse(a.starts_at) <= now;
    const endsOk = !a.ends_at || Date.parse(a.ends_at) >= now;
    return startsOk && endsOk;
  }

  /**
   * Load the persisted dismissed-id set from localStorage. Returns an empty
   * set on parse failure or when nothing is stored.
   *
   * @returns A `ReadonlySet<string>` of announcement ids the user has dismissed.
   */
  private loadDismissed(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      const ids = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set<string>();
    }
  }

  /**
   * Write the current dismissed-id set back to localStorage. Failures (quota
   * exceeded, private-browsing mode) are swallowed — the dismissal is still
   * held in-memory for the current page session.
   *
   * @param ids - The full set of dismissed announcement ids to persist.
   */
  private persistDismissed(ids: ReadonlySet<string>): void {
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
    } catch {
      // Storage unavailable: dismissal holds in-memory for the session.
    }
  }
}

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { FORUM_ROUTES } from './forum.routes';
import { ForumService } from './forum.service';
import { forumProfileRemoteLoader } from './forum-profile.component';
import { HUG_SESSION_KEY } from './session.service';

/**
 * DEAD-ENDPOINT GUARD (hugmesh-forum-ui#19, last item).
 *
 * forum-bff-api's ForumController maps /categories, /topics, /topics/{id},
 * /topics/{id}/replies and /posts/{id} — and NO /search. The UI used to ship a
 * search page whose only request was GET /bff/forum/search, a guaranteed 404
 * that the service hid behind an empty fallback. The search page, its route,
 * the "Search the forum" link and `ForumService.search()` are gone; this spec
 * keeps them gone until the BFF grows the endpoint:
 *
 *  1. the service exposes no search member;
 *  2. FORUM_ROUTES exposes no search route;
 *  3. every routed surface, rendered under the host mount with the REAL
 *     ForumService and both transports observed (`globalThis.fetch` and the
 *     generated HttpClient client), sends nothing to /bff/forum/search and
 *     renders no link to a search surface.
 *
 * Re-adding `search()` to the service fails (1); re-adding the route fails (2);
 * calling the dead path from any component or linking to it fails (3).
 */

const MOUNT = '/social/forum';
const DEAD_PATH = /\/bff\/forum\/search(?:[/?#]|$)/;

/** A concrete URL for each FORUM_ROUTES entry (route params filled in). */
function concreteUrls(): string[] {
  return FORUM_ROUTES.map((r) => {
    const path = (r.path ?? '').replace(':id', '1').replace(':subject', 'someone');
    return path ? `${MOUNT}/${path}` : MOUNT;
  });
}

describe('no UI path calls the missing BFF search endpoint', () => {
  it('ForumService exposes no search member', () => {
    const members = Object.getOwnPropertyNames(ForumService.prototype).filter((n) => /search/i.test(n));
    expect(members).withContext('ForumService.prototype').toEqual([]);
    expect('search' in ForumService.prototype).toBeFalse();
  });

  it('FORUM_ROUTES exposes no search route', () => {
    const paths = FORUM_ROUTES.map((r) => r.path ?? '').filter((p) => /search/i.test(p));
    expect(paths).toEqual([]);
  });

  describe('every routed surface (real ForumService, both transports observed)', () => {
    let fetched: string[];
    let httpTesting: HttpTestingController;

    beforeEach(() => {
      fetched = [];
      // A moderator+forum session so the role-gated affordances (New topic,
      // moderation queue load, VN editor) are rendered and exercised too.
      localStorage.setItem(
        HUG_SESSION_KEY,
        JSON.stringify({ id: 'u1', label: 'u1', handle: 'u1', provider: 'password', roles: ['forum', 'mod', 'admin'], registrationComplete: true }),
      );
      // Everything hand-written (session probe, topics, topic detail, VN,
      // stickers, announcements, avatars) goes through globalThis.fetch.
      spyOn(globalThis, 'fetch').and.callFake((input: RequestInfo | URL) => {
        fetched.push(input instanceof Request ? input.url : String(input));
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      });
      // The federated user-profile fragment is not loadable in Karma.
      spyOn(forumProfileRemoteLoader, 'load').and.rejectWith(new Error('no remote in unit tests'));

      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: 'social/forum', children: FORUM_ROUTES }]),
          provideHttpClient(),
          provideHttpClientTesting(),
        ],
      });
      httpTesting = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      localStorage.removeItem(HUG_SESSION_KEY);
    });

    it('sends nothing to /bff/forum/search and renders no link to a search surface', async () => {
      const harness = await RouterTestingHarness.create();
      const httpUrls: string[] = [];
      const visited: string[] = [];

      for (const url of concreteUrls()) {
        const component = await harness.navigateByUrl(url);
        expect(component).withContext(`${url} activates a component`).not.toBeNull();
        await harness.fixture.whenStable();
        harness.detectChanges();
        await harness.fixture.whenStable();
        harness.detectChanges();
        visited.push(url);

        for (const req of httpTesting.match(() => true)) {
          httpUrls.push(req.request.urlWithParams);
          req.flush({});
        }
        await harness.fixture.whenStable();
        harness.detectChanges();

        const links = Array.from(harness.routeNativeElement?.querySelectorAll('a') ?? []);
        const searchLinks = links
          .map((a) => a.getAttribute('href') ?? '')
          .filter((href) => /\/search(?:[/?#]|$)/.test(href));
        expect(searchLinks).withContext(`${url} links to a search surface`).toEqual([]);
        expect(harness.routeNativeElement?.querySelector('[data-testid="forum-search-link"]'))
          .withContext(`${url} renders the old search link`)
          .toBeNull();
      }

      // The sweep is not vacuous: every route was visited and the surfaces did
      // talk to the BFF over both transports.
      expect(visited.length).toBe(FORUM_ROUTES.length);
      expect(httpUrls.some((u) => /\/bff\/forum\/categories/.test(u))).withContext('HttpClient traffic observed').toBeTrue();
      expect(fetched.some((u) => /\/bff\/forum\/topics/.test(u))).withContext('fetch traffic observed').toBeTrue();

      const dead = [...fetched, ...httpUrls].filter((u) => DEAD_PATH.test(u));
      expect(dead).withContext('requests to the unmapped BFF search endpoint').toEqual([]);
    });
  });
});

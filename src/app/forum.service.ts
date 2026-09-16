import { Injectable, InjectionToken, computed, inject } from '@angular/core';
// firstValueFrom removed: ng-openapi-gen v1.x service methods return Promise directly
import { SessionService } from './session.service';
import { ForumService as GenForumService } from './api/services/forum.service';
import { ForumModerationService as GenForumModerationService } from './api/services/forum-moderation.service';
import { toStepUpError } from './step-up';

/** Base URL of the forum BFF. The fe-gateway proxies same-origin /bff/forum/**
 *  to hugmesh-forum-bff-api (which wraps the headless phpBB backend), so the
 *  default is the empty string = same origin. `globalThis.__HUG_FORUM_URL__`
 *  lets the host override the target at runtime (mirrors MastodonService's
 *  __HUG_MASTODON_URL__ / __HUG_BFF_URL__ runtime globals). The browser NEVER
 *  talks to phpBB directly. */
export const FORUM_BASE_URL = new InjectionToken<string>('FORUM_BASE_URL', {
  factory: () => (globalThis as any).__HUG_FORUM_URL__ ?? '',
});

// ---------------------------------------------------------------------------
// Contract (mirrors hugmesh-forum-bff-api ForumDto; would be the ng-openapi-gen
// shape from /v3/api-docs once the BFF spec is captured — see README "Typed API").
// ---------------------------------------------------------------------------

export interface ForumCategory {
  id: number;
  name: string;
  description: string;
  topicCount: number;
  postCount: number;
}

export interface ForumTopic {
  id: number;
  categoryId: number;
  title: string;
  /** The poster's stable Casdoor subject (NOT phpBB localpart) — the key the
   *  forum profile route resolves to a platform profile fragment. */
  authorSubject: string;
  /** Display handle for the author. */
  authorLabel: string;
  replyCount: number;
  viewCount: number;
  locked: boolean;
  createdAt: string;
  lastPostAt: string;
}

export interface ForumPost {
  id: number;
  topicId: number;
  authorSubject: string;
  authorLabel: string;
  /** Server-sanitized HTML (phpBB post parser in the extension). Still rendered
   *  defensively — never trusted to be script-free at this layer. */
  bodyHtml: string;
  createdAt: string;
  editedAt: string | null;
}

export interface TopicDetail {
  topic: ForumTopic;
  posts: ForumPost[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateTopicParams {
  categoryId: number;
  title: string;
  body: string;
}

export interface CreateReplyParams {
  topicId: number;
  body: string;
}

export interface ForumSearchResult {
  topics: ForumTopic[];
  posts: ForumPost[];
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  sort?: 'latest' | 'oldest' | 'replies';
}

/**
 * Thin reactive wrapper over hugmesh-forum-bff-api /bff/forum/**. Auth rides
 * the HttpOnly `bff_` session cookie: every request is sent with credentials
 * (the fe-gateway swaps the cookie into a server-side Bearer), so the browser
 * holds no token — the host injects nothing and the module never renders a
 * login form.
 *
 * <p><b>ng-openapi-gen migration:</b> the spec-covered reads/writes now DELEGATE
 * to the generated, typed {@link GenForumService} (under {@code src/app/api},
 * generated from the hugmesh-forum-bff-api OpenAPI spec committed at
 * {@code openapi.json}) instead of hand-rolling {@code fetch} URLs. The generated
 * client calls the SAME same-origin {@code /bff/forum/**} paths (its {@code
 * rootUrl} defaults to {@code ''}) over Angular {@code HttpClient}; the {@link
 * authInterceptor} marks each request {@code withCredentials} so the HttpOnly
 * {@code bff_} cookie rides along (the gateway swaps it into a server-side
 * Bearer) — replacing the hand-set token this service used to attach. The
 * migrated methods —
 * {@link listCategories}/{@link createTopic}/{@link createReply}/{@link
 * editPost}/{@link deletePost} — keep their OWN public {@link ForumCategory} /
 * {@link ForumTopic} / {@link ForumPost} signatures, so the consuming components
 * need no change; the generated {@code Map<String,Object>} response (which
 * ng-openapi-gen types as {@code {[k: string]: {}}}) is bridged at the
 * delegation boundary.
 *
 * <p>{@link listTopics} / {@link getTopic} ({@code page}/{@code pageSize}/{@code
 * sort} query params the BFF spec does not yet declare) and {@link getCategory}
 * / {@link search} (endpoints not in the BFF spec at all) stay on the
 * hand-written {@code fetch} path so their wire behaviour is byte-identical —
 * they migrate once the BFF spec grows those parameters/operations.
 *
 * Role-responsive: the post/reply/new-topic affordances are gated by
 * {@link canPost} (the caller holds the forum role OR ROLE_ADMIN). Visibility
 * is UI-convenience only; the BFF + the phpBB extension are the real gates.
 */
@Injectable({ providedIn: 'root' })
export class ForumService {
  private readonly base = inject(FORUM_BASE_URL);
  private readonly session = inject(SessionService);
  private readonly gen = inject(GenForumService);
  private readonly genMod = inject(GenForumModerationService);

  /** True when the caller may create topics / reply / start new topics: they
   *  hold the Casdoor 'forum' role OR are an admin (admins reach forum surfaces
   *  via the gateway admin-bypass — they need no forum role). */
  readonly canPost = computed(() => {
    const roles = this.session.session()?.roles ?? [];
    return roles.includes('forum') || roles.includes('admin');
  });

  /** True when the caller may moderate (hide/delete any post, lock threads):
   *  ROLE_ADMIN, or a mod who ALSO holds the forum role (the ROLE_FORUM_MOD
   *  AND-of-mod+forum the BFF enforces). A bare mod without the forum role is
   *  NOT a forum moderator. */
  readonly canModerate = computed(() => {
    const roles = this.session.session()?.roles ?? [];
    return roles.includes('admin') || (roles.includes('mod') && roles.includes('forum'));
  });

  // ----- headers ----------------------------------------------------------

  private headers(): Record<string, string> {
    return { Accept: 'application/json' };
  }

  private qs(params?: Record<string, unknown>): string {
    if (!params) return '';
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      sp.append(k, String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
  }

  private async getJson<T>(path: string, params?: Record<string, unknown>, fallback?: T): Promise<T> {
    const r = await fetch(`${this.base}/bff/forum${path}${this.qs(params)}`, { credentials: 'include', headers: this.headers() });
    if (!r.ok) {
      if (fallback !== undefined) return fallback;
      throw new Error(`GET ${path} failed: ${r.status}`);
    }
    return (await r.json()) as T;
  }

  // ----- reads ------------------------------------------------------------

  listCategories(): Promise<ForumCategory[]> {
    // Delegated to the generated client. The BFF returns a JSON array of
    // categories; ng-openapi-gen types the untyped Mono<Map<String,Object>>
    // response as `{[k: string]: {}}`, so cast back to the public DTO array at
    // the boundary. The fallback-to-[] semantics of the old fetch path are
    // preserved via .catch (a non-2xx becomes an HttpErrorResponse here).
    return this.gen.listForumCategories()
      .then((r) => r as unknown as ForumCategory[])
      .catch(() => []);
  }

  getCategory(id: number): Promise<ForumCategory | null> {
    return this.getJson<ForumCategory | null>(`/categories/${id}`, undefined, null);
  }

  listTopics(categoryId: number, query?: PageQuery): Promise<Page<ForumTopic>> {
    return this.getJson<Page<ForumTopic>>(
      '/topics',
      { categoryId, page: query?.page ?? 1, pageSize: query?.pageSize ?? 20, sort: query?.sort ?? 'latest' },
      { items: [], page: 1, pageSize: 20, total: 0 },
    );
  }

  getTopic(id: number, query?: PageQuery): Promise<TopicDetail> {
    return this.getJson<TopicDetail>(`/topics/${id}`, { page: query?.page ?? 1, pageSize: query?.pageSize ?? 20 });
  }

  search(q: string): Promise<ForumSearchResult> {
    return this.getJson<ForumSearchResult>('/search', { q }, { topics: [], posts: [] });
  }

  // ----- writes (gated by canPost server-side AND in the UI) --------------

  createTopic(params: CreateTopicParams): Promise<ForumTopic> {
    // Delegated. The generated CreateTopic body is {categoryId?, title, body} —
    // the same shape this method already sent; cast the Map<String,Object>
    // response back to the public ForumTopic at the boundary.
    return this.gen.createForumTopic({ body: { categoryId: params.categoryId, title: params.title, body: params.body } })
      .then((r) => r as unknown as ForumTopic);
  }

  createReply(params: CreateReplyParams): Promise<ForumPost> {
    // Delegated. Wire body is {body} POSTed to /bff/forum/topics/{id}/replies —
    // identical to the old send() call.
    return this.gen.replyToForumTopic({ id: params.topicId, body: { body: params.body } })
      .then((r) => r as unknown as ForumPost);
  }

  editPost(postId: number, body: string): Promise<ForumPost> {
    // Delegated. PUT /bff/forum/posts/{id} with {body}.
    return this.gen.editForumPost({ id: postId, body: { body } })
      .then((r) => r as unknown as ForumPost);
  }

  deletePost(postId: number): Promise<void> {
    // Delegated. DELETE /bff/forum/posts/{id}; the old send() resolved to void
    // (the body, if any, was discarded) — preserve that.
    return this.gen.deleteForumPost({ id: postId }).then(() => undefined);
  }

  /**
   * Moderate a topic (lock / unlock — the mod-consequence surface). Delegated to
   * the generated {@link GenForumModerationService}: POST
   * /bff/forum/moderation/topics/{id} with a `ModerationAction` body. The BFF's
   * {@code ModerationController} authorizes ADMIN, or the AND-of-MOD+FORUM (the
   * same predicate as {@link canModerate}), and forwards `action` opaquely to the
   * phpBB extension (whose doc set is hide/lock/delete). We surface only the
   * reversible lock/unlock verbs in the UI.
   *
   * <p><b>Step-up.</b> `/bff/forum/moderation/**` is one of the two forum path
   * groups the BFF wraps in its MFA step-up gate (`SecurityConfig.stepUp`, live
   * once the platform flips `app.mfa.enabled`). A refusal carrying the platform's
   * step-up contract ({@link toStepUpError}: the `X-Step-Up-Required` signal on a
   * 403, or the legacy "requires step-up" phrase) rejects with a typed
   * {@link StepUpRequiredError} so the caller can offer the MFA challenge; every
   * other failure — a routine role 403 included — rejects with the ORIGINAL
   * transport error, exactly as before.
   *
   * @param topicId - The topic to moderate.
   * @param action - `'lock'` to disable new replies, `'unlock'` to re-enable.
   * @param reason - Optional moderator note recorded in the forum audit trail.
   */
  moderateTopic(topicId: number, action: 'lock' | 'unlock', reason?: string): Promise<void> {
    return this.genMod
      .moderateForumTopic({ id: topicId, body: reason ? { action, reason } : { action } })
      .then(() => undefined)
      .catch((e: unknown) => {
        throw toStepUpError(e) ?? e;
      });
  }

  /** Whether the current caller owns this post (post.authorSubject == jwt sub)
   *  OR is an admin — the UI gate for the edit/delete controls. The BFF +
   *  extension re-check ownership server-side (defence-in-depth). */
  ownsPost(post: { authorSubject: string }): boolean {
    const s = this.session.session();
    if (!s) return false;
    if ((s.roles ?? []).includes('admin')) return true;
    return s.id === post.authorSubject;
  }
}

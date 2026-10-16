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
  /** Absent on the wire today: forum-bff-api's `ForumDto.Category` carries only
   *  `{id, name, description, topicCount}`. Optional so the UI never prints a
   *  post count the BFF did not send. */
  postCount?: number;
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

/** The moderation queue COUNT the moderator-reachable endpoint returns. `depth`
 *  is non-null only when `available`; a degraded/unreadable source is never
 *  reported as a zero. */
export interface ModerationQueueDepth {
  readonly depth: number | null;
  readonly source: string;
  readonly available: boolean;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  sort?: 'latest' | 'oldest' | 'replies';
}

// ---------------------------------------------------------------------------
// Wire bridge. forum-bff-api's ForumController answers every read with an
// ENVELOPE (`{categories}`, `{topics}`, `{topic, replies}`) and its records
// (ForumDto.Category/Topic/Reply) are narrower than the UI's DTOs above. These
// helpers are the one place that knows the difference; the components keep the
// public ForumCategory / ForumTopic / ForumPost / Page / TopicDetail shapes.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The list under `key` of a BFF envelope; a bare array is tolerated too. */
function unwrapList(body: unknown, key: string): Json[] {
  const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body[key]) ? (body[key] as unknown[]) : [];
  return list.filter(isObj);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function toTopic(t: Json): ForumTopic {
  const createdAt = str(t['createdAt']);
  return {
    id: num(t['id'], NaN),
    categoryId: num(t['categoryId']),
    title: str(t['title']),
    authorSubject: str(t['authorSubject']),
    authorLabel: str(t['authorLabel'], str(t['authorSubject'])),
    replyCount: num(t['replyCount']),
    viewCount: num(t['viewCount']),
    locked: t['locked'] === true,
    createdAt,
    lastPostAt: str(t['lastPostAt'], createdAt),
  };
}

/** A BFF `Reply` ({id, topicId, authorSubject, body, createdAt}) as a ForumPost. */
function toPost(r: Json): ForumPost {
  return {
    id: num(r['id'], NaN),
    topicId: num(r['topicId']),
    authorSubject: str(r['authorSubject']),
    authorLabel: str(r['authorLabel'], str(r['authorSubject'])),
    bodyHtml: str(r['bodyHtml'], str(r['body'])),
    createdAt: str(r['createdAt']),
    editedAt: typeof r['editedAt'] === 'string' ? r['editedAt'] : null,
  };
}

/** The entity of a write response: `{<key>: {...}}`, or the bare entity. A body
 *  with no numeric id (the 202 `{state:'pending'}` of a dark phpBB seam) is not
 *  an entity: reject instead of handing the UI an object with id NaN. */
function unwrapEntity(body: unknown, key: string, what: string): Json {
  const e = isObj(body) && isObj(body[key]) ? (body[key] as Json) : body;
  if (!isObj(e) || typeof e['id'] !== 'number') throw new Error(`${what} was not created or changed (no id in the BFF response)`);
  return e;
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** The BFF's GET /topics takes only `categoryId` and returns every topic in the
 *  category; `page`, `pageSize` and `sort` are applied here. */
function sortTopics(topics: ForumTopic[], sort: NonNullable<PageQuery['sort']>): ForumTopic[] {
  const by: Record<typeof sort, (a: ForumTopic, b: ForumTopic) => number> = {
    latest: (a, b) => time(b.lastPostAt) - time(a.lastPostAt),
    oldest: (a, b) => time(a.createdAt) - time(b.createdAt),
    replies: (a, b) => b.replyCount - a.replyCount,
  };
  return [...topics].sort(by[sort]);
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
 * sort} query params the BFF spec does not yet declare) stay on the hand-written
 * {@code fetch} path so their wire behaviour is byte-identical — they migrate
 * once the BFF spec grows those parameters. {@link getCategory} has no BFF
 * endpoint and resolves from {@link listCategories}; {@link search} has none
 * either and still resolves empty.
 *
 * <p><b>Wire shapes.</b> The BFF wraps every read in an envelope
 * ({@code {categories}}, {@code {topics}}, {@code {topic, replies}}) and writes
 * in {@code {topic}} / {@code {reply}} / {@code {post}}; the module-level helpers
 * above unwrap them into the public DTOs.
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
    // Delegated to the generated client. The BFF answers `{"categories":[...]}`
    // (ForumController.categories()); ng-openapi-gen types that untyped
    // Mono<Map<String,Object>> as `{[k: string]: {}}`, so unwrap the envelope
    // here (a bare array is tolerated). The fallback-to-[] semantics of the old
    // fetch path are preserved via .catch (a non-2xx becomes an
    // HttpErrorResponse here).
    return this.gen.listForumCategories()
      .then((r) => unwrapList(r, 'categories') as unknown as ForumCategory[])
      .catch(() => []);
  }

  /** The BFF has no GET /categories/{id} (it 404s), so resolve the category from
   *  the list. Resolves null when it is absent. */
  async getCategory(id: number): Promise<ForumCategory | null> {
    return (await this.listCategories()).find((c) => c.id === id) ?? null;
  }

  async listTopics(categoryId: number, query?: PageQuery): Promise<Page<ForumTopic>> {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    // The BFF answers `{"topics":[...]}` for the WHOLE category and reads only
    // `categoryId`; the page params are still sent (harmless, and honoured once
    // the BFF learns them) but paging and sorting are applied client-side.
    const body = await this.getJson<unknown>(
      '/topics',
      { categoryId, page, pageSize, sort: query?.sort ?? 'latest' },
      { topics: [] },
    );
    const all = sortTopics(unwrapList(body, 'topics').map(toTopic).filter((t) => Number.isFinite(t.id)), query?.sort ?? 'latest');
    return { items: all.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: all.length };
  }

  async getTopic(id: number, query?: PageQuery): Promise<TopicDetail> {
    const body = await this.getJson<unknown>(`/topics/${id}`, { page: query?.page ?? 1, pageSize: query?.pageSize ?? 20 });
    // `{topic, replies}`; a dark phpBB seam answers `{topic: {}, replies: []}`,
    // which is "no such topic", not a topic with id NaN.
    const topic = unwrapEntity(body, 'topic', 'topic');
    const replies = isObj(body) ? unwrapList(body, Array.isArray(body['replies']) ? 'replies' : 'posts') : [];
    return { topic: toTopic(topic), posts: replies.map(toPost) };
  }

  search(q: string): Promise<ForumSearchResult> {
    // Still a dead call: forum-bff-api maps no /search, so this resolves the
    // empty fallback on the 404. Tracked on hugmesh-forum-ui#19.
    return this.getJson<ForumSearchResult>('/search', { q }, { topics: [], posts: [] });
  }

  // ----- writes (gated by canPost server-side AND in the UI) --------------

  createTopic(params: CreateTopicParams): Promise<ForumTopic> {
    // Delegated. The generated CreateTopic body is {categoryId?, title, body} —
    // the same shape this method already sent; the BFF answers `{topic: {...}}`,
    // unwrapped back to the public ForumTopic at the boundary.
    return this.gen.createForumTopic({ body: { categoryId: params.categoryId, title: params.title, body: params.body } })
      .then((r) => toTopic(unwrapEntity(r, 'topic', 'topic')));
  }

  createReply(params: CreateReplyParams): Promise<ForumPost> {
    // Delegated. Wire body is {body} POSTed to /bff/forum/topics/{id}/replies —
    // identical to the old send() call.
    return this.gen.replyToForumTopic({ id: params.topicId, body: { body: params.body } })
      .then((r) => toPost(unwrapEntity(r, 'reply', 'reply')));
  }

  editPost(postId: number, body: string): Promise<ForumPost> {
    // Delegated. PUT /bff/forum/posts/{id} with {body}.
    return this.gen.editForumPost({ id: postId, body: { body } })
      .then((r) => toPost(unwrapEntity(r, 'post', 'post')));
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

  /**
   * Read the moderation queue DEPTH (GET /bff/forum/moderation/queue, delegated to
   * the generated {@link GenForumModerationService}). That moderator-reachable
   * endpoint returns only `{queueDepth, source}` — a count, not the queued posts
   * (the per-post list is the ADMIN-only `/bff/forum/admin/**` seam).
   *
   * <p>`available` is false when the count cannot be trusted as "nothing is
   * waiting": the BFF reports `source: "degraded"` with `queueDepth: 0` when the
   * phpBB seam is dark, breaker-open or errored, and a missing/non-numeric depth
   * is treated the same way. Only an `available` result may be shown as a count.
   *
   * <p>Step-up: a refusal carrying the platform's step-up contract rejects with a
   * {@link StepUpRequiredError} (same mapping as {@link moderateTopic}); every
   * other failure rejects with the original transport error.
   */
  getModerationQueueDepth(): Promise<ModerationQueueDepth> {
    return this.genMod
      .viewForumModerationQueue()
      .then((r) => {
        const o = r as { queueDepth?: unknown; source?: unknown };
        const source = typeof o.source === 'string' ? o.source : '';
        const depth = typeof o.queueDepth === 'number' && Number.isFinite(o.queueDepth) && o.queueDepth >= 0
          ? o.queueDepth
          : null;
        const available = depth !== null && source !== '' && source !== 'degraded';
        return { depth: available ? depth : null, source, available };
      })
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

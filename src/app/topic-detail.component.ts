import {
  AfterViewChecked,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { ForumService, ForumPost, TopicDetail } from './forum.service';
import { renderMarkdown, sanitizeContentHtml } from './markdown';
import {
  VOICE_TUNING,
  VnProfile,
  VnProfileService,
  applyVoicebox,
  isSafeCharacterImgRef,
} from './vn-profile.service';
import { insertAtCursor, stickerBodyUrl, stickerToken, transformStickerTokens } from './stickers';
import { isOwnerBlindImgRef } from './character-avatar';
import { StickerPickerComponent } from './sticker-picker.component';

/** Read-aloud cap: at most this many characters are handed to speechSynthesis
 *  per activation. Rationale: a pathological (or merely huge) post would
 *  otherwise queue minutes of speech that survives the button's visual state
 *  changes and cheap cancels poorly on some engines; ~2000 chars ≈ 2 minutes
 *  of speech, plenty for a forum post while bounding the utterance buffer. */
export const MAX_SPEECH_CHARS = 2000;

/** Indirected access to the browser speechSynthesis engine so unit tests can
 *  stub availability/behaviour without touching the real synthesizer. */
export const speechAccess = {
  synth(): SpeechSynthesis | null {
    try {
      return (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis ?? null;
    } catch {
      return null;
    }
  },
};

/**
 * Topic detail: the topic title (h1), the ordered list of posts/replies, an
 * inline reply form (role-responsive — shown only to forum-role/admin and
 * hidden when the topic is locked), and owner/ADMIN edit-delete controls per
 * post.
 *
 * VN layer (fail-soft — zero visual change for authors with no profile):
 * after the topic loads, ONE coalesced POST /bff/forum/vn-profiles/lookup
 * resolves the page's distinct authorSubjects. A profiled author's posts gain
 * a character sprite column (client-guarded /bff/user/ img only), a voicebox
 * skin (`data-vnskin` + `--forum-vnbox-accent`, both applied through the
 * allowlist/`#rrggbb` validators in {@link applyVoicebox}) and a "Read aloud"
 * button (browser speechSynthesis, pitch/rate mapped from the AUTHOR's
 * voiceStyle; feature-detected and hidden when unavailable).
 *
 * Sticker tokens (`:snap-sticker:<slug>:`) in post bodies and the reply
 * preview are rendered AFTER the sanitized HTML is in the DOM by
 * {@link transformStickerTokens} — DOM-created <img> only, never innerHTML.
 *
 * a11y: h1 topic title > each post is an <article> with an h3 author heading;
 * the reply <textarea> has a <label>; the live region reports the reply outcome.
 * Post body HTML is server-sanitized, then re-sanitized client-side with a
 * DOMPurify allow-list (defence-in-depth) before bypassSecurityTrustHtml —
 * never raw innerHTML of untrusted input.
 */
@Component({
  selector: 'hug-forum-topic-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StickerPickerComponent],
  templateUrl: './topic-detail.component.html',
  styleUrl: './topic-detail.component.scss',
})
export class TopicDetailComponent implements OnInit, AfterViewChecked, OnDestroy {
  private readonly forum = inject(ForumService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly vn = inject(VnProfileService);
  private readonly host = inject(ElementRef<HTMLElement>);
  /** See {@link ngAfterViewChecked}: state that only the post-render DOM pass
   *  consumes must explicitly request a re-check of THIS view when it lands. */
  private readonly cdr = inject(ChangeDetectorRef);

  readonly detail = signal<TopicDetail | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly replyBody = signal('');
  readonly busy = signal(false);
  readonly outcome = signal<{ kind: 'status' | 'alert'; text: string } | null>(null);

  /** Per-post inline edit state (postId → draft body). */
  readonly editingId = signal<number | null>(null);
  readonly editBody = signal('');

  /** authorSubject → VN profile for the authors on this page (fail-soft {}). */
  readonly profiles = signal<Record<string, VnProfile>>({});

  /** The post currently being read aloud (aria-pressed state), or null. */
  readonly speakingPostId = signal<number | null>(null);

  readonly canPost = this.forum.canPost;

  /** True for a forum moderator (ADMIN, or MOD+FORUM) — drives the topic
   *  Lock/Unlock control AND (via {@link canEdit}) edit/delete on ANY post. */
  readonly canModerate = this.forum.canModerate;

  /** SafeHtml memo per post so [innerHTML] is only re-set when a body actually
   *  changes — otherwise every change-detection pass would wipe the DOM-level
   *  sticker transforms. */
  private readonly safeCache = new Map<number, { src: string; html: SafeHtml }>();
  private previewCache: { src: string; html: SafeHtml } | null = null;

  /**
   * Track-by for the post list. Keeps existing DOM nodes when a single post
   * is replaced after an optimistic edit.
   *
   * @param _ - Unused list index.
   * @param p - The post item.
   * @returns The post's numeric id.
   */
  trackId = (_: number, p: ForumPost): number => p.id;

  /**
   * Subscribe to the `:id` route param and load the topic on navigation.
   * The guard on the route already validates that `id` is numeric, but we
   * check anyway to handle direct URL entry.
   */
  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      const id = Number(p.get('id'));
      if (Number.isFinite(id)) void this.load(id);
    });
  }

  /**
   * After every render: (a) apply each profiled author's voicebox skin +
   * accent to their post <article> (allowlist/#rrggbb validated in
   * {@link applyVoicebox}), and (b) transform sticker tokens inside the
   * rendered post bodies and the reply preview. Both operations are
   * idempotent, so re-running per change-detection pass is safe.
   *
   * IMPORTANT — this hook runs only when Angular checks THIS component view.
   * The DOM it writes is driven by {@link profiles} and by the rendered post
   * bodies, yet `profiles` is read only from here and from inside the `@for`
   * block (via {@link spriteUrl}) — never from this component's own template.
   * So when that state is set from a resolved promise, Angular's fine-grained
   * change detection refreshes just the embedded `@for` view that reads it and
   * this hook never runs: the voicebox skin/accent stays unapplied and sticker
   * tokens stay raw text. Every ASYNC writer of that state therefore pairs its
   * `set()` with `ChangeDetectorRef.markForCheck()` (see {@link load} and
   * {@link loadProfiles}); the event-driven writers (reply/edit/delete/lock)
   * need nothing, because the listener that triggered them already marks the
   * view dirty.
   */
  ngAfterViewChecked(): void {
    const root = this.host.nativeElement as HTMLElement;
    const profiles = this.profiles();
    const subjectByPostId = new Map<string, string>();
    for (const p of this.detail()?.posts ?? []) subjectByPostId.set(String(p.id), p.authorSubject);

    for (const article of Array.from(root.querySelectorAll<HTMLElement>('article.forum-post'))) {
      const subject = subjectByPostId.get(article.getAttribute('data-post-id') ?? '');
      const prof = subject ? (profiles[subject] ?? null) : null;
      applyVoicebox(article, prof?.voiceboxStyle ?? null, prof?.voiceboxAccent ?? null);
      const body = article.querySelector<HTMLElement>('.forum-post__body');
      if (body) transformStickerTokens(body);
    }
    const preview = root.querySelector<HTMLElement>('.topic__preview .forum-post__body');
    if (preview) transformStickerTokens(preview);
  }

  /** Stop any in-flight read-aloud when the reader navigates away. */
  ngOnDestroy(): void {
    speechAccess.synth()?.cancel();
  }

  /**
   * Whether the current user may edit or delete this post. The owner (or admin)
   * may act on their OWN post ({@link ForumService.ownsPost}); a forum moderator
   * ({@link ForumService.canModerate} — ADMIN, or MOD+FORUM) may edit/delete ANY
   * post. The BFF re-checks ownership/role server-side (defence-in-depth); this
   * gate mirrors the BFF's `editForumPost`/`deleteForumPost` authorization so a
   * moderator never sees a control the role can't use, and — matching the
   * ROLE_FORUM_MOD contract — always sees one it can.
   *
   * @param post - The post to test.
   * @returns `true` when the caller owns the post, holds ROLE_ADMIN, or is a
   *   forum moderator.
   */
  canEdit(post: ForumPost): boolean {
    return this.forum.ownsPost(post) || this.forum.canModerate();
  }

  /**
   * Lock or unlock the current topic (moderator-only). Calls
   * POST /bff/forum/moderation/topics/{id}; on success updates the local
   * topic.locked so the reply form appears/disappears WITHOUT a reload and
   * announces the outcome in the live region. The BFF is the real gate.
   */
  async toggleLock(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const next = !d.topic.locked;
    this.busy.set(true);
    this.outcome.set(null);
    try {
      await this.forum.moderateTopic(d.topic.id, next ? 'lock' : 'unlock');
      this.detail.set({ ...d, topic: { ...d.topic, locked: next } });
      this.outcome.set({ kind: 'status', text: next ? 'Topic locked.' : 'Topic unlocked.' });
    } catch {
      this.outcome.set({ kind: 'alert', text: 'Could not update the topic lock. Please try again.' });
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Re-sanitize the server-rendered post HTML, then bind it for Angular.
   * The BFF + phpBB extension parser already sanitizes on the way in, but we
   * re-run a conservative DOMPurify allow-list at the browser boundary
   * (defence-in-depth) so a compromised or misbehaving upstream can never
   * inject script into the reader's DOM — only then do we bypass Angular's
   * own sanitizer. Memoized per post so the binding value is stable across
   * change detection (see {@link safeCache}).
   *
   * @param p - The post whose {@link ForumPost.bodyHtml} to render.
   * @returns A {@link SafeHtml} value for binding in `[innerHTML]`.
   */
  safeBody(p: ForumPost): SafeHtml {
    const hit = this.safeCache.get(p.id);
    if (hit && hit.src === p.bodyHtml) return hit.html;
    const html = this.sanitizer.bypassSecurityTrustHtml(sanitizeContentHtml(p.bodyHtml));
    this.safeCache.set(p.id, { src: p.bodyHtml, html });
    return html;
  }

  /**
   * Client-side Markdown preview of the reply draft.
   * The server re-sanitizes on submit — this is a visual convenience only.
   * Memoized on the draft text so the preview DOM (and its transformed
   * stickers) survives unrelated change-detection passes.
   *
   * @returns A {@link SafeHtml} from the DOMPurify-sanitized preview render.
   */
  previewHtml(): SafeHtml {
    const src = this.replyBody();
    if (!this.previewCache || this.previewCache.src !== src) {
      this.previewCache = { src, html: this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(src)) };
    }
    return this.previewCache.html;
  }

  /**
   * The author's VN profile for a post, if one exists.
   *
   * @param p - The post.
   * @returns The profile, or `null` (post renders exactly as today).
   */
  profileOf(p: ForumPost): VnProfile | null {
    return this.profiles()[p.authorSubject] ?? null;
  }

  /**
   * The character sprite URL for a post's author: characterImgRef when it
   * passes the client-side same-origin guard (must start with `/bff/user/` —
   * the server allowlists too, but never trust the wire), else the sticker
   * body URL for their stickerSlug, else nothing.
   *
   * OWNER-BLIND refs are skipped ({@link isOwnerBlindImgRef}) — a same-origin
   * path whose owner is resolved from whoever FETCHES it can never name this
   * post's author. Two of them exist: the bare avatar handle path a VN profile
   * saved before the serve route existed (a JSON endpoint, so exactly the broken
   * image hugmesh-forum-bff-api issue #3 reported), and the owner-scoped
   * self-avatar serve, which is worse — it returns a real 200 image, so it would
   * paint the READER's own picture beside the AUTHOR's name. Falling through to
   * the sticker (or to no sprite at all) degrades those profiles gracefully
   * until their owner saves again.
   *
   * @param p - The post.
   * @returns A same-origin image URL, or `null` (no sprite column).
   */
  spriteUrl(p: ForumPost): string | null {
    const prof = this.profileOf(p);
    if (!prof) return null;
    if (
      prof.characterImgRef &&
      isSafeCharacterImgRef(prof.characterImgRef) &&
      !isOwnerBlindImgRef(prof.characterImgRef)
    ) {
      return prof.characterImgRef;
    }
    if (prof.stickerSlug) return stickerBodyUrl(prof.stickerSlug);
    return null;
  }

  /** Whether the browser can read posts aloud (speechSynthesis present). */
  get speechAvailable(): boolean {
    return (
      speechAccess.synth() !== null &&
      typeof (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === 'function'
    );
  }

  /**
   * Toggle reading a post aloud with the browser speechSynthesis engine.
   * Pitch/rate come from the AUTHOR's voiceStyle ({@link VOICE_TUNING});
   * clicking the active post's button (or navigating away) cancels. No
   * network TTS is ever used.
   *
   * @param p - The post to read (its rendered textContent, i.e. after
   *   sanitization and sticker transformation).
   */
  toggleSpeak(p: ForumPost): void {
    const synth = speechAccess.synth();
    if (!synth) return;
    if (this.speakingPostId() === p.id) {
      synth.cancel();
      this.speakingPostId.set(null);
      return;
    }
    synth.cancel();
    const body = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `article[data-post-id="${p.id}"] .forum-post__body`,
    );
    // Cap the utterance (see MAX_SPEECH_CHARS): bound the speech buffer so a
    // huge post cannot queue unbounded audio.
    const text = (body?.textContent ?? '').trim().slice(0, MAX_SPEECH_CHARS);
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const style = this.profileOf(p)?.voiceStyle;
    if (style) {
      utterance.pitch = VOICE_TUNING[style].pitch;
      utterance.rate = VOICE_TUNING[style].rate;
    }
    const done = (): void => {
      if (this.speakingPostId() === p.id) this.speakingPostId.set(null);
    };
    utterance.onend = done;
    utterance.onerror = done;
    this.speakingPostId.set(p.id);
    synth.speak(utterance);
  }

  /**
   * Hide a sprite <img> whose ref no longer resolves (deleted sticker/avatar,
   * upstream outage). Fail-soft at the pixel level: the post keeps its layout
   * and never shows a broken-image glyph.
   *
   * @param ev - The img error event.
   */
  hideBrokenSprite(ev: Event): void {
    (ev.target as HTMLElement | null)?.setAttribute('hidden', '');
  }

  /**
   * Insert a sticker token at the reply textarea's caret (from the picker).
   *
   * @param slug - The picked sticker slug (re-validated by stickerToken).
   */
  insertSticker(slug: string): void {
    const token = stickerToken(slug);
    if (!token) return;
    const area = (this.host.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('#reply-body');
    if (area) {
      this.replyBody.set(insertAtCursor(area, token));
    } else {
      this.replyBody.set(this.replyBody() + token);
    }
  }

  /**
   * Fetch a topic and its posts.
   * Calls GET /bff/forum/topics/{id}.
   * Sets `loading` during the request and `error` on failure. Kicks off the
   * (fail-soft) VN profile lookup for the page's authors once posts arrive.
   *
   * @param id - The numeric topic id from the route.
   */
  private async load(id: number): Promise<void> {
    this.loading.set(true);
    try {
      const d = await this.forum.getTopic(id);
      this.detail.set(d);
      // The freshly rendered post bodies need the post-render sticker pass;
      // ask for a check of THIS view, not just of the @for that reads `detail`.
      this.cdr.markForCheck();
      this.error.set('');
      void this.loadProfiles(d.posts);
    } catch {
      this.error.set('Could not load this topic. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Resolve VN profiles for the given posts' authors — ONE coalesced lookup
   * for the page's distinct subjects (VnProfileService batches + caches).
   * Fail-soft: on any error the map stays empty and posts render as today.
   *
   * @param posts - Posts whose authors to resolve.
   */
  private async loadProfiles(posts: readonly ForumPost[]): Promise<void> {
    const found = await this.vn.lookup(posts.map((p) => p.authorSubject));
    this.profiles.set({ ...this.profiles(), ...found });
    // `profiles` feeds ngAfterViewChecked (applyVoicebox) but not this view's
    // own template, so nothing else would schedule the check that applies it.
    this.cdr.markForCheck();
  }

  /**
   * Submit the reply draft.
   * Calls POST /bff/forum/topics/{id}/replies.
   * On success: appends the new post to the local list and clears the draft.
   * On failure: sets an alert outcome so the live region announces the error.
   */
  async submitReply(): Promise<void> {
    const d = this.detail();
    const body = this.replyBody().trim();
    if (!d || !body) return;
    this.busy.set(true);
    this.outcome.set(null);
    try {
      const post = await this.forum.createReply({ topicId: d.topic.id, body });
      // Append the new post optimistically — the live reply list updates immediately.
      this.detail.set({ ...d, posts: [...d.posts, post] });
      this.replyBody.set('');
      this.outcome.set({ kind: 'status', text: 'Reply posted.' });
      // Cheap (cache-served for known authors): style the new post too.
      void this.loadProfiles([post]);
    } catch {
      this.outcome.set({ kind: 'alert', text: 'Could not post your reply. Please try again.' });
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Begin an inline edit for a post. Seeds the draft textarea with the
   * post's plain-text body (HTML tags stripped for readability — the server
   * owns the canonical `bodyHtml` and re-sanitizes on save).
   *
   * @param post - The post to start editing.
   */
  startEdit(post: ForumPost): void {
    this.editingId.set(post.id);
    // Strip tags to give the author a legible plain-text starting point;
    // the server re-renders and re-sanitizes the markdown on PUT.
    this.editBody.set(post.bodyHtml.replace(/<[^>]+>/g, ''));
  }

  /** Cancel an in-progress inline edit, discarding any unsaved draft. */
  cancelEdit(): void {
    this.editingId.set(null);
    this.editBody.set('');
  }

  /**
   * Save an inline post edit.
   * Calls PUT /bff/forum/posts/{postId}.
   * On success: replaces the post in the local list with the server response
   * (which carries the freshly sanitized `bodyHtml`).
   *
   * @param post - The post being edited.
   */
  async saveEdit(post: ForumPost): Promise<void> {
    const body = this.editBody().trim();
    if (!body) return;
    this.busy.set(true);
    try {
      const updated = await this.forum.editPost(post.id, body);
      const d = this.detail();
      // Replace only the edited post, keeping the rest of the list intact.
      if (d) this.detail.set({ ...d, posts: d.posts.map((p) => (p.id === post.id ? updated : p)) });
      this.outcome.set({ kind: 'status', text: 'Post updated.' });
      this.cancelEdit();
    } catch {
      this.outcome.set({ kind: 'alert', text: 'Could not update the post.' });
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Delete a post.
   * Calls DELETE /bff/forum/posts/{postId}.
   * On success: removes the post from the local list without a full reload.
   *
   * @param post - The post to delete.
   */
  async deletePost(post: ForumPost): Promise<void> {
    this.busy.set(true);
    try {
      await this.forum.deletePost(post.id);
      const d = this.detail();
      // Remove the deleted post from the local list.
      if (d) this.detail.set({ ...d, posts: d.posts.filter((p) => p.id !== post.id) });
      this.outcome.set({ kind: 'status', text: 'Post deleted.' });
    } catch {
      this.outcome.set({ kind: 'alert', text: 'Could not delete the post.' });
    } finally {
      this.busy.set(false);
    }
  }
}

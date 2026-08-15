import { AfterViewChecked, Component, ElementRef, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { ForumService, ForumCategory } from './forum.service';
import { renderMarkdown } from './markdown';
import { insertAtCursor, stickerToken, transformStickerTokens } from './stickers';
import { StickerPickerComponent } from './sticker-picker.component';

/**
 * Create a new topic: category picker, title, Markdown body (textarea +
 * DOMPurify-sanitized live preview + an "Insert sticker" picker that drops
 * `:snap-sticker:<slug>:` tokens at the caret; the preview renders them via
 * the DOM-safe transformStickerTokens pass). Server-side sanitization is
 * enforced in the phpBB extension (phpBB's own post parser) — the preview is
 * convenience only.
 *
 * Role-responsive: the WHOLE form is gated by canPost (forum role / admin). A
 * caller without the forum role sees a clear "you need the forum role" message
 * instead of the form. The BFF + extension are the real gate (defence-in-depth).
 *
 * a11y: h1 heading; every control has a <label>; required fields use
 * aria-invalid + a role="alert" live region; the submit error is announced.
 */
@Component({
  selector: 'hug-forum-create-topic',
  standalone: true,
  imports: [CommonModule, FormsModule, StickerPickerComponent],
  templateUrl: './create-topic.component.html',
  styleUrl: './create-topic.component.scss',
})
export class CreateTopicComponent implements OnInit, AfterViewChecked {
  private readonly forum = inject(ForumService);
  private readonly router = inject(Router);
  /** THIS route (`<mount>/create-topic`) — what `../topics` is relative TO.
   *  See {@link submit}: a relative `Router.navigate` without `relativeTo`
   *  resolves against the router ROOT, not the current route. */
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly categories = signal<ForumCategory[]>([]);
  readonly categoryId = signal<number | null>(null);
  readonly title = signal('');
  readonly body = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly touched = signal(false);

  readonly canPost = this.forum.canPost;

  /** Preview memo so [innerHTML] only re-sets when the draft changes —
   *  otherwise every change-detection pass would wipe the DOM-level sticker
   *  transforms out of the preview. */
  private previewCache: { src: string; html: SafeHtml } | null = null;

  /**
   * Pre-load the category list from GET /bff/forum/categories so the picker
   * is populated before the user types. Skips the network call entirely when
   * the caller lacks the required role (the form is hidden in that case anyway).
   */
  async ngOnInit(): Promise<void> {
    if (!this.canPost()) return;
    try {
      const cats = await this.forum.listCategories();
      this.categories.set(cats);
      // Default to the first category so the picker is pre-selected.
      if (cats.length) this.categoryId.set(cats[0].id);
    } catch {
      this.error.set('Could not load categories. Please try again.');
    }
  }

  /**
   * After every render, transform any `:snap-sticker:<slug>:` tokens in the
   * live preview into DOM-created <img> stickers (idempotent, capped).
   */
  ngAfterViewChecked(): void {
    const preview = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.create-preview .forum-post__body');
    if (preview) transformStickerTokens(preview);
  }

  /**
   * Live DOMPurify-sanitized Markdown preview of the body draft.
   * The server re-sanitizes via phpBB's post parser on submit — this is a
   * visual convenience only. Memoized on the draft text so the preview DOM
   * (and its transformed stickers) survives unrelated change detection.
   *
   * @returns A {@link SafeHtml} value for `[innerHTML]` binding.
   */
  previewHtml(): SafeHtml {
    const src = this.body();
    if (!this.previewCache || this.previewCache.src !== src) {
      this.previewCache = { src, html: this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(src)) };
    }
    return this.previewCache.html;
  }

  /**
   * Insert a sticker token at the body textarea's caret (from the picker).
   *
   * @param slug - The picked sticker slug (re-validated by stickerToken).
   */
  insertSticker(slug: string): void {
    const token = stickerToken(slug);
    if (!token) return;
    const area = (this.host.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('#topic-body');
    if (area) {
      this.body.set(insertAtCursor(area, token));
    } else {
      this.body.set(this.body() + token);
    }
  }

  /**
   * Whether the title field should show its `aria-invalid` + error hint.
   * Only applies after the user has first attempted submission (`touched`).
   *
   * @returns `true` when touched and the title is blank.
   */
  titleInvalid(): boolean {
    return this.touched() && this.title().trim().length === 0;
  }

  /**
   * Whether the body field should show its `aria-invalid` + error hint.
   *
   * @returns `true` when touched and the body is blank.
   */
  bodyInvalid(): boolean {
    return this.touched() && this.body().trim().length === 0;
  }

  /**
   * Whether all required fields are filled and the form may be submitted.
   * Mirrors the server-side validation constraints in the BFF/phpBB extension.
   *
   * @returns `true` when a category is selected, the title is non-empty, and
   *   the body is non-empty.
   */
  formValid(): boolean {
    return !!this.categoryId() && this.title().trim().length > 0 && this.body().trim().length > 0;
  }

  /**
   * Submit the new topic.
   * Calls POST /bff/forum/topics.
   * On success: navigates to the newly created topic's detail page.
   * On failure: sets `error` so the role="alert" live region announces it.
   */
  async submit(): Promise<void> {
    // Mark touched so validation hints become visible before any network call.
    this.touched.set(true);
    if (!this.formValid()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const topic = await this.forum.createTopic({
        categoryId: this.categoryId()!,
        title: this.title().trim(),
        body: this.body().trim(),
      });
      // Navigate to the newly created topic so the author can see their post.
      //
      // `relativeTo` is LOAD-BEARING, not decoration. `Router.navigate` — unlike
      // a `routerLink` in a template, which defaults to the component's own
      // ActivatedRoute — resolves its command list against the router ROOT when
      // no `relativeTo` is given. So `['../topics', id]` walked up from `/`
      // (where `..` is a no-op) and produced `/topics/<id>`: correct-looking
      // standalone at the origin root, and off the remote entirely under the
      // host shell, where this remote is mounted at /social/forum and the
      // injected Router is the SHELL's. Every `../` link in this repo's
      // TEMPLATES (forum-index, topics-list, forum-search, topic-detail) was
      // already right for exactly that reason; this one call site was not.
      void this.router.navigate(['../topics', topic.id], { relativeTo: this.route });
    } catch {
      this.error.set('Could not create the topic. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

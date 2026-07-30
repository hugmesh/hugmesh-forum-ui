import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { ForumAnnouncementsService } from './forum-announcements.service';
import { ForumAnnouncement } from './forum-announcement.model';

/**
 * The forum MAIN-page announcements banner. Renders the active, forum-targeted
 * announcements (GET /bff/announcements/forum) AT THE TOP of the forum index,
 * in priority order, and renders nothing when there are none.
 *
 * SECURITY: each announcement's server-sanitized `body_html` is rendered inside
 * a SANDBOXED, null-origin `srcdoc` iframe (sandbox WITHOUT allow-same-origin
 * and WITHOUT allow-scripts), never via raw innerHTML. This MIRRORS the host
 * home banner + the login banner exactly — the iframe cannot run scripts, reach
 * this origin's storage, or navigate the top frame.
 *
 * Accessibility: a labelled role="region" with aria-live="polite"; each dismiss
 * is a real <button> with an announcement-specific aria-label; non-dismissible
 * announcements omit the control. Dismiss-once persists the id to localStorage.
 */
@Component({
  selector: 'hug-forum-announcements',
  standalone: true,
  templateUrl: './forum-announcements.component.html',
  changeDetection: ChangeDetectionStrategy.Default,
  styleUrl: './forum-announcements.component.scss',
})
export class ForumAnnouncementsComponent implements OnInit {
  private readonly service = inject(ForumAnnouncementsService);
  private readonly sanitizer = inject(DomSanitizer);

  /** Memoised srcdoc per announcement id so the binding returns a STABLE
   *  SafeHtml reference across change-detection (a fresh object each CD would
   *  force the iframe to reload). */
  private readonly srcdocCache = new Map<string, SafeHtml>();

  /** The resolved HugMesh palette the sandboxed iframe styles against.
   *  The iframe is null-origin (sandbox WITHOUT allow-same-origin) so it can
   *  NOT read the parent's --hug-* custom properties; we snapshot their computed
   *  values from the host document once and inline the literal colours. This
   *  keeps the banner on the --hug-* purple contract (was hardcoded gold #ffd700,
   *  which is host-shell chrome only) and lets a Model-B rebrand of the tokens
   *  reach the iframe. Falls back to the canonical hexes when the tokens are not
   *  resolvable (e.g. a bare unit-test DOM without the global stylesheet). */
  private palette: { text: string; link: string } | null = null;

  readonly announcements = this.service.visible;

  /** Trigger the BFF load; the result populates {@link ForumAnnouncementsService.visible}. */
  ngOnInit(): void {
    void this.service.load();
  }

  /**
   * Dismiss a single announcement. Non-dismissible announcements are silently
   * ignored by the service (the button is hidden in the template for those).
   *
   * @param a - The announcement to dismiss; its `id` is persisted to localStorage.
   */
  dismiss(a: ForumAnnouncement): void {
    this.service.dismiss(a.id);
  }

  /**
   * Build the sandboxed `srcdoc` document for one announcement. The body is
   * the already server-sanitized admin HTML; we only wrap it with a charset and
   * a minimal inline style. The iframe runs WITHOUT `allow-same-origin` and
   * WITHOUT `allow-scripts` (see the `sandbox` attribute in the template), so
   * the document is inert — it cannot read this origin's cookies/storage or
   * execute script.
   *
   * The result is memoised per announcement `id` so that repeated change-
   * detection cycles return a STABLE `SafeHtml` reference and do not force
   * the iframe to reload on every cycle.
   *
   * @param a - The announcement whose `body_html` should be rendered.
   * @returns A {@link SafeHtml} value safe to bind to `[srcdoc]`.
   */
  srcdoc(a: ForumAnnouncement): SafeHtml {
    const cached = this.srcdocCache.get(a.id);
    if (cached) return cached;
    const { text, link } = this.resolvePalette();
    const doc = [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<meta name="referrer" content="no-referrer">',
      '<base target="_blank">',
      '<style>',
      ':root{color-scheme:dark}',
      'html,body{margin:0}',
      `body{font:400 1rem/1.5 Arial,Helvetica,sans-serif;color:${text};`,
      'word-break:break-word;overflow-wrap:anywhere}',
      `a{color:${link}}`,
      'img,video,iframe{max-width:100%;height:auto}',
      '</style></head><body>',
      a.body_html,
      '</body></html>',
    ].join('');
    const safe = this.sanitizer.bypassSecurityTrustHtml(doc);
    this.srcdocCache.set(a.id, safe);
    return safe;
  }

  /**
   * Snapshot the iframe text/link colours from the host's resolved --hug-*
   * tokens (once per component). The sandboxed iframe cannot read the parent's
   * custom properties, so the literal values are inlined into its srcdoc. Only
   * a strict `#rrggbb`/`#rgb` value is accepted (the palette tokens are all
   * hex); anything else falls back to the canonical HugMesh hex so a hostile
   * or malformed computed value can never inject into the iframe CSS.
   *
   * @returns The resolved `{ text, link }` hex colours for the iframe CSS.
   */
  private resolvePalette(): { text: string; link: string } {
    if (this.palette) return this.palette;
    const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
    const read = (token: string, fallback: string): string => {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
        return hex.test(v) ? v : fallback;
      } catch {
        return fallback;
      }
    };
    this.palette = {
      // --hug-text 15.9:1 AAA for body copy; --hug-accent-soft (#b388ff, 7.38:1)
      // is the accent-TEXT token — links must use it, not the bg-only --hug-accent.
      text: read('--hug-text', '#e8e8f0'),
      link: read('--hug-accent-soft', '#b388ff'),
    };
    return this.palette;
  }

  /**
   * Track-by function for the template's `@for` block. Keying on the stable
   * `id` prevents the iframe from reloading when the `visible()` array
   * reference changes but the underlying announcement content is unchanged.
   *
   * @param _index - The list index (unused; required by Angular's track-by signature).
   * @param a - The announcement item.
   * @returns The announcement's stable `id` string.
   */
  trackById(_index: number, a: ForumAnnouncement): string {
    return a.id;
  }
}

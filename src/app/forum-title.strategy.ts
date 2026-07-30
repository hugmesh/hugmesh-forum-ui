import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/**
 * Per-route document-title strategy for the STANDALONE forum dev shell
 * (`ng serve forum`). Formats the resolved route `title` as
 * `HugMesh Forum — <Surface>` (and bare `HugMesh Forum` at the index), so each
 * forum surface has its own tab title and the branded product name is always
 * present — the `HugMesh <Surface>` product-name format from the branding
 * baseline. The static `index.html` title keeps the `(remote)` dev-shell marker
 * the baseline prescribes for documents that are never served to users; this
 * strategy replaces it on the first navigation of the dev shell.
 *
 * SCOPE: this is registered ONLY in the dev-shell `bootstrap.ts`. In production
 * the hugmesh.systems host federates `./routes` (FORUM_ROUTES) and owns the
 * document title with its OWN strategy; FORUM_ROUTES deliberately carry no
 * `title`, and the dev-shell wrapper (app.routes.ts) attaches the surface names
 * — so this strategy never runs inside the host and cannot override host chrome.
 */
@Injectable()
export class ForumTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  /** The branded product name, present on every tab. */
  static readonly BRAND = 'HugMesh Forum';

  /**
   * Set the document title from the deepest activated route's `title`.
   *
   * @param snapshot - The current router state snapshot.
   */
  override updateTitle(snapshot: RouterStateSnapshot): void {
    const surface = this.buildTitle(snapshot);
    this.title.setTitle(surface ? `${ForumTitleStrategy.BRAND} — ${surface}` : ForumTitleStrategy.BRAND);
  }
}

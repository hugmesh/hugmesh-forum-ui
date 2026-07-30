import { Component, ElementRef, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { ForumService, ForumCategory } from './forum.service';
import { ForumBrandService } from './forum-brand.service';
import { ForumAnnouncementsComponent } from './forum-announcements.component';
import { SessionService } from './session.service';
import { VnProfileEditorComponent } from './vn-profile-editor.component';

/**
 * Forum index (the main page): the forum announcements banner at the very top
 * (GET /bff/announcements/forum), the forum title (brand-aware), the list of
 * categories, a role-responsive "New topic" affordance, and (for any
 * logged-in caller) the "VN profile" toggle that opens the compact VN profile
 * editor panel (character sticker, voicebox skin/accent, voice style).
 *
 * a11y: h1 forum title > h2 "Categories" > the category list is a labelled
 * role="region"; each category is a link with a descriptive context. The "New
 * topic" control is shown only when the caller may post (forum role / admin).
 */
@Component({
  selector: 'hug-forum-index',
  standalone: true,
  imports: [CommonModule, RouterLink, ForumAnnouncementsComponent, VnProfileEditorComponent],
  templateUrl: './forum-index.component.html',
  styleUrl: './forum-index.component.scss',
})
export class ForumIndexComponent implements OnInit {
  private readonly forum = inject(ForumService);
  private readonly session = inject(SessionService);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly brand = inject(ForumBrandService);

  readonly categories = signal<ForumCategory[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  /** Whether the VN profile editor panel is expanded. */
  readonly showVnEditor = signal(false);

  /** The VN profile endpoints are authenticated — only offer the editor to a
   *  logged-in session (the BFF is the real gate; this is UI convenience). */
  readonly loggedIn = this.session.loggedIn;

  /** Role-responsive: hide "New topic" unless the caller holds the forum role
   *  or ROLE_ADMIN (UI-convenience; the BFF + extension are the real gate). */
  readonly canPost = this.forum.canPost;

  /**
   * Close the VN editor panel and return focus to its toggle button.
   * a11y (WCAG 2.1.2 / focus management): Escape inside the panel — and a
   * successful save — dismiss it WITHOUT stranding keyboard focus in removed
   * DOM; focus lands back on the control that opened it.
   */
  closeVnEditor(): void {
    this.showVnEditor.set(false);
    (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="vn-profile-toggle"]')?.focus();
  }

  /**
   * Track-by for the category list. Prevents Angular from recreating DOM
   * nodes when the same category is present in a refreshed array.
   *
   * @param _ - Unused list index.
   * @param c - The category item.
   * @returns The category's numeric id.
   */
  trackId = (_: number, c: ForumCategory): number => c.id;

  /**
   * Load the category list from GET /bff/forum/categories on view init.
   * Sets `loading` during the request and `error` on failure.
   */
  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      this.categories.set(await this.forum.listCategories());
      this.error.set('');
    } catch {
      this.error.set('Could not load the forum categories. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}

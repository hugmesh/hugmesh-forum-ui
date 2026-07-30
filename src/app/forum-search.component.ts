import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ForumService, ForumSearchResult } from './forum.service';

/**
 * Forum search across topics + posts. A single search field submits to the BFF
 * (GET /bff/forum/search) and renders grouped results.
 *
 * a11y: h1 heading; the search field is a labelled role="search" form; results
 * are labelled role="region"s; the result count is announced via aria-live.
 */
@Component({
  selector: 'hug-forum-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './forum-search.component.html',
  styleUrl: './forum-search.component.scss',
})
export class ForumSearchComponent {
  private readonly forum = inject(ForumService);

  readonly query = signal('');
  readonly results = signal<ForumSearchResult | null>(null);
  readonly loading = signal(false);
  /** Set to `true` once the user has run at least one search, so the template
   *  can distinguish "no results" from "not yet searched". */
  readonly searched = signal(false);

  /**
   * Total number of matched items across topics and posts.
   * Used by the aria-live region to announce the result count.
   *
   * @returns The sum of topic and post result counts, or 0 when nothing is loaded.
   */
  resultCount(): number {
    const r = this.results();
    return r ? r.topics.length + r.posts.length : 0;
  }

  /**
   * Execute a full-text search.
   * Calls GET /bff/forum/search?q=.
   * No-ops on a blank query. On failure, sets empty results so the template
   * shows a graceful "no results" state rather than crashing.
   */
  async search(): Promise<void> {
    const q = this.query().trim();
    if (!q) return;
    this.loading.set(true);
    // Mark as searched so the "no results" message can appear on empty success.
    this.searched.set(true);
    try {
      this.results.set(await this.forum.search(q));
    } catch {
      // Degrade to empty results on network/BFF error.
      this.results.set({ topics: [], posts: [] });
    } finally {
      this.loading.set(false);
    }
  }
}
